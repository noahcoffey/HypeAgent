#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv'
import path from 'path'
import {
  loadEnvConfig,
  FileSystemStorage,
  runOnce,
  createUpdateDraft,
  type Connector,
  type ProjectState,
  type Fact,
} from '@hypeagent/core'
import { FileSystemPublisher } from '@hypeagent/publisher-fs'
import { GitHubPagesPublisher } from '@hypeagent/publisher-ghpages'
import { GitHubConnector } from '@hypeagent/github'
import OpenAI from 'openai'
import { parseFlags, shouldGenerateAiSummary, shouldIndexOnly } from './flags.js'

async function main() {
  loadDotenv()
  const cfg = loadEnvConfig()
  // Simple CLI flags
  const { noAi, indexOnly, windowHours: windowHoursFlag, watch, intervalMinutes: intervalMinutesFlag } = parseFlags(process.argv.slice(2))

  const stateFile = process.env.STATE_FILE || path.join(process.cwd(), '.hypeagent', 'state.json')
  const storage = new FileSystemStorage(stateFile)

  // Publisher selection (env: PUBLISHER=fs|none; default fs)
  const pubKind = String(process.env.PUBLISHER || 'fs').toLowerCase()
  // For fs publisher, use an absolute path. For gh-pages, use a repo-relative path.
  const fsOutDir = process.env.PUBLISH_OUT_DIR || path.join(process.cwd(), 'updates')
  const ghRepoDir = process.env.PUBLISH_OUT_DIR || 'updates'
  const baseUrl = process.env.PUBLISH_BASE_URL
  let publisher: FileSystemPublisher | GitHubPagesPublisher | undefined
  if (pubKind === 'fs') {
    publisher = new FileSystemPublisher()
    await publisher.init({ outDir: fsOutDir, baseUrl })
  } else if (pubKind === 'gh-pages') {
    const ghOwner = process.env.GHPAGES_OWNER
    const ghRepo = process.env.GHPAGES_REPO
    const ghBranch = process.env.GHPAGES_BRANCH || 'gh-pages'
    const ghToken = process.env.GHPAGES_TOKEN || process.env.GITHUB_TOKEN
    if (!ghOwner || !ghRepo || !ghToken) {
      const missing: string[] = []
      if (!ghOwner) missing.push('GHPAGES_OWNER')
      if (!ghRepo) missing.push('GHPAGES_REPO')
      if (!ghToken) missing.push('GHPAGES_TOKEN or GITHUB_TOKEN')
      console.error(
        `PUBLISHER=gh-pages is missing required env var(s): ${missing.join(', ')}\n` +
        `Set these in your shell or GitHub Actions secrets. Example: GHPAGES_OWNER=your-user, GHPAGES_REPO=your-repo.`,
      )
      process.exit(1)
    }
    const ghp = new GitHubPagesPublisher()
    try {
      await ghp.init({ token: ghToken, owner: ghOwner, repo: ghRepo, branch: ghBranch, dir: ghRepoDir, baseUrl, siteTitle: process.env.SITE_TITLE, siteSubtitle: process.env.SITE_SUBTITLE })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        'GitHub Pages publisher initialization failed.\n' +
          msg +
          (process.env.GITHUB_ACTIONS
            ? '\nIf running in Actions, ensure workflow permissions include: permissions:\n  contents: write'
            : ''),
      )
      process.exit(1)
    }
    publisher = ghp
    if (shouldIndexOnly(indexOnly)) {
      console.log('Refreshed gh-pages scaffold only (--index-only).')
      return
    }
  } else if (pubKind === 'none') {
    publisher = undefined
  } else {
    console.warn(`Unknown PUBLISHER="${pubKind}", defaulting to "fs"`)
    publisher = new FileSystemPublisher()
    await publisher.init({ outDir: fsOutDir, baseUrl })
  }

  // Connectors
  const connectors: Connector<unknown>[] = []
  const ghToken = process.env.GITHUB_TOKEN
  const ghReposEnv = process.env.GITHUB_REPOS
  if (ghToken && ghReposEnv) {
    const gh = new GitHubConnector()
    const repos = ghReposEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    await gh.init({ token: ghToken, repos })
    connectors.push(gh)
  }

  // Helper to run a single cycle (pull facts, group, publish, persist)
  const runCycle = async () => {
    // Determine since and capture previous facts for new-facts diffing
    const prev: ProjectState = (await storage.readState()) ?? { facts: [] as Fact[], lastRunAt: undefined }
    const since = prev.lastRunAt ?? '1970-01-01T00:00:00.000Z'

    // First, run pipeline to pull, convert, merge, and persist facts (no publish yet)
    const res = await runOnce({ connectors, storage })

    // Group new facts into windows (default 12 hours) and publish one update per group
    const baseNow = Date.now()
    const nowIso = new Date(baseNow).toISOString()
    // New facts are those not present by id in the previous state. This avoids
    // missing commits that were authored earlier but pushed after the last run.
    const prevIds = new Set((prev.facts ?? []).map((f) => f.id))
    const newFacts = (res.state.facts ?? [])
      .filter((f) => !prevIds.has(f.id))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    // Allow env to set default window if flag not provided
    const envWindow = Number(process.env.WINDOW_HOURS || '')
    const windowHours = windowHoursFlag && windowHoursFlag > 0 ? windowHoursFlag : Number.isFinite(envWindow) && envWindow > 0 ? envWindow : 12
    const windowMs = windowHours * 60 * 60 * 1000

    // Use an effective timestamp for grouping that treats newly discovered commits
    // (with old commit dates) as occurring "now" for grouping purposes.
    type GroupItem = { f: Fact; t: string }
    const items: GroupItem[] = newFacts
      .map((f) => ({ f, t: f.occurredAt < since ? nowIso : f.occurredAt }))
      .sort((a, b) => a.t.localeCompare(b.t))

    const groups: GroupItem[][] = []
    for (const it of items) {
      if (!groups.length) {
        groups.push([it])
        continue
      }
      const current = groups[groups.length - 1]
      const firstIso = current[0].t
      const span = new Date(it.t).getTime() - new Date(firstIso).getTime()
      if (span <= windowMs) {
        current.push(it)
      } else {
        groups.push([it])
      }
    }

    const publishOnlySummary = String(process.env.PUBLISH_ONLY_SUMMARY || '').toLowerCase() === 'true'
    const openaiKey = process.env.OPENAI_API_KEY
    const summaryModel = process.env.AI_SUMMARY_MODEL || 'gpt-4o-mini'
    const publishAISummary = String(
      process.env.PUBLISH_AI_SUMMARY ?? (publishOnlySummary ? 'true' : ''),
    ).toLowerCase() === 'true'
    const summarySystemPrompt =
      process.env.AI_SUMMARY_PROMPT ||
      'You are a helpful social media manager. Write a concise, upbeat project status update from the provided context. Target: 1-3 sentences. Be clear and specific. Avoid hashtags unless essential. Include key changes (commits, issues, PRs).'
    const aiIncludeBodies = String(process.env.AI_INCLUDE_BODIES || 'true').toLowerCase() !== 'false'
    const aiMaxComments = Number(process.env.AI_MAX_COMMENTS || '3')
    const aiMaxContextChars = Number(process.env.AI_MAX_CONTEXT_CHARS || '2000')

    let published: { id: string; url?: string } | undefined
    const publishedItems: { id: string; url?: string }[] = []
    let aiSummary: string | undefined
    let aiSummaryPublished: { id: string; url?: string } | undefined
    const aiSummaryPublishedItems: { id: string; url?: string }[] = []

    for (let i = 0; i < groups.length; i++) {
      const facts = groups[i].map((g) => g.f)
      if (!facts.length) continue

      // Make a unique timestamp for this draft id by offsetting milliseconds
      const draftNowIso = new Date(baseNow + i).toISOString()

      // Optional: title with window range
      const startIso = groups[i][0].t
      const endIso = groups[i][groups[i].length - 1].t
      const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 16) + ' UTC'
      const title = `HypeAgent Update (${fmt(startIso)} – ${fmt(endIso)})`

      const draft = createUpdateDraft(facts, draftNowIso, title)

      // Publish content updates unless summary-only mode
      if (facts.length > 0 && publisher && !publishOnlySummary) {
        const p = await publisher.publish(draft, res.state)
        published = p
        publishedItems.push(p)
      }

      // AI summary per group
      if (shouldGenerateAiSummary(openaiKey, facts.length > 0, noAi)) {
        const client = new OpenAI({ apiKey: openaiKey })
        const ghConnector = connectors.find((c): c is GitHubConnector => c instanceof GitHubConnector)
        let detailsMd = ''
        if (ghConnector) {
          try {
            const details = await ghConnector.fetchDetails(facts, {
              includeBodies: aiIncludeBodies,
              maxComments: aiMaxComments,
              maxChars: aiMaxContextChars,
            })
            const lines: string[] = []
            for (const f of facts) {
              const t = details[f.id]
              if (t) {
                lines.push(`### ${f.summary}`)
                lines.push('')
                lines.push(t)
                lines.push('')
              }
            }
            if (lines.length) {
              detailsMd = `\n\n## Details\n\n${lines.join('\n')}`
            }
          } catch (err) {
            void err
          }
        }
        const prompt = [
          { role: 'system' as const, content: `${summarySystemPrompt}\n\nRespond strictly as minified JSON with keys: title (short, human, catchy), summary (1-3 sentences). No markdown, no code fences.` },
          {
            role: 'user' as const,
            content: `Timezone: ${cfg.TIMEZONE}\nNow: ${draftNowIso}\n\nContext markdown:\n\n${draft.markdown}${detailsMd}`,
          },
        ]
        try {
          const resp = await client.chat.completions.create({
            model: summaryModel,
            temperature: 0.5,
            max_tokens: 200,
            messages: prompt,
          })
          const raw = resp.choices?.[0]?.message?.content?.trim() || ''
          let aiTitle: string | undefined
          try {
            const start = raw.indexOf('{')
            const end = raw.lastIndexOf('}')
            const jsonStr = start >= 0 && end >= start ? raw.slice(start, end + 1) : raw
            const parsed = JSON.parse(jsonStr) as { title?: string; summary?: string }
            aiTitle = parsed.title?.trim() || undefined
            aiSummary = parsed.summary?.trim() || undefined
          } catch {
            aiSummary = raw || undefined
            aiTitle = undefined
          }
          if (aiSummary && publishAISummary && publisher) {
            const summaryDraft = {
              id: `${draft.id}-summary`,
              title: aiTitle || 'Project Update',
              createdAt: draftNowIso,
              markdown: `${aiSummary}\n`,
              citations: [],
            }
            aiSummaryPublished = await publisher.publish(summaryDraft, res.state)
            aiSummaryPublishedItems.push(aiSummaryPublished)
          }
        } catch (err) {
          console.error('AI summary generation failed:', err)
        }
      }
    }

    // basic output
    console.log(
      JSON.stringify(
        {
          timezone: cfg.TIMEZONE,
          stateFile,
          newFacts: res.newFacts,
          lastRunAt: res.state.lastRunAt,
          windowHours,
          groups: groups.map((g) => g.length),
          published,
          publishedItems,
          aiSummary,
          aiSummaryPublished,
          aiSummaryPublishedItems,
        },
        null,
        2,
      ),
    )
  }

  // Run immediately once
  await runCycle()

  // Watch mode: loop with interval if enabled
  const envIntervalMin = Number(process.env.RUN_INTERVAL_MINUTES || '')
  const intervalMinutes = intervalMinutesFlag && intervalMinutesFlag > 0
    ? intervalMinutesFlag
    : Number.isFinite(envIntervalMin) && envIntervalMin > 0
      ? envIntervalMin
      : undefined
  const watchEnabled = watch || intervalMinutes != null
  if (watchEnabled) {
    const effectiveMinutes = intervalMinutes ?? 15
    const intervalMs = effectiveMinutes * 60 * 1000
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    console.log(`Watch mode enabled. Re-running every ${effectiveMinutes} minute(s). Press Ctrl+C to exit.`)
    // Loop forever until process is terminated
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await sleep(intervalMs)
      await runCycle()
    }
  }

}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
