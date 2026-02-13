import { FileSystem } from '@effect/platform'
import { Effect } from 'effect'
import { isOwned } from '../header.js'
import { Action } from './action.js'

export const planWrite = (
  barrelPath: string,
  newContent: string,
) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem

    const exists = yield* fs.exists(barrelPath)
    if (!exists) {
      return Action.Create({ path: barrelPath, content: newContent })
    }

    const existing = yield* fs.readFileString(barrelPath)

    if (!isOwned(existing)) {
      return Action.Conflict({ path: barrelPath, reason: 'hand-written' })
    }

    if (existing === newContent) {
      return Action.Skip({ path: barrelPath, reason: 'up-to-date' })
    }

    return Action.Update({ path: barrelPath, content: newContent })
  })

export const executeWrite = (
  action: Action,
  onBeforeWrite?: (path: string) => void,
) =>
  Effect.gen(function*() {
    if (Action.$is('Create')(action) || Action.$is('Update')(action)) {
      const fs = yield* FileSystem.FileSystem
      onBeforeWrite?.(action.path)
      yield* fs.writeFileString(action.path, action.content)
    }
  })
