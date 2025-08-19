import { Octokit } from '@octokit/rest'
import type { Connector, Event, Fact, ISODateTime } from '@hypeagent/core'

export interface GitHubConnectorConfig {
  token: string
  repos: string[] // e.g., ["owner/repo", "owner2/repo2"]
}

export function mapEventToFact(e: Event): Fact {
  if (e.kind === 'commit') {
    const payload = (e.payload ?? {}) as Record<string, unknown>
    const sha = String(payload.sha ?? '').slice(0, 7)
    const message = String(payload.message ?? '').split('\n')[0]
    const summary = sha ? `Commit ${sha}: ${message}` : `Commit: ${message}`
    return {
      id: e.id,
      kind: e.kind,
      summary,
      occurredAt: e.occurredAt,
      source: 'github',
      url: e.url,
      data: payload,
    }
  }

  return {
    id: e.id,
    kind: e.kind,
    summary: `GitHub: ${e.kind}`,
    occurredAt: e.occurredAt,
    source: 'github',
    url: e.url,
  }
}

export class GitHubConnector implements Connector<GitHubConnectorConfig> {
  private octokit: Octokit | null = null
  private repos: Array<{ owner: string; repo: string }> = []

  async init(config: GitHubConnectorConfig): Promise<void> {
    this.octokit = new Octokit({ auth: config.token })
    this.repos = config.repos
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [owner, repo] = r.split('/')
        return owner && repo ? { owner, repo } : undefined
      })
      .filter((x): x is { owner: string; repo: string } => Boolean(x))
  }

  async pullSince(sinceIso: ISODateTime): Promise<Event[]> {
    if (!this.octokit) throw new Error('GitHubConnector not initialized')
    const out: Event[] = []
    for (const { owner, repo } of this.repos) {
      // Fetch issues and PRs updated since; first page is enough for a minimal implementation
      const res = await this.octokit.issues.listForRepo({ owner, repo, state: 'all', since: sinceIso, per_page: 50 })
      for (const it of res.data) {
        const isPR = Boolean(it.pull_request)
        const kind = isPR ? 'pr_updated' : 'issue_updated'
        const occurredAt = it.updated_at ?? it.created_at ?? sinceIso
        out.push({
          id: `gh-${it.id}`,
          source: 'github',
          kind,
          occurredAt,
          payload: {
            number: it.number,
            title: it.title,
            state: it.state,
            isPR,
            repo: `${owner}/${repo}`,
          },
          url: it.html_url,
        })
      }

      // Fetch commits since
      const commits = await this.octokit.repos.listCommits({ owner, repo, since: sinceIso, per_page: 50 })
      for (const c of commits.data) {
        const occurredAt = c.commit.author?.date ?? c.commit.committer?.date ?? sinceIso
        out.push({
          id: `gh-commit-${c.sha}`,
          source: 'github',
          kind: 'commit',
          occurredAt,
          payload: {
            sha: c.sha,
            message: c.commit.message,
            author: c.commit.author?.name,
            repo: `${owner}/${repo}`,
          },
          url: c.html_url,
        })
      }
    }
    return out
  }

  async toFacts(events: Event[]): Promise<Fact[]> {
    return events.map(mapEventToFact)
  }
}
