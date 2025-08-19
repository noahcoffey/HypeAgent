#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv'
import path from 'path'
import { loadEnvConfig, FileSystemStorage, runOnce } from '@hypeagent/core'
import { FileSystemPublisher } from '@hypeagent/publisher-fs'
import type { UpdateDraft } from '@hypeagent/core'
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

  // Minimal draft content
  const now = new Date()
  const draft: UpdateDraft = {
    id: `update-${now.toISOString()}`,
    title: 'HypeAgent Update',
    createdAt: now.toISOString(),
    markdown: `# HypeAgent Update\n\nRun at ${now.toISOString()} (${cfg.TIMEZONE}).`,
    citations: [],
  }

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

  const res = await runOnce({ connectors, storage, publisher: { instance: publisher, draft } })

  // basic output
  console.log(
    JSON.stringify(
      {
        timezone: cfg.TIMEZONE,
        stateFile,
        newFacts: res.newFacts,
        lastRunAt: res.state.lastRunAt,
        published: res.published,
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
