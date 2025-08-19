import { describe, it, expect } from 'vitest'
import { runOnce } from '../src/index'
import type { Connector, Event, Fact, ProjectState, UpdateDraft } from '../src/index'
import type { Storage } from '../src/storage'

class InMemoryStorage implements Storage {
  private _state: ProjectState | undefined
  async readState(): Promise<ProjectState | undefined> {
    return this._state
  }
  async writeState(state: ProjectState): Promise<void> {
    this._state = JSON.parse(JSON.stringify(state))
  }
}

class MockConnector implements Connector<unknown> {
  async init(): Promise<void> {}
  async pullSince(): Promise<Event[]> {
    return [
      {
        id: 'e1',
        source: 'mock',
        kind: 'thing',
        occurredAt: '2024-01-01T00:00:00.000Z',
        payload: { any: true },
      },
    ]
  }
  async toFacts(events: Event[]): Promise<Fact[]> {
    return events.map((e) => ({
      id: 'f1',
      kind: e.kind,
      summary: 'Did a thing',
      occurredAt: e.occurredAt,
      source: e.source,
    }))
  }
}

describe('pipeline.runOnce', () => {
  it('pulls, converts, merges, updates state, and optionally publishes', async () => {
    const storage = new InMemoryStorage()
    const connector = new MockConnector()

    const draft: UpdateDraft = {
      id: 'u1',
      createdAt: '2024-01-02T00:00:00.000Z',
      markdown: 'Summary',
      citations: [],
    }

    let publishedCalled = 0
    const publisher = {
      async init(cfg: unknown) {
        void cfg
      },
      async publish(update: UpdateDraft, state: ProjectState) {
        void update
        void state
        publishedCalled++
        return { id: 'pub1', url: 'https://example.com' }
      },
    }

    const res1 = await runOnce({
      connectors: [connector],
      storage,
      now: '2024-01-10T00:00:00.000Z',
      publisher: { instance: publisher, draft },
    })

    expect(res1.newFacts).toBe(1)
    expect(res1.state.facts.length).toBe(1)
    expect(res1.state.lastRunAt).toBe('2024-01-10T00:00:00.000Z')
    expect(res1.published?.id).toBe('pub1')
    expect(publishedCalled).toBe(1)

    // second run should dedupe facts (same id)
    const res2 = await runOnce({ connectors: [connector], storage, now: '2024-01-11T00:00:00.000Z' })
    expect(res2.newFacts).toBe(1) // pulled 1 new fact (from connector), but merge keeps 1 unique by id
    expect(res2.state.facts.length).toBe(1)
    expect(res2.state.lastRunAt).toBe('2024-01-11T00:00:00.000Z')
  })
})
