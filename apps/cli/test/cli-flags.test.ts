import { describe, it, expect } from 'vitest'
import { parseFlags, shouldGenerateAiSummary, shouldIndexOnly } from '../src/flags'

describe('CLI flags', () => {
  it('parseFlags detects --no-ai and --index-only', () => {
    const f1 = parseFlags(['--no-ai'])
    expect(f1.noAi).toBe(true)
    expect(f1.indexOnly).toBe(false)

    const f2 = parseFlags(['--index-only'])
    expect(f2.noAi).toBe(false)
    expect(f2.indexOnly).toBe(true)

    const f3 = parseFlags(['--no-ai', '--index-only'])
    expect(f3.noAi).toBe(true)
    expect(f3.indexOnly).toBe(true)

    const f4 = parseFlags([])
    expect(f4.noAi).toBe(false)
    expect(f4.indexOnly).toBe(false)
  })

  it('shouldGenerateAiSummary respects key, facts, and --no-ai', () => {
    // needs key and new facts
    expect(shouldGenerateAiSummary(undefined, true, false)).toBe(false)
    expect(shouldGenerateAiSummary('', true, false)).toBe(false)
    expect(shouldGenerateAiSummary('sk-123', false, false)).toBe(false)

    // true when key present and has facts
    expect(shouldGenerateAiSummary('sk-123', true, false)).toBe(true)

    // disabled by --no-ai
    expect(shouldGenerateAiSummary('sk-123', true, true)).toBe(false)
  })

  it('shouldIndexOnly mirrors flag', () => {
    expect(shouldIndexOnly(false)).toBe(false)
    expect(shouldIndexOnly(true)).toBe(true)
  })
})
