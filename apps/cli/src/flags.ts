export type Flags = {
  noAi: boolean
  indexOnly: boolean
}

export function parseFlags(argv: string[] = []): Flags {
  const set = new Set(argv)
  return {
    noAi: set.has('--no-ai'),
    indexOnly: set.has('--index-only'),
  }
}

export function shouldGenerateAiSummary(openaiKey: string | undefined, hasNewFacts: boolean, noAi: boolean): boolean {
  return Boolean(openaiKey) && hasNewFacts && !noAi
}

export function shouldIndexOnly(indexOnly: boolean): boolean {
  return !!indexOnly
}
