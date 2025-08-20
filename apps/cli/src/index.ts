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
import { parseFlags, shouldGenerateAiSummary, shouldIndexOnly } from './flags'

async function main() {
  loadDotenv()
  const cfg = loadEnvConfig()
  // Simple CLI flags
  const { noAi, indexOnly } = parseFlags(process.argv.slice(2))

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
      await ghp.init({ token: ghToken, owner: ghOwner, repo: ghRepo, branch: ghBranch, dir: ghRepoDir, baseUrl })
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

  // Determine since based on previous state to compute "new facts" for this run
  const prev: ProjectState = (await storage.readState()) ?? { facts: [] as Fact[], lastRunAt: undefined }
  const since = prev.lastRunAt ?? '1970-01-01T00:00:00.000Z'

  // First, run pipeline to pull, convert, merge, and persist facts (no publish yet)
  const res = await runOnce({ connectors, storage })

  // Build the draft from the new facts (those that occurred at or after 'since')
  const nowIso = new Date().toISOString()
  const newFacts = (res.state.facts ?? []).filter((f) => f.occurredAt >= since)
  const draft = createUpdateDraft(newFacts, nowIso, 'HypeAgent Update')

  // Only publish if we have any new facts to report
  let published: { id: string; url?: string } | undefined
  const publishOnlySummary = String(process.env.PUBLISH_ONLY_SUMMARY || '').toLowerCase() === 'true'
  if (newFacts.length > 0 && publisher && !publishOnlySummary) {
    published = await publisher.publish(draft, res.state)
  }

  // Optional: generate an AI summary of the update content for social posting
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
  let aiSummary: string | undefined
  let aiTitle: string | undefined
  let aiSummaryPublished: { id: string; url?: string } | undefined
  if (shouldGenerateAiSummary(openaiKey, newFacts.length > 0, noAi)) {
    const client = new OpenAI({ apiKey: openaiKey })
    // Try to fetch richer details for the facts from the GitHub connector (if present)
    const ghConnector = connectors.find((c): c is GitHubConnector => c instanceof GitHubConnector)
    let detailsMd = ''
    if (ghConnector) {
      try {
        const details = await ghConnector.fetchDetails(newFacts, {
          includeBodies: aiIncludeBodies,
          maxComments: aiMaxComments,
          maxChars: aiMaxContextChars,
        })
        const lines: string[] = []
        for (const f of newFacts) {
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
        // details are optional; continue without them
        void err
      }
    }
    const prompt = [
      { role: 'system' as const, content: `${summarySystemPrompt}\n\nRespond strictly as minified JSON with keys: title (short, human, catchy), summary (1-3 sentences). No markdown, no code fences.` },
      {
        role: 'user' as const,
        content: `Timezone: ${cfg.TIMEZONE}\nNow: ${nowIso}\n\nContext markdown:\n\n${draft.markdown}${detailsMd}`,
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
      try {
        // try to parse JSON from the response
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
          createdAt: nowIso,
          markdown: `${aiSummary}\n`,
          citations: [],
        }
        aiSummaryPublished = await publisher.publish(summaryDraft, res.state)
      }
    } catch (err) {
      console.error('AI summary generation failed:', err)
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
        published,
        aiSummary,
        aiSummaryPublished,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
