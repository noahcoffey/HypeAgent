import { describe, it, expect } from 'vitest'
import { FileSystemPublisher } from '../src/index'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import type { UpdateDraft } from '@hypeagent/core'

const tmpdir = () => path.join(os.tmpdir(), `hypeagent-pubfs-${Math.random().toString(36).slice(2)}`)

describe('@hypeagent/publisher-fs', () => {
  it('writes markdown file and returns optional URL', async () => {
    const out = tmpdir()
    const pub = new FileSystemPublisher()
    await pub.init({ outDir: out, baseUrl: 'https://example.com/updates' })

    const draft: UpdateDraft = {
      id: 'u1',
      createdAt: new Date().toISOString(),
      markdown: '# Hello\nWorld',
      citations: [],
    }

    const res = await pub.publish(draft, { facts: [] })
    expect(res.id).toBe('u1')
    expect(res.url).toContain('https://example.com/updates')

    const file = path.join(out, 'u1.md')
    const content = await fs.readFile(file, 'utf8')
    expect(content).toContain('---')
    expect(content).toContain('id: u1')
    expect(content).toContain('# Hello')
  })
})
