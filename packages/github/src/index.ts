import { Octokit } from '@octokit/rest'
import type { Connector, Event, Fact, ISODateTime } from '@hypeagent/core'

export interface GitHubConnectorConfig {
  token: string
  // Supports optional branch suffix: "owner/repo@branch"
  repos: string[] // e.g., ["owner/repo", "owner2/repo2@main"]
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
  private repos: Array<{ owner: string; repo: string; branch?: string }> = []

  private async withRetry<T>(fn: () => Promise<T>, attempt = 1): Promise<T> {
    try {
      return await fn()
    } catch (err: any) {
      const status: number | undefined = err?.status
      const isRateLimited = status === 403 || status === 429
      if (attempt >= 3 || !isRateLimited) throw err
      // Exponential backoff with jitter
      const base = 1000 * attempt * attempt
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, base + jitter))
      return this.withRetry(fn, attempt + 1)
    }
  }

  async init(config: GitHubConnectorConfig): Promise<void> {
    this.octokit = new Octokit({ auth: config.token })
    this.repos = config.repos.reduce<Array<{ owner: string; repo: string; branch?: string }>>((acc, raw) => {
      const r = raw.trim()
      if (!r) return acc
      const [repoPart, branch] = r.split('@')
      const [owner, repo] = repoPart.split('/')
      if (!owner || !repo) return acc
      acc.push({ owner, repo, ...(branch ? { branch } : {}) })
      return acc
    }, [])
  }

  async pullSince(sinceIso: ISODateTime): Promise<Event[]> {
    if (!this.octokit) throw new Error('GitHubConnector not initialized')
    const out: Event[] = []
    for (const { owner, repo } of this.repos) {
      // Fetch issues and PRs updated since (paginated)
      const issues = await this.withRetry(() =>
        this.octokit!.paginate(this.octokit!.issues.listForRepo, {
          owner,
          repo,
          state: 'all',
          since: sinceIso,
          per_page: 100,
        })
      )
      for (const it of issues) {
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

      // Fetch commits since (paginated), optionally filter to branch
      const repoEntry = this.repos.find((r) => r.owner === owner && r.repo === repo)
      const sha = repoEntry?.branch
      const commits = await this.withRetry(() =>
        this.octokit!.paginate(this.octokit!.repos.listCommits, {
          owner,
          repo,
          since: sinceIso,
          per_page: 100,
          ...(sha ? { sha } : {}),
        })
      )
      for (const c of commits) {
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
