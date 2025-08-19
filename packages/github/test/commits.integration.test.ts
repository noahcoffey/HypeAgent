import { describe, test, expect } from 'vitest'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { GitHubConnector } from '../src/index'
import { createUpdateDraft } from '@hypeagent/core'
import type { ProjectState, UpdateDraft, Connector } from '@hypeagent/core'
import type { Storage } from '@hypeagent/core'

class InMemoryStorage implements Storage {
  private _state: ProjectState | undefined
  async readState(): Promise<ProjectState | undefined> {
    return this._state
  }
  async writeState(state: ProjectState): Promise<void> {
    this._state = JSON.parse(JSON.stringify(state))
  }
}

class LocalFsPublisher {
  private outDir!: string
  async init(config: { outDir: string }): Promise<void> {
    this.outDir = config.outDir
    await fs.mkdir(this.outDir, { recursive: true })
  }
  async publish(update: UpdateDraft, _state: ProjectState): Promise<{ id: string; url?: string }> {
    void _state
    const safeId = update.id.replace(/[^a-zA-Z0-9_-]/g, '-')
    const file = path.join(this.outDir, `${safeId}.md`)
    const frontmatterLines = [
      '---',
      `id: ${update.id}`,
      update.title ? `title: ${update.title}` : undefined,
      `createdAt: ${update.createdAt}`,
      update.citations?.length ? `citations: ${update.citations.length}` : undefined,
      '---',
      '',
    ].filter(Boolean) as string[]
    const content = frontmatterLines.join('\n') + update.markdown + '\n'
    await fs.writeFile(file, content, 'utf8')
    return { id: update.id }
  }
}

// Only run if creds and repo provided
const shouldRun = Boolean(process.env.GITHUB_TOKEN && process.env.TEST_GITHUB_REPO)

describe.runIf(shouldRun)('github commits integration', () => {
  test('pulls commits since, generates draft, and writes markdown', async () => {
    const token = process.env.GITHUB_TOKEN!
    const repo = process.env.TEST_GITHUB_REPO!

    const gh = new GitHubConnector()
    await gh.init({ token, repos: [repo] })

    // pull commits from the last 7 days
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const events = await gh.pullSince(since)
    const facts = await gh.toFacts(events)

    // filter commit facts (connector now emits kind==='commit')
    const commitFacts = facts.filter((f) => f.kind === 'commit')

    // create a draft
    const nowIso = new Date().toISOString()
    const draft: UpdateDraft = createUpdateDraft(commitFacts, nowIso, 'Weekly Commits')

    // publisher to temp dir
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hypeagent-commits-'))
    const publisher = new LocalFsPublisher()
    await publisher.init({ outDir: tmp })

    // in-memory state
    const storage = new InMemoryStorage()

    // run pipeline once
    const { runOnce } = await import('@hypeagent/core')
    const res = await runOnce({ connectors: [gh as unknown as Connector<unknown>], storage, publisher: { instance: publisher, draft } })

    expect(res.published?.id).toBe(draft.id)

    // ensure a file exists in tmp
    const files = await fs.readdir(tmp)
    expect(files.length).toBeGreaterThan(0)

    // basic content check
    const filePath = path.join(tmp, files[0])
    const content = await fs.readFile(filePath, 'utf8')
    expect(content).toContain('# Update')
    if (commitFacts.length > 0) {
      // first line should include the first commit summary or ID
      const first = commitFacts[0]
      const sha7 = String(first.data?.sha ?? '').slice(0, 7)
      if (sha7) expect(content).toContain(sha7)
    }
  }, 90_000)
})
