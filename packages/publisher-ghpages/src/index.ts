import { Octokit } from '@octokit/rest'
import type { Publisher, ProjectState, UpdateDraft } from '@hypeagent/core'

export interface GhPagesPublisherConfig {
  token: string
  owner: string
  repo: string
  branch?: string // default: gh-pages
  dir?: string // default: updates
  baseUrl?: string // optional override for public URL (else derive)
}

export class GitHubPagesPublisher implements Publisher<GhPagesPublisherConfig> {
  private octokit!: Octokit
  private owner!: string
  private repo!: string
  private branch: string = 'gh-pages'
  private dir: string = 'updates'
  private baseUrl?: string

  async init(config: GhPagesPublisherConfig): Promise<void> {
    this.octokit = new Octokit({ auth: config.token })
    this.owner = config.owner
    this.repo = config.repo
    this.branch = config.branch || 'gh-pages'
    this.dir = config.dir || 'updates'
    this.baseUrl = config.baseUrl

    await this.ensureBranchExists()
  }

  private async ensureBranchExists(): Promise<void> {
    // Check if target branch exists
    try {
      await this.octokit.git.getRef({ owner: this.owner, repo: this.repo, ref: `heads/${this.branch}` })
      return
    } catch (err: unknown) {
      const status = typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined
      if (status !== 404) throw err
    }

    // Create branch from default branch's latest commit
    const repoInfo = await this.octokit.repos.get({ owner: this.owner, repo: this.repo })
    const defaultBranch = repoInfo.data.default_branch
    const baseRef = await this.octokit.git.getRef({ owner: this.owner, repo: this.repo, ref: `heads/${defaultBranch}` })
    const sha = baseRef.data.object.sha
    await this.octokit.git.createRef({ owner: this.owner, repo: this.repo, ref: `refs/heads/${this.branch}`, sha })
  }

  private safeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '-')
  }

  private derivePublicUrl(fileName: string): string | undefined {
    if (this.baseUrl) {
      return `${this.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(fileName)}`
    }
    // Derive standard GitHub Pages URL
    return `https://${this.owner}.github.io/${this.repo}/${this.dir}/${encodeURIComponent(fileName)}`
  }

  async publish(update: UpdateDraft, _state: ProjectState): Promise<{ id: string; url?: string }> {
    void _state
    const safeId = this.safeId(update.id)
    const path = `${this.dir}/${safeId}.md`

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
    const contentB64 = Buffer.from(content, 'utf8').toString('base64')

    // Check if file exists to get current sha
    let sha: string | undefined
    try {
      const existing = await this.octokit.repos.getContent({ owner: this.owner, repo: this.repo, path, ref: this.branch })
      // "getContent" can return array or object; ensure it's a file
      if (!Array.isArray(existing.data) && 'sha' in existing.data) {
        sha = (existing.data as { sha?: string }).sha
      }
    } catch (err: unknown) {
      const status = typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined
      if (status !== 404) throw err
    }

    await this.octokit.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      branch: this.branch,
      message: `HypeAgent: publish update ${update.id}`,
      content: contentB64,
      ...(sha ? { sha } : {}),
    })

    const url = this.derivePublicUrl(`${safeId}.md`)
    return { id: update.id, url }
  }
}
