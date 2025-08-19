import { z } from 'zod'

export type ISODateTime = string

export interface Event {
  id: string
  source: string // e.g. 'github' | 'notes'
  kind: string
  occurredAt: ISODateTime
  payload: unknown
  url?: string
}

export interface Fact {
  id: string
  kind: string
  summary: string
  occurredAt: ISODateTime
  source: string
  url?: string
  data?: Record<string, unknown>
}

export interface UpdateDraft {
  id: string
  createdAt: ISODateTime
  title?: string
  markdown: string
  citations: { label: string; url: string }[]
}

export interface ProjectState {
  lastRunAt?: ISODateTime
  facts: Fact[]
  lastUpdate?: UpdateDraft
}

export interface Connector<C = unknown> {
  init(config: C): Promise<void>
  pullSince(sinceIso: ISODateTime): Promise<Event[]>
  toFacts(events: Event[]): Promise<Fact[]>
}

export interface Publisher<C = unknown> {
  init(config: C): Promise<void>
  publish(update: UpdateDraft, state: ProjectState): Promise<{ id: string; url?: string }>
}

export const EventSchema = z.object({
  id: z.string(),
  source: z.string(),
  kind: z.string(),
  occurredAt: z.string().datetime(),
  payload: z.unknown(),
  url: z.string().url().optional(),
})

export const FactSchema = z.object({
  id: z.string(),
  kind: z.string(),
  summary: z.string(),
  occurredAt: z.string().datetime(),
  source: z.string(),
  url: z.string().url().optional(),
  data: z.record(z.unknown()).optional(),
})

export const UpdateDraftSchema = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  title: z.string().optional(),
  markdown: z.string(),
  citations: z.array(z.object({ label: z.string(), url: z.string().url() })),
})

export const ProjectStateSchema = z.object({
  lastRunAt: z.string().datetime().optional(),
  facts: z.array(FactSchema),
  lastUpdate: UpdateDraftSchema.optional(),
})
