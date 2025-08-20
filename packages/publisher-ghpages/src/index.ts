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
    await this.ensureJekyllScaffold()
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
    // Jekyll outputs HTML pages; always link to .html regardless of baseUrl
    const html = fileName.replace(/\.md$/i, '.html')
    if (this.baseUrl) {
      return `${this.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(html)}`
    }
    // Derive standard GitHub Pages URL
    return `https://${this.owner}.github.io/${this.repo}/${this.dir}/${encodeURIComponent(html)}`
  }

  async publish(update: UpdateDraft, _state: ProjectState): Promise<{ id: string; url?: string }> {
    void _state
    const safeId = this.safeId(update.id)
    // Write to collection source directory so Jekyll treats these as collection items
    const path = `_${this.dir}/${safeId}.md`

    const haKind = update.id.endsWith('-summary') ? 'summary' : 'update'
    const quote = (s: string) => s.replace(/"/g, '\\"')
    const frontmatterLines = [
      '---',
      `id: "${quote(update.id)}"`,
      `ha_kind: ${haKind}`,
      update.title ? `title: "${quote(update.title)}"` : undefined,
      update.title ? `ha_title: "${quote(update.title)}"` : undefined,
      `createdAt: "${update.createdAt}"`,
      `date: "${update.createdAt}"`,
      // Ensure final URL lives under <baseurl>/${this.dir}/${safeId}.html (no leading slash for project pages)
      `permalink: ${this.dir}/${safeId}.html`,
      update.citations?.length ? `citations: ${update.citations.length}` : undefined,
      '---',
      '',
    ].filter(Boolean) as string[]

    const titleBlock = update.title ? `# ${update.title}\n\n` : ''
    const bodyMd = `${titleBlock}${update.markdown}`
    const content =
      frontmatterLines.join('\n') +
      `\n\n` +
      `<!--HA-START-->\n` +
      bodyMd +
      `\n<!--HA-END-->\n`
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

  private async ensureJekyllScaffold(): Promise<void> {
    // _config.yml
    await this.ensureFile(
      '_config.yml',
      `title: HypeAgent Updates\n` +
        `theme: jekyll-theme-cayman\n` +
        `collections:\n  updates:\n    output: true\n` +
        `markdown: kramdown\n`,
    )

    // index.md renders only summary posts, with basic styling, newest first
    const indexMd = `---\n` +
      `title: Updates\n` +
      `layout: null\n` +
      `---\n\n` +
      `<style>\n` +
      `  :root { --fg:#0b1320; --muted:#5b667a; --bg:#f7fafc; --card:#ffffff; --accent:#2f73ff; }\n` +
      `  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); margin: 0; }\n` +
      `  .wrap { max-width: 780px; margin: 32px auto; padding: 0 16px; }\n` +
      `  h1 { font-size: 28px; margin: 0 0 16px; }\n` +
      `  .post { background: var(--card); border: 1px solid #e7ecf3; border-radius: 12px; padding: 20px 20px; margin: 16px 0; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }\n` +
      `  .post h2 { font-size: 20px; margin: 0 0 8px; }\n` +
      `  .post h2 a { color: inherit; text-decoration: none; }\n` +
      `  .meta { color: var(--muted); font-size: 13px; margin: 0 0 12px; }\n` +
      `  hr.sep { border: none; border-top: 1px solid #eef2f7; margin: 16px 0 0; }\n` +
      `</style>\n\n` +
      `<div class="wrap">\n` +
      `  <h1>Latest Updates</h1>\n` +
      `  {% assign summary = site.updates | where: "ha_kind", "summary" | sort: 'date' | reverse %}\n` +
      `  {% assign items = summary %}\n` +
      `  {% if summary.size == 0 %}\n` +
      `    {% assign coll = site.updates | sort: 'date' | reverse %}\n` +
      `    {% assign legacy = site.pages | where_exp: "p", "p.url contains '/updates/'" | sort: 'date' | reverse %}\n` +
      `    {% assign items = coll | concat: legacy | sort: 'date' | reverse %}\n` +
      `  {% endif %}\n` +
      `  {% if items.size == 0 %}\n` +
      `    <p class="meta">No updates yet. Run the CLI to generate your first post.</p>\n` +
      `  {% endif %}\n` +
      `  {% for post in items %}\n` +
      `    <div class="post">\n` +
      `      <p class="meta"><span class="dt" data-iso="{{ post.date | default: post.createdAt }}"></span></p>\n` +
      `      {% capture html %}{{ post.content }}{% endcapture %}\n` +
      `      {% assign seg = html %}\n` +
      `      {% assign p1 = html | split: '<!--HA-START-->' %}\n` +
      `      {% if p1.size > 1 %}{% assign p2 = p1[1] | split: '<!--HA-END-->' %}{% assign seg = p2[0] %}{% endif %}\n` +
      `      {% comment %} Legacy fallback: if front matter leaked, strip it {% endcomment %}\n` +
      `      {% assign parts = seg | split: '---' %}\n` +
      `      {% if parts.size > 2 %}{% assign seg = parts[2] %}{% endif %}\n` +
      `      {% assign heading_text = '' %}\n` +
      `      {% assign body_only = seg %}\n` +
      `      {% assign h1split = seg | split: '</h1>' %}\n` +
      `      {% if h1split.size > 1 %}{% assign h1left = h1split[0] | split: '>' %}{% assign heading_text = h1left | last %}{% assign body_only = h1split[1] %}{% endif %}\n` +
      `      {% if heading_text == '' %}\n` +
      `        {% assign lines = seg | split: '\n' %}\n` +
      `        {% if lines.size > 0 and (lines[0] | slice: 0, 2) == '# ' %}\n` +
      `          {% assign heading_text = lines[0] | remove_first: '# ' | strip %}\n` +
      `          {% assign body_only = seg | remove_first: lines[0] %}\n` +
      `          {% assign body_only = body_only | replace_first: '\n', '' %}\n` +
      `        {% endif %}\n` +
      `      {% endif %}\n` +
      `      {% assign display_title = post.ha_title | default: post.title | default: post.data.title | default: post["title"] | default: heading_text | strip | default: post.name | default: post.id %}\n` +
      `      <h2><a href="{{ post.url | relative_url }}">{{ display_title }}</a></h2>\n` +
      `      {% if body_only contains '<' %}{{ body_only }}{% else %}{{ body_only | markdownify }}{% endif %}\n` +
      `      <hr class="sep" />\n` +
      `      <p class="meta"><a href="{{ post.url | relative_url }}">Permalink</a></p>\n` +
      `    </div>\n` +
      `  {% endfor %}\n` +
      `  <script>\n` +
      `    (function(){\n` +
      `      function fmt(iso){\n` +
      `        var dt = new Date(iso);\n` +
      `        var opts = { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' };\n` +
      `        try { return dt.toLocaleString(undefined, opts); } catch(e) { return dt.toISOString(); }\n` +
      `      }\n` +
      `      function rel(iso){\n` +
      `        var now = new Date();\n` +
      `        var then = new Date(iso);\n` +
      `        var diffMs = now - then;\n` +
      `        var mins = Math.round(diffMs/60000);\n` +
      `        if (mins < 60) return mins + ' minutes ago (' + fmt(iso) + ')';\n` +
      `        var hours = Math.round(mins/60);\n` +
      `        if (hours < 24) return hours + ' hours ago (' + fmt(iso) + ')';\n` +
      `        var days = Math.round(hours/24);\n` +
      `        return days + ' days ago (' + fmt(iso) + ')';\n` +
      `      }\n` +
      `      Array.prototype.slice.call(document.querySelectorAll('.dt')).forEach(function(el){\n` +
      `        var iso = el.getAttribute('data-iso');\n` +
      `        if (!iso) {\n` +
      `          var post = el.closest('.post');\n` +
      `          var a = post ? post.querySelector('h2 a') : null;\n` +
      `          var href = a ? (a.getAttribute('href') || '') : '';\n` +
      `          // infer ISO from permalink like: update-2025-08-20T18-36-46-095Z-summary.html\n` +
      `          var m = href.match(/update-([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2})-([0-9]{2})-([0-9]{2})-([0-9]{3})Z/i);\n` +
      `          if (m) {\n` +
      `            iso = m[1] + ':' + m[2] + ':' + m[3] + '.' + m[4] + 'Z';\n` +
      `          }\n` +
      `        }\n` +
      `        if (iso) el.textContent = rel(iso);\n` +
      `      });\n` +
      `    })();\n` +
      `  </script>\n` +
      `</div>\n`

    await this.ensureFile('index.md', indexMd)
  }

  private async ensureFile(path: string, content: string): Promise<void> {
    let sha: string | undefined
    let existingB64: string | undefined
    try {
      const existing = await this.octokit.repos.getContent({ owner: this.owner, repo: this.repo, path, ref: this.branch })
      if (!Array.isArray(existing.data) && 'sha' in existing.data) {
        const file = existing.data as { sha?: string; content?: string; encoding?: string }
        sha = file.sha
        if (file.content) {
          existingB64 = file.content.replace(/\n/g, '')
        }
      }
    } catch (err: unknown) {
      const status = typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined
      if (status !== 404) throw err
    }

    const newB64 = Buffer.from(content, 'utf8').toString('base64')
    if (sha && existingB64 === newB64) return

    await this.octokit.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      branch: this.branch,
      message: sha ? `HypeAgent: update ${path}` : `HypeAgent: bootstrap ${path}`,
      content: newB64,
      ...(sha ? { sha } : {}),
    })
  }
}
