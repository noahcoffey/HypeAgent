import { describe, it, expect } from 'vitest'
import type { ProjectState } from '@hypeagent/core'
import { GitHubPagesPublisher } from '../src/index'

// This is a smoke test for construction; network calls are skipped.
describe('@hypeagent/publisher-ghpages', () => {
  it.skip('publishes an update to gh-pages (integration)', async () => {
    const token = process.env.GHPAGES_TOKEN || process.env.GITHUB_TOKEN
    const owner = process.env.TEST_GITHUB_OWNER
    const repo = process.env.TEST_GITHUB_REPO
    if (!token || !owner || !repo) return

    const pub = new GitHubPagesPublisher()
    await pub.init({ token, owner, repo, branch: 'gh-pages', dir: 'updates' })

    const res = await pub.publish(
      {
        id: `test-${Date.now()}`,
        createdAt: new Date().toISOString(),
        markdown: '# Test Update\nHello from vitest',
        citations: [],
      },
      { facts: [] },
    )
    expect(res.id).toBeTruthy()
    expect(res.url).toBeTruthy()
  })

  it('generates markdown with correct front matter, spacing, HA markers, and permalink', async () => {
    const pub = new GitHubPagesPublisher()
    // Inject internals to avoid init/network
    Object.assign(pub as unknown as { owner: string; repo: string; branch: string; dir: string }, {
      owner: 'owner',
      repo: 'repo',
      branch: 'gh-pages',
      dir: 'updates',
    })

    type CreatedArgsCapture = { path: string; content: string }
    let createdArgs: CreatedArgsCapture | undefined
    const err404 = Object.assign(new Error('Not Found'), { status: 404 })
    type MockRepos = {
      getContent: () => Promise<never>
      createOrUpdateFileContents: (args: CreatedArgsCapture & Record<string, unknown>) => Promise<unknown>
    }
    type MockOctokit = { repos: MockRepos }
    Object.assign(pub as unknown as { octokit: MockOctokit }, {
      octokit: {
        repos: {
          getContent: async (): Promise<never> => { throw err404 },
          createOrUpdateFileContents: async (args: CreatedArgsCapture): Promise<unknown> => {
            createdArgs = args
            return {}
          },
        },
      },
    })

    const res = await pub.publish(
      {
        id: 'update-2025-08-20T18:36:46.095Z-summary',
        createdAt: '2025-08-20T18:36:46.095Z',
        title: 'Profile "Field" Fix Complete',
        markdown: '# Profile "Field" Fix Complete\nBody here',
        citations: [],
      },
      { facts: [] } as ProjectState,
    )

    expect(res.id).toBe('update-2025-08-20T18:36:46.095Z-summary')
    expect(createdArgs).toBeTruthy()
    if (!createdArgs) throw new Error('expected createdArgs to be defined')
    expect(createdArgs.path).toBe('_updates/update-2025-08-20T18-36-46-095Z-summary.md')
    const decoded = Buffer.from(createdArgs.content, 'base64').toString('utf8')

    // Front matter present and quoted title/ha_title with escaped quotes
    expect(decoded).toContain('---\n')
    expect(decoded).toContain('id: "update-2025-08-20T18:36:46.095Z-summary"')
    expect(decoded).toContain('ha_kind: summary')
    expect(decoded).toContain('title: "Profile \\"Field\\" Fix Complete"')
    expect(decoded).toContain('ha_title: "Profile \\"Field\\" Fix Complete"')
    expect(decoded).toContain('createdAt: "2025-08-20T18:36:46.095Z"')
    expect(decoded).toContain('date: "2025-08-20T18:36:46.095Z"')
    expect(decoded).toContain('permalink: updates/update-2025-08-20T18-36-46-095Z-summary.html')

    // Blank line after closing --- before HA-START
    expect(decoded).toMatch(/---\n\n<!--HA-START-->/)

    // Markers wrap content
    expect(decoded).toContain('<!--HA-START-->')
    expect(decoded).toContain('<!--HA-END-->')
    // Title block is included in body when title provided
    expect(decoded).toContain('# Profile "Field" Fix Complete')
  })

  it('returns derived URLs correctly with and without baseUrl', async () => {
    const pub = new GitHubPagesPublisher()
    Object.assign(pub as unknown as { owner: string; repo: string; branch: string; dir: string }, {
      owner: 'owner', repo: 'repo', branch: 'gh-pages', dir: 'updates',
    })
    const e404 = Object.assign(new Error('Not Found'), { status: 404 })
    type MockRepos2 = {
      getContent: () => Promise<never>
      createOrUpdateFileContents: () => Promise<unknown>
    }
    type MockOctokit2 = { repos: MockRepos2 }
    Object.assign(pub as unknown as { octokit: MockOctokit2 }, {
      octokit: {
        repos: {
          getContent: async (): Promise<never> => { throw e404 },
          createOrUpdateFileContents: async (): Promise<unknown> => ({}),
        },
      },
    })

    const r1 = await pub.publish(
      { id: 'abc', createdAt: '2020-01-01T00:00:00Z', markdown: 'x', citations: [] },
      { facts: [] } as ProjectState,
    )
    expect(r1.url).toBe('https://owner.github.io/repo/updates/abc.html')

    Object.assign(pub as unknown as { baseUrl: string }, { baseUrl: 'https://example.com/updates' })
    const r2 = await pub.publish(
      { id: 'def', createdAt: '2020-01-01T00:00:00Z', markdown: 'y', citations: [] },
      { facts: [] } as ProjectState,
    )
    expect(r2.url).toBe('https://example.com/updates/def.html')
  })

  it('scaffolds index with robust title extraction and body segmentation', async () => {
    const pub = new GitHubPagesPublisher()
    const captured: Record<string, string> = {}
    // Override ensureFile to capture content without network
    type ScaffoldWriter = {
      ensureFile: (path: string, content: string) => Promise<void>
      ensureJekyllScaffold: () => Promise<void>
    }
    Object.assign(pub as unknown as ScaffoldWriter, {
      ensureFile: async (path: string, content: string) => {
        captured[path] = content
      },
    })
    // Call private method directly to build templates
    await (pub as unknown as ScaffoldWriter).ensureJekyllScaffold()
    const index = captured['index.md']
    expect(index).toBeTruthy()

    // Has display_title chain preferring ha_title/front matter over extracted h1
    expect(index).toContain('{% assign display_title = post.ha_title | default: post.title | default: post.data.title | default: post["title"] | default: heading_text | strip | default: post.name | default: post.id %}')
    // Contains logic to slice HTML H1 and markdown H1 lines and body_only fallback
    expect(index).toContain("split: '</h1>'")
    expect(index).toContain("(lines[0] | slice: 0, 2) == '# '")
    expect(index).toContain('<!--HA-START-->')
    expect(index).toContain('<!--HA-END-->')
  })

  describe('env validation and error mapping', () => {
    it('fails init with friendly message when required config is missing', async () => {
      const pub = new GitHubPagesPublisher()
      await expect(pub.init({ token: '', owner: 'o', repo: 'r' } as unknown as { token: string; owner: string; repo: string })).rejects.toThrow(
        /missing token/i,
      )
      await expect(pub.init({ token: 't', owner: '', repo: 'r' } as unknown as { token: string; owner: string; repo: string })).rejects.toThrow(
        /missing owner/i,
      )
      await expect(pub.init({ token: 't', owner: 'o', repo: '' } as unknown as { token: string; owner: string; repo: string })).rejects.toThrow(
        /missing repo/i,
      )
    })

    it('maps Octokit write errors to actionable messages (403, 409)', async () => {
      const pub = new GitHubPagesPublisher()
      // Inject internals and mocks to avoid network
      Object.assign(pub as unknown as { owner: string; repo: string; branch: string; dir: string }, {
        owner: 'o', repo: 'r', branch: 'gh-pages', dir: 'updates',
      })

      // Mock getContent 404 (not present) and write 403
      const e404 = Object.assign(new Error('Not Found'), { status: 404 })
      const e403 = Object.assign(new Error('Forbidden'), { status: 403 })
      type MockRepos = {
        getContent: () => Promise<never>
        createOrUpdateFileContents: () => Promise<never>
      }
      type MockOctokit = { repos: MockRepos }
      Object.assign(pub as unknown as { octokit: MockOctokit }, {
        octokit: {
          repos: {
            getContent: async (): Promise<never> => { throw e404 },
            createOrUpdateFileContents: async (): Promise<never> => { throw e403 },
          },
        },
      })

      await expect(
        pub.publish(
          { id: 'x', createdAt: '2020-01-01T00:00:00Z', markdown: 'm', citations: [] },
          { facts: [] } as ProjectState,
        ),
      ).rejects.toThrow(/forbidden|permissions:\s*contents:\s*write/i)

      // Now simulate conflict on write
      const e409 = Object.assign(new Error('Conflict'), { status: 409 })
      Object.assign(pub as unknown as { octokit: MockOctokit }, {
        octokit: {
          repos: {
            getContent: async (): Promise<never> => { throw e404 },
            createOrUpdateFileContents: async (): Promise<never> => { throw e409 },
          },
        },
      })
      await expect(
        pub.publish(
          { id: 'y', createdAt: '2020-01-01T00:00:00Z', markdown: 'n', citations: [] },
          { facts: [] } as ProjectState,
        ),
      ).rejects.toThrow(/conflict/i)
    })

    it('maps ensureFile read errors (non-404) to actionable messages', async () => {
      const pub = new GitHubPagesPublisher()
      Object.assign(pub as unknown as { owner: string; repo: string; branch: string }, { owner: 'o', repo: 'r', branch: 'gh-pages' })
      const e500 = Object.assign(new Error('Internal Error'), { status: 500 })
      type MockRepos2 = { getContent: () => Promise<never>; createOrUpdateFileContents: () => Promise<unknown> }
      type MockOctokit2 = { repos: MockRepos2 }
      Object.assign(pub as unknown as { octokit: MockOctokit2 }, {
        octokit: {
          repos: {
            getContent: async (): Promise<never> => { throw e500 },
            createOrUpdateFileContents: async (): Promise<unknown> => ({}),
          },
        },
      })
      // Access private method via type cast for testing
      await expect((pub as unknown as { ensureFile: (p: string, c: string) => Promise<void> }).ensureFile('index.md', 'x')).rejects.toThrow(
        /http\s*500/i,
      )
    })
  })
})
