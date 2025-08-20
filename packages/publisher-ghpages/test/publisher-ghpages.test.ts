import { describe, it, expect } from 'vitest'
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
    ;(pub as any).owner = 'owner'
    ;(pub as any).repo = 'repo'
    ;(pub as any).branch = 'gh-pages'
    ;(pub as any).dir = 'updates'

    let createdArgs: any | undefined
    const err404: any = new Error('Not Found')
    err404.status = 404
    ;(pub as any).octokit = {
      repos: {
        getContent: async () => { throw err404 },
        createOrUpdateFileContents: async (args: any) => {
          createdArgs = args
          return {}
        },
      },
    }

    const res = await pub.publish(
      {
        id: 'update-2025-08-20T18:36:46.095Z-summary',
        createdAt: '2025-08-20T18:36:46.095Z',
        title: 'Profile "Field" Fix Complete',
        markdown: '# Profile "Field" Fix Complete\nBody here',
        citations: [],
      },
      { facts: [] } as any,
    )

    expect(res.id).toBe('update-2025-08-20T18:36:46.095Z-summary')
    expect(createdArgs).toBeTruthy()
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
    ;(pub as any).owner = 'owner'
    ;(pub as any).repo = 'repo'
    ;(pub as any).branch = 'gh-pages'
    ;(pub as any).dir = 'updates'
    ;(pub as any).octokit = {
      repos: {
        getContent: async () => { const e: any = new Error('Not Found'); e.status = 404; throw e },
        createOrUpdateFileContents: async () => ({}),
      },
    }

    const r1 = await pub.publish(
      { id: 'abc', createdAt: '2020-01-01T00:00:00Z', markdown: 'x', citations: [] },
      { facts: [] } as any,
    )
    expect(r1.url).toBe('https://owner.github.io/repo/updates/abc.html')

    ;(pub as any).baseUrl = 'https://example.com/updates'
    const r2 = await pub.publish(
      { id: 'def', createdAt: '2020-01-01T00:00:00Z', markdown: 'y', citations: [] },
      { facts: [] } as any,
    )
    expect(r2.url).toBe('https://example.com/updates/def.html')
  })

  it('scaffolds index with robust title extraction and body segmentation', async () => {
    const pub = new GitHubPagesPublisher()
    const captured: Record<string, string> = {}
    // Override ensureFile to capture content without network
    ;(pub as any).ensureFile = async (path: string, content: string) => {
      captured[path] = content
    }
    // Call private method directly to build templates
    await (pub as any).ensureJekyllScaffold()
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
})
