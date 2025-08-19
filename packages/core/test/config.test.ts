import { describe, it, expect } from 'vitest'
import { loadEnvConfig, EnvConfigSchema } from '../src/config'

describe('loadEnvConfig', () => {
  it('uses defaults and validates timezone', () => {
    const cfg = loadEnvConfig({})
    expect(cfg.TIMEZONE).toBe('UTC')
    EnvConfigSchema.parse(cfg)
  })

  it('accepts valid timezone and token', () => {
    const cfg = loadEnvConfig({ TIMEZONE: 'America/New_York', GITHUB_TOKEN: 'x' })
    expect(cfg.TIMEZONE).toBe('America/New_York')
    expect(cfg.GITHUB_TOKEN).toBe('x')
  })

  it('rejects invalid timezone', () => {
    expect(() => loadEnvConfig({ TIMEZONE: 'Not/AZone' })).toThrow()
  })
})
