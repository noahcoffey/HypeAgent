import type { Fact, ISODateTime, UpdateDraft } from './models.js'

export function formatFactsAsMarkdown(facts: Fact[]): string {
  if (!facts.length) return '# Update\n\n_No new facts._\n'
  const lines: string[] = ['# Update', '']
  for (const f of facts) {
    if (f.kind === 'commit') {
      const sha = String(f.data?.sha ?? '').slice(0, 7)
      const msg = String((f.data?.message as string | undefined) ?? f.summary)
        .split('\n')[0]
        .trim()
      const link = f.url ? ` ([link](${f.url}))` : ''
      const date = f.occurredAt
      lines.push(`- ${sha ? `\`${sha}\`` : ''} ${msg} (${date})${link}`.trim())
    } else {
      const link = f.url ? ` ([link](${f.url}))` : ''
      const d = (f.data ?? {}) as Record<string, unknown>
      const isPR = Boolean(d['isPR'])
      const number = typeof d['number'] === 'number' ? (d['number'] as number) : undefined
      const title = typeof d['title'] === 'string' ? (d['title'] as string) : undefined
      const state = typeof d['state'] === 'string' ? (d['state'] as string) : undefined
      const kindLabel = isPR ? 'PR' : 'Issue'
      const numStr = number != null ? ` #${number}` : ''
      const titleStr = title ? `: ${title}` : ''
      const stateStr = state ? ` [${state}]` : ''
      const line = `- ${kindLabel}${numStr}${titleStr}${stateStr} (${f.occurredAt})${link}`.trim()
      lines.push(line)
    }
  }
  lines.push('')
  return lines.join('\n')
}

export function createUpdateDraft(facts: Fact[], nowIso: ISODateTime, title?: string): UpdateDraft {
  const markdown = formatFactsAsMarkdown(facts)
  return {
    id: `update-${nowIso}`,
    createdAt: nowIso,
    title,
    markdown,
    citations: facts
      .filter((f) => !!f.url)
      .map((f) => ({ label: f.summary.slice(0, 80), url: f.url! })),
  }
}
