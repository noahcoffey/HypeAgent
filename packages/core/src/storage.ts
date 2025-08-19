import { promises as fs } from 'fs'
import path from 'path'
import { ProjectState, ProjectStateSchema } from './models.js'

export interface Storage {
  /**
   * Read the current project state from storage.
   * Returns undefined if no state has been stored yet.
   */
  readState(): Promise<ProjectState | undefined>

  /**
   * Persist the provided project state.
   */
  writeState(state: ProjectState): Promise<void>
}

/**
 * Simple filesystem-backed storage that reads/writes a JSON file.
 */
export class FileSystemStorage implements Storage {
  private filePath: string

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath)
  }

  async readState(): Promise<ProjectState | undefined> {
    try {
      const data = await fs.readFile(this.filePath, 'utf8')
      const json = JSON.parse(data)
      return ProjectStateSchema.parse(json)
    } catch (err: unknown) {
      // Handle missing file
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === 'ENOENT'
      ) {
        return undefined
      }
      // Rewrap schema errors for clarity without importing zod types here
      if (err instanceof Error && err.name === 'ZodError') {
        throw new Error(`Invalid persisted state at ${this.filePath}: ${String(err)}`)
      }
      throw err
    }
  }

  async writeState(state: ProjectState): Promise<void> {
    // Validate before writing
    const valid = ProjectStateSchema.parse(state)

    // Ensure directory exists
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true })

    await fs.writeFile(this.filePath, JSON.stringify(valid, null, 2), 'utf8')
  }
}
