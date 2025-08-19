#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv'
import path from 'path'
import { loadEnvConfig, FileSystemStorage, runOnce, createUpdateDraft } from '@hypeagent/core'
import { FileSystemPublisher } from '@hypeagent/publisher-fs'
import { GitHubConnector } from '@hypeagent/github'
import OpenAI from 'openai'

async function main() {
  loadDotenv()
  const cfg = loadEnvConfig()

  const stateFile = process.env.STATE_FILE || path.join(process.cwd(), '.hypeagent', 'state.json')
  const storage = new FileSystemStorage(stateFile)

  // Filesystem publisher
  const outDir = process.env.PUBLISH_OUT_DIR || path.join(process.cwd(), 'updates')
  const baseUrl = process.env.PUBLISH_BASE_URL
  const publisher = new FileSystemPublisher()
  await publisher.init({ outDir, baseUrl })

  // Connectors
  const connectors = []
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
  const prev = (await storage.readState()) ?? { facts: [] as any[] as any, lastRunAt: undefined as string | undefined }
  const since = prev.lastRunAt ?? '1970-01-01T00:00:00.000Z'

  // First, run pipeline to pull, convert, merge, and persist facts (no publish yet)
  const res = await runOnce({ connectors, storage })

  // Build the draft from the new facts (those that occurred at or after 'since')
  const nowIso = new Date().toISOString()
  const newFacts = (res.state.facts ?? []).filter((f) => f.occurredAt >= since)
  const draft = createUpdateDraft(newFacts, nowIso, 'HypeAgent Update')

  // Only publish if we have any new facts to report
  let published: { id: string; url?: string } | undefined
  if (newFacts.length > 0) {
    published = await publisher.publish(draft, res.state)
  }

  // Optional: generate an AI summary of the update content for social posting
  const openaiKey = process.env.OPENAI_API_KEY
  const summaryModel = process.env.AI_SUMMARY_MODEL || 'gpt-4o-mini'
  const publishAISummary = String(process.env.PUBLISH_AI_SUMMARY || '').toLowerCase() === 'true'
  const summarySystemPrompt =
    process.env.AI_SUMMARY_PROMPT ||
    'You are a helpful social media manager. Write a concise, upbeat project status update from the provided context. Target: 1-3 sentences. Be clear and specific. Avoid hashtags unless essential. Include key changes (commits, issues, PRs).'
  let aiSummary: string | undefined
  let aiSummaryPublished: { id: string; url?: string } | undefined
  if (openaiKey && newFacts.length > 0) {
    const client = new OpenAI({ apiKey: openaiKey })
    const prompt = [
      { role: 'system' as const, content: summarySystemPrompt },
      {
        role: 'user' as const,
        content: `Timezone: ${cfg.TIMEZONE}\nNow: ${nowIso}\n\nContext markdown:\n\n${draft.markdown}`,
      },
    ]
    try {
      const resp = await client.chat.completions.create({
        model: summaryModel,
        temperature: 0.5,
        max_tokens: 200,
        messages: prompt,
      })
      aiSummary = resp.choices?.[0]?.message?.content?.trim() || undefined
      if (aiSummary && publishAISummary) {
        const summaryDraft = {
          id: `${draft.id}-summary`,
          title: `${draft.title ?? 'Update'} — AI Summary`,
          createdAt: nowIso,
          markdown: `# AI Summary\n\n${aiSummary}\n`,
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
