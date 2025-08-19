import { Octokit } from '@octokit/rest'
import type { Connector, Event, Fact, ISODateTime } from '@hypeagent/core'

export interface GitHubConnectorConfig {
  token: string
}

export function mapEventToFact(e: Event): Fact {
  return {
    id: e.id,
    kind: e.kind,
    summary: `GitHub: ${e.kind}`,
    occurredAt: e.occurredAt,
    source: 'github',
    url: e.url,
  }
}

export class GitHubConnector implements Connector<GitHubConnectorConfig> {
  private octokit: Octokit | null = null

  async init(config: GitHubConnectorConfig): Promise<void> {
    this.octokit = new Octokit({ auth: config.token })
  }

  async pullSince(sinceIso: ISODateTime): Promise<Event[]> {
    void sinceIso
    // Placeholder: real implementation will use this.octokit to fetch events
    return []
  }

  async toFacts(events: Event[]): Promise<Fact[]> {
    return events.map(mapEventToFact)
  }
}
