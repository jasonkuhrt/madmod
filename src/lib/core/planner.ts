import { Array as Arr, Effect, pipe } from 'effect'
import { resolve } from 'node:path'
import type { ResolvedConfig } from '../config/schema.js'
import { detectExtensionMode, type ExtensionMode } from '../extensions.js'
import { checkCollisions } from '../naming.js'
import type { Action } from './action.js'
import { Action as ActionFactory } from './action.js'
import { renderBarrel } from './renderer.js'
import { scanRule } from './scanner.js'
import { executeWrite, planWrite } from './writer.js'

export interface PlanResult {
  actions: ReadonlyArray<Action>
  errors: ReadonlyArray<{ dir: string; error: unknown }>
}

export const plan = (
  config: ResolvedConfig,
  cwd: string,
) =>
  Effect.gen(function*() {
    const extensionMode: ExtensionMode = config.extensions === 'auto'
      ? yield* detectExtensionMode(cwd)
      : config.extensions as ExtensionMode

    const actions: Array<Action> = []
    const errors: Array<{ dir: string; error: unknown }> = []

    for (const rule of config.rules) {
      const scanResults = yield* scanRule(rule, config, cwd).pipe(
        Effect.catchAll((error) => {
          errors.push({ dir: `rule(${rule.dirs})`, error })
          return Effect.succeed([] as const)
        }),
      )

      for (const { dir, modules } of scanResults) {
        try {
          checkCollisions(modules)
          const content = renderBarrel(modules, extensionMode)
          const barrelPath = resolve(dir, config.barrelFile)
          const action = yield* planWrite(barrelPath, content)
          actions.push(action)
        } catch (error) {
          errors.push({ dir, error })
        }
      }
    }

    return { actions, errors } as PlanResult
  })

export const execute = (
  result: PlanResult,
  opts?: { onBeforeWrite?: (path: string) => void },
) =>
  Effect.gen(function*() {
    const writable = pipe(
      result.actions,
      Arr.filter((a) => ActionFactory.$is('Create')(a) || ActionFactory.$is('Update')(a)),
    )
    for (const action of writable) {
      yield* executeWrite(action, opts?.onBeforeWrite)
    }
    return Arr.map(writable, (a) => a.path)
  })
