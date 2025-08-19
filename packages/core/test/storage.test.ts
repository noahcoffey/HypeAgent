import { describe, it, expect, beforeEach } from 'vitest'
import { FileSystemStorage } from '../src/storage'
import { ProjectState } from '../src/index'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

const tmp = () => path.join(os.tmpdir(), `hypeagent-test-${Math.random().toString(36).slice(2)}`)

describe('FileSystemStorage', () => {
  let file: string

  beforeEach(() => {
    file = path.join(tmp(), 'state.json')
  })

  it('returns undefined when file does not exist', async () => {
    const s = new FileSystemStorage(file)
    const state = await s.readState()
    expect(state).toBeUndefined()
  })

  it('writes and reads valid state', async () => {
    const s = new FileSystemStorage(file)
    const state: ProjectState = {
      lastRunAt: new Date().toISOString(),
      facts: [
        {
          id: 'f1',
          kind: 'issue',
          summary: 'Opened an issue',
          occurredAt: new Date().toISOString(),
          source: 'github',
        },
      ],
    }

    await s.writeState(state)
    const read = await s.readState()
    expect(read).toBeTruthy()
    expect(read?.facts.length).toBe(1)
  })

  it('throws on invalid persisted state', async () => {
    const dir = path.dirname(file)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(file, JSON.stringify({ facts: 'not-an-array' }), 'utf8')

    const s = new FileSystemStorage(file)
    await expect(s.readState()).rejects.toThrow()
  })
})
