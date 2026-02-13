import type { AsyncSubscription } from '@parcel/watcher'
import { subscribe } from '@parcel/watcher'
import { Array as A, HashSet, pipe } from 'effect'
import { dirname, relative, resolve } from 'node:path'
import picomatch from 'picomatch'
import type { ResolvedConfig } from '../config/schema.js'

// Module-level HashSet for self-write tracking (mutated via reassignment).
// Tracks absolute paths of files crossmod just wrote, so the watcher
// can filter out its own write events and avoid re-triggering generation.
let recentWrites = HashSet.empty<string>()

export function trackWrite(absolutePath: string): void {
  recentWrites = HashSet.add(recentWrites, absolutePath)
}

/** Sentinel value returned as the sole affected dir when the config file changes. */
export const CONFIG_CHANGED = '__CONFIG_CHANGED__' as const

export async function startWatching(
  cwd: string,
  config: ResolvedConfig,
  onRegenerate: (affectedDirs: ReadonlyArray<string>) => Promise<void>,
): Promise<AsyncSubscription> {
  return subscribe(
    cwd,
    async (err, events) => {
      if (err) {
        console.error('crossmod: watcher error:', err)
        return
      }

      // Filter out self-writes
      const relevant = pipe(
        events,
        A.filter((event) => {
          if (HashSet.has(recentWrites, event.path)) {
            recentWrites = HashSet.remove(recentWrites, event.path)
            return false
          }
          return true
        }),
      )

      if (A.isEmptyArray(relevant)) return

      const affectedDirs = matchEventsToRules(relevant, config, cwd)
      if (A.isNonEmptyReadonlyArray(affectedDirs)) {
        await onRegenerate(affectedDirs)
      }
    },
    { ignore: ['**/node_modules/**', '**/.git/**'] },
  )
}

function matchEventsToRules(
  events: ReadonlyArray<{ path: string; type: string }>,
  config: ResolvedConfig,
  cwd: string,
): ReadonlyArray<string> {
  let affectedDirs = HashSet.empty<string>()

  for (const event of events) {
    const relPath = relative(cwd, event.path)

    // Config file change — signal a full reload
    if (/^crossmod\.config\.(ts|js|mjs)$/.test(relPath)) {
      return [CONFIG_CHANGED]
    }

    for (const rule of config.rules) {
      const dirMatcher = picomatch(rule.dirs)
      const eventDir = dirname(relPath)

      // Walk up from the event's directory to find a matching rule dir
      let checkDir = eventDir
      while (checkDir && checkDir !== '.') {
        if (dirMatcher(checkDir)) {
          affectedDirs = HashSet.add(affectedDirs, resolve(cwd, checkDir))
          break
        }
        checkDir = dirname(checkDir)
      }
      if (dirMatcher(eventDir)) {
        affectedDirs = HashSet.add(affectedDirs, resolve(cwd, eventDir))
      }
    }
  }

  return A.fromIterable(affectedDirs)
}
