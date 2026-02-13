#!/usr/bin/env node

// This is the daemon child process entry point.
// It is forked by lifecycle.ts with detached: true.
// stdout/stderr are redirected to the daemon log file.

import { NodeContext } from '@effect/platform-node'
import type { AsyncSubscription } from '@parcel/watcher'
import { Effect } from 'effect'
import { loadConfig } from '../lib/config/loader.js'
import { resolveDefaults } from '../lib/config/schema.js'
import { execute, plan } from '../lib/core/planner.js'
import { startWatching, trackWrite } from '../lib/watch/watcher.js'

function parseArgs(argv: string[]): { cwd: string; config: string | undefined } {
  let cwd = process.cwd()
  let config: string | undefined

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--cwd' && argv[i + 1]) {
      cwd = argv[++i] as string
    } else if (arg === '--config' && argv[i + 1]) {
      config = argv[++i]
    }
  }

  return { cwd, config }
}

const { cwd, config: configPath } = parseArgs(process.argv)

let subscription: AsyncSubscription | null = null

async function start(): Promise<void> {
  console.error(`[daemon] Starting in ${cwd}`)

  const configEffect = loadConfig(cwd, configPath).pipe(
    Effect.provide(NodeContext.layer),
  )

  const config = await Effect.runPromise(configEffect)
  const resolved = resolveDefaults(config)

  // Do an initial generation pass
  const result = await Effect.runPromise(
    plan(resolved, cwd).pipe(Effect.provide(NodeContext.layer)),
  )
  const written = await Effect.runPromise(
    execute(result, { onBeforeWrite: trackWrite }).pipe(Effect.provide(NodeContext.layer)),
  )

  if (written.length > 0) {
    console.error(`[daemon] Initial generation: ${written.length} files written`)
  }

  // Start watching
  subscription = await startWatching(cwd, resolved, async (_affectedDirs) => {
    try {
      const freshConfig = await Effect.runPromise(
        loadConfig(cwd, configPath).pipe(Effect.provide(NodeContext.layer)),
      )
      const freshResolved = resolveDefaults(freshConfig)
      const planResult = await Effect.runPromise(
        plan(freshResolved, cwd).pipe(Effect.provide(NodeContext.layer)),
      )
      const writtenPaths = await Effect.runPromise(
        execute(planResult, { onBeforeWrite: trackWrite }).pipe(Effect.provide(NodeContext.layer)),
      )
      if (writtenPaths.length > 0) {
        console.error(`[daemon] Regenerated: ${writtenPaths.length} files written`)
      }
    } catch (err) {
      console.error('[daemon] Regeneration error:', err)
    }
  })

  console.error('[daemon] Watching for changes...')
}

async function shutdown(): Promise<void> {
  console.error('[daemon] Shutting down...')
  if (subscription) {
    await subscription.unsubscribe()
    subscription = null
  }
  process.exit(0)
}

// Graceful shutdown on SIGTERM
process.on('SIGTERM', () => {
  void shutdown()
})

// Config reload on SIGHUP
process.on('SIGHUP', () => {
  console.error('[daemon] SIGHUP received, restarting...')
  const restart = async (): Promise<void> => {
    if (subscription) {
      await subscription.unsubscribe()
      subscription = null
    }
    await start()
  }
  void restart()
})

// Start the daemon
start().catch((err) => {
  console.error('[daemon] Fatal error:', err)
  process.exit(1)
})
