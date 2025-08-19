import { describe, it, expect } from 'vitest'
import {
  EventSchema,
  FactSchema,
  UpdateDraftSchema,
  ProjectStateSchema,
} from '../src/index'

describe('Core Zod Schemas', () => {
  it('parses a valid Event', () => {
    const e = {
      id: 'e1',
      source: 'github',
      kind: 'issue_opened',
      occurredAt: new Date().toISOString(),
      payload: { id: 123 },
      url: 'https://github.com/org/repo/issues/1',
    }
    expect(() => EventSchema.parse(e)).not.toThrow()
  })

  it('fails Event with bad url', () => {
    const e = {
      id: 'e1',
      source: 'github',
      kind: 'issue_opened',
      occurredAt: new Date().toISOString(),
      payload: {},
      url: 'not-a-url',
    }
    expect(() => EventSchema.parse(e)).toThrow()
  })

  it('parses a valid Fact and ProjectState', () => {
    const f = {
      id: 'f1',
      kind: 'issue',
      summary: 'Opened an issue',
      occurredAt: new Date().toISOString(),
      source: 'github',
      url: 'https://example.com',
      data: { issue: 1 },
    }
    expect(() => FactSchema.parse(f)).not.toThrow()

    const state = {
      lastRunAt: new Date().toISOString(),
      facts: [f],
    }
    expect(() => ProjectStateSchema.parse(state)).not.toThrow()
  })

  it('validates UpdateDraft citations URLs', () => {
    const draft = {
      id: 'u1',
      createdAt: new Date().toISOString(),
      markdown: 'Hello',
      citations: [{ label: 'ref', url: 'https://example.com' }],
    }
    expect(() => UpdateDraftSchema.parse(draft)).not.toThrow()

    const bad = {
      ...draft,
      citations: [{ label: 'ref', url: 'not-a-url' }],
    }
    expect(() => UpdateDraftSchema.parse(bad)).toThrow()
  })
})
