export type Flags = {
  noAi: boolean
  indexOnly: boolean
  windowHours?: number
  watch: boolean
  intervalMinutes?: number
}

export function parseFlags(argv: string[] = []): Flags {
  const set = new Set(argv)

  let windowHours: number | undefined
  let intervalMinutes: number | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--window-hours=')) {
      const v = Number(arg.split('=')[1])
      if (Number.isFinite(v) && v > 0) windowHours = v
    } else if (arg === '--window-hours' && i + 1 < argv.length) {
      const v = Number(argv[i + 1])
      if (Number.isFinite(v) && v > 0) windowHours = v
    } else if (arg.startsWith('--interval-minutes=')) {
      const v = Number(arg.split('=')[1])
      if (Number.isFinite(v) && v > 0) intervalMinutes = v
    } else if (arg === '--interval-minutes' && i + 1 < argv.length) {
      const v = Number(argv[i + 1])
      if (Number.isFinite(v) && v > 0) intervalMinutes = v
    }
  }

  return {
    noAi: set.has('--no-ai'),
    indexOnly: set.has('--index-only'),
    windowHours,
    watch: set.has('--watch'),
    intervalMinutes,
  }
}

export function shouldGenerateAiSummary(openaiKey: string | undefined, hasNewFacts: boolean, noAi: boolean): boolean {
  return Boolean(openaiKey) && hasNewFacts && !noAi
}

export function shouldIndexOnly(indexOnly: boolean): boolean {
  return !!indexOnly
}
