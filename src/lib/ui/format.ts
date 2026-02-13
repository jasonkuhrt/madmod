import { Array as A, pipe } from 'effect'
import { relative } from 'node:path'
import pc from 'picocolors'
import type { Action } from '../core/action.js'
import { Action as Action$ } from '../core/action.js'
import { symbols } from './symbols.js'

export const formatAction = (action: Action, cwd: string): string =>
  Action$.$match(action, {
    Create: (a) => `  ${symbols.create}  ${pc.dim(relative(cwd, a.path))}`,
    Update: (a) => `  ${symbols.update}  ${pc.dim(relative(cwd, a.path))}`,
    Skip: (a) => `  ${symbols.skip}    ${pc.dim(relative(cwd, a.path))} (${a.reason})`,
    Conflict: (a) => `  ${symbols.conflict}${pc.dim(relative(cwd, a.path))} (${a.reason})`,
  })

export const formatDuration = (ms: number): string => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`

export const formatSummary = (actions: ReadonlyArray<Action>): string => {
  const groups = A.groupBy(actions, (a) => a._tag)
  return pipe(
    [
      groups['Create'] ? pc.green(`${groups['Create'].length} created`) : '',
      groups['Update'] ? pc.yellow(`${groups['Update'].length} updated`) : '',
      groups['Skip'] ? pc.dim(`${groups['Skip'].length} up-to-date`) : '',
      groups['Conflict'] ? pc.red(`${groups['Conflict'].length} conflicts`) : '',
    ],
    A.filter((s) => s.length > 0),
    A.join(', '),
  )
}
