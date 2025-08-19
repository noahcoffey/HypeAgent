import { promises as fs } from 'fs'
import path from 'path'
import type { Publisher, ProjectState, UpdateDraft } from '@hypeagent/core'

export interface FsPublisherConfig {
  outDir: string
  baseUrl?: string // optional: used to build a public URL if hosted
}

export class FileSystemPublisher implements Publisher<FsPublisherConfig> {
  private outDir!: string
  private baseUrl?: string

  async init(config: FsPublisherConfig): Promise<void> {
    this.outDir = path.resolve(config.outDir)
    this.baseUrl = config.baseUrl
    await fs.mkdir(this.outDir, { recursive: true })
  }

  async publish(update: UpdateDraft, _state: ProjectState): Promise<{ id: string; url?: string }> {
    void _state
    const safeId = update.id.replace(/[^a-zA-Z0-9_-]/g, '-')
    const file = path.join(this.outDir, `${safeId}.md`)

    // Write simple frontmatter + markdown content
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
    const url = this.baseUrl ? `${this.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(`${safeId}.md`)}` : undefined
    return { id: update.id, url }
  }
}
