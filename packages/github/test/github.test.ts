import { describe, it, expect } from 'vitest'
import { mapEventToFact } from '../src/index'
import type { Event } from '@hypeagent/core'

describe('@hypeagent/github', () => {
  it('maps Event to Fact as expected', () => {
    const e: Event = {
      id: 'e1',
      source: 'github',
      kind: 'issue_opened',
      occurredAt: '2024-01-01T00:00:00.000Z',
      payload: {},
      url: 'https://github.com/org/repo/issues/1',
    }
    const f = mapEventToFact(e)
    expect(f.id).toBe('e1')
    expect(f.kind).toBe('issue_opened')
    expect(f.source).toBe('github')
    expect(f.url).toBe(e.url)
  })
})
