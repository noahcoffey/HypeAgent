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

  // Issue / PR updates
  const payload = (e.payload ?? {}) as Record<string, unknown>
  const isPR = Boolean(payload.isPR)
  const number = typeof payload.number === 'number' ? payload.number : undefined
  const title = typeof payload.title === 'string' ? payload.title : undefined
  const state = typeof payload.state === 'string' ? payload.state : undefined
  const repo = typeof payload.repo === 'string' ? payload.repo : undefined
  const kindLabel = isPR ? 'PR' : 'Issue'
  const numStr = number != null ? ` #${number}` : ''
  const titleStr = title ? `: ${title}` : ''
  const stateStr = state ? ` [${state}]` : ''
  return {
    id: e.id,
    kind: e.kind,
    summary: `${kindLabel}${numStr}${titleStr}${stateStr}`.trim(),
    occurredAt: e.occurredAt,
    source: 'github',
    url: e.url,
    data: { number, title, state, isPR, repo },
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

  // Fetch richer details for facts to provide better AI context.
  async fetchDetails(
    facts: Fact[],
    opts?: { includeBodies?: boolean; maxComments?: number; maxChars?: number }
  ): Promise<Record<string, string>> {
    if (!this.octokit) throw new Error('GitHubConnector not initialized')
    const includeBodies = opts?.includeBodies ?? true
    const maxComments = opts?.maxComments ?? 3
    const maxChars = opts?.maxChars ?? 2000
    const trim = (s: string | undefined, n: number) => (s ? (s.length > n ? s.slice(0, n) + '…' : s) : '')

    const details: Record<string, string> = {}
    for (const f of facts) {
      const data = (f.data ?? {}) as Record<string, unknown>
      const repoFull = typeof data['repo'] === 'string' ? (data['repo'] as string) : undefined
      if (!repoFull) continue
      const [owner, repo] = repoFull.split('/')
      if (!owner || !repo) continue

      try {
        if (f.kind === 'commit') {
          const sha = typeof data['sha'] === 'string' ? (data['sha'] as string) : undefined
          if (!sha) continue
          const c = await this.withRetry(() => this.octokit!.repos.getCommit({ owner, repo, ref: sha }))
          const message = trim(c.data.commit.message ?? '', maxChars)
          const filesChanged = Array.isArray(c.data.files) ? c.data.files.length : undefined
          const additions = (c.data.stats?.additions as number | undefined) ?? undefined
          const deletions = (c.data.stats?.deletions as number | undefined) ?? undefined
          const statsLine =
            filesChanged != null || additions != null || deletions != null
              ? `\nFiles changed: ${filesChanged ?? '?'} (+${additions ?? 0}/-${deletions ?? 0})`
              : ''
          details[f.id] = `Commit ${sha}\n${message}${statsLine}`.trim()
        } else {
          const isPR = Boolean(data['isPR'])
          const number = typeof data['number'] === 'number' ? (data['number'] as number) : undefined
          if (!number) continue
          if (isPR) {
            const pr = await this.withRetry(() => this.octokit!.pulls.get({ owner, repo, pull_number: number }))
            const body = includeBodies ? trim(pr.data.body ?? '', maxChars) : ''
            // Use issue comments API for PR discussion comments
            const commentsResp =
              maxComments > 0
                ? await this.withRetry(() =>
                    this.octokit!.issues.listComments({ owner, repo, issue_number: number, per_page: maxComments })
                  )
                : undefined
            const comments = commentsResp?.data ?? []
            const commentLines = Array.isArray(comments)
              ? comments
                  .slice(-maxComments)
                  .map((c: any) => `- ${trim(c.user?.login ?? 'user', 40)}: ${trim(c.body ?? '', 300)}`)
              : []
            const commentsBlock = commentLines.length ? `\nRecent comments:\n${commentLines.join('\n')}` : ''
            details[f.id] = [`PR #${number}: ${pr.data.title ?? ''}`, body && `\n${body}`, commentsBlock]
              .filter(Boolean)
              .join('')
              .trim()
          } else {
            const issue = await this.withRetry(() => this.octokit!.issues.get({ owner, repo, issue_number: number }))
            const body = includeBodies ? trim(issue.data.body ?? '', maxChars) : ''
            const commentsResp =
              maxComments > 0
                ? await this.withRetry(() =>
                    this.octokit!.issues.listComments({ owner, repo, issue_number: number, per_page: maxComments })
                  )
                : undefined
            const comments = commentsResp?.data ?? []
            const commentLines = Array.isArray(comments)
              ? comments
                  .slice(-maxComments)
                  .map((c: any) => `- ${trim(c.user?.login ?? 'user', 40)}: ${trim(c.body ?? '', 300)}`)
              : []
            const commentsBlock = commentLines.length ? `\nRecent comments:\n${commentLines.join('\n')}` : ''
            details[f.id] = [`Issue #${number}: ${issue.data.title ?? ''}`, body && `\n${body}`, commentsBlock]
              .filter(Boolean)
              .join('')
              .trim()
          }
        }
      } catch (err) {
        // Swallow detail fetch errors; details are optional for AI context
        void err
      }
    }
    return details
  }
}
