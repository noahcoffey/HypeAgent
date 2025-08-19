#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv'
import path from 'path'
import { loadEnvConfig, FileSystemStorage, runOnce, createUpdateDraft } from '@hypeagent/core'
import { FileSystemPublisher } from '@hypeagent/publisher-fs'
import { GitHubConnector } from '@hypeagent/github'

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

  // basic output
  console.log(
    JSON.stringify(
      {
        timezone: cfg.TIMEZONE,
        stateFile,
        newFacts: res.newFacts,
        lastRunAt: res.state.lastRunAt,
        published,
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
