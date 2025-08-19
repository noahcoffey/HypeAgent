import { Connector, Fact, ISODateTime, ProjectState, Publisher, UpdateDraft } from './models.js'
import { Storage } from './storage.js'

export interface RunOnceOptions {
  connectors: Connector<unknown>[]
  storage: Storage
  since?: ISODateTime
  now?: ISODateTime
  publisher?: {
    instance: Publisher<unknown>
    draft?: UpdateDraft
  }
}

function mergeFacts(existing: Fact[], incoming: Fact[]): Fact[] {
  const byId = new Map<string, Fact>()
  for (const f of existing) byId.set(f.id, f)
  for (const f of incoming) byId.set(f.id, f)
  return Array.from(byId.values()).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
}

export interface RunOnceResult {
  state: ProjectState
  newFacts: number
  published?: { id: string; url?: string }
}

export async function runOnce(opts: RunOnceOptions): Promise<RunOnceResult> {
  const nowIso = opts.now ?? new Date().toISOString()

  const prev = (await opts.storage.readState()) ?? { facts: [] as Fact[] as Fact[] }
  const since = opts.since ?? prev.lastRunAt ?? '1970-01-01T00:00:00.000Z'

  // Pull events and convert to facts from all connectors
  const allFacts: Fact[] = []
  for (const c of opts.connectors) {
    const events = await c.pullSince(since)
    const facts = await c.toFacts(events)
    allFacts.push(...facts)
  }

  // Merge and persist
  const merged = mergeFacts(prev.facts ?? [], allFacts)
  const next: ProjectState = {
    ...prev,
    facts: merged,
    lastRunAt: nowIso,
  }
  await opts.storage.writeState(next)

  let published: { id: string; url?: string } | undefined
  if (opts.publisher && opts.publisher.draft) {
    published = await opts.publisher.instance.publish(opts.publisher.draft, next)
  }

  return { state: next, newFacts: allFacts.length, published }
}
