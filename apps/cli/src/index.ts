#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv'
import path from 'path'
import { loadEnvConfig, FileSystemStorage, runOnce } from '@hypeagent/core'

async function main() {
  loadDotenv()
  const cfg = loadEnvConfig()

  const stateFile = process.env.STATE_FILE || path.join(process.cwd(), '.hypeagent', 'state.json')
  const storage = new FileSystemStorage(stateFile)

  // No connectors or publisher wired yet; this runs a minimal pipeline pass
  const res = await runOnce({ connectors: [], storage })

  // basic output
  console.log(
    JSON.stringify(
      {
        timezone: cfg.TIMEZONE,
        stateFile,
        newFacts: res.newFacts,
        lastRunAt: res.state.lastRunAt,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
