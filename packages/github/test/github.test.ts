import { describe, it, expect, vi } from 'vitest'
import { mapEventToFact, GitHubConnector } from '../src/index'
import type { Event } from '@hypeagent/core'

describe('@hypeagent/github', () => {
  it('maps Event to Fact as expected', () => {
    const e: Event = {
      id: 'e1',
      source: 'github',
      kind: 'issue_opened',
      occurredAt: '2024-01-01T00:00:00.000Z',
      payload: {},
      url: 'https://github.com/org/repo/issues/1',
    }
    const f = mapEventToFact(e)
    expect(f.id).toBe('e1')
    expect(f.kind).toBe('issue_opened')
    expect(f.source).toBe('github')
    expect(f.url).toBe(e.url)
  })

  it('requests commits for each configured branch', async () => {
    const listForRepo = vi.fn().mockResolvedValue({ data: [] })
    const listCommits = vi.fn().mockResolvedValue({ data: [] })
    const octokit = {
      issues: {
        listForRepo(args: unknown) {
          return listForRepo(args)
        },
      },
      repos: {
        listCommits(args: unknown) {
          return listCommits(args)
        },
      },
      paginate: vi.fn(async (fn: (opts: unknown) => Promise<unknown>, opts: unknown) => {
        const res = await fn.call(octokit, opts)
        return (res as { data?: unknown[] }).data ?? []
      }),
    }

    const gh = new GitHubConnector()
    ;(gh as unknown as { octokit: typeof octokit }).octokit = octokit as never
    ;(gh as unknown as { repos: Array<{ owner: string; repo: string; branch?: string }> }).repos = [
      { owner: 'hype', repo: 'agent', branch: 'main' },
      { owner: 'hype', repo: 'agent', branch: 'dev' },
      { owner: 'hype', repo: 'agent', branch: 'feature@v2' },
    ]

    const events = await gh.pullSince('2024-01-01T00:00:00.000Z')
    expect(events.length).toBe(0)
    expect(listCommits).toHaveBeenCalledWith({ owner: 'hype', repo: 'agent', per_page: 100, sha: 'main' })
    expect(listCommits).toHaveBeenCalledWith({ owner: 'hype', repo: 'agent', per_page: 100, sha: 'dev' })
    expect(listCommits).toHaveBeenCalledWith({ owner: 'hype', repo: 'agent', per_page: 100, sha: 'feature@v2' })
  })
})
