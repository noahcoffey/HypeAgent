import { z } from 'zod'

export const isValidTimeZone = (tz: string) => {
  try {
    // Throws if tz is not a valid IANA time zone
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const EnvConfigSchema = z.object({
  TIMEZONE: z
    .string()
    .default('UTC')
    .refine(isValidTimeZone, { message: 'Invalid IANA time zone' }),
  GITHUB_TOKEN: z.string().optional(),
})

export type EnvConfig = z.infer<typeof EnvConfigSchema>

/**
 * Load and validate configuration from an env-like object.
 * Defaults to process.env when not provided.
 */
export function loadEnvConfig(env: Record<string, string | undefined> = process.env): EnvConfig {
  // Zod default applies if TIMEZONE is undefined
  return EnvConfigSchema.parse({
    TIMEZONE: env.TIMEZONE,
    GITHUB_TOKEN: env.GITHUB_TOKEN,
  })
}
