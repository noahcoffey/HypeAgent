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
})
