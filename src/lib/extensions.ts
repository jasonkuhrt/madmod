import { Effect } from 'effect'
import { resolve } from 'node:path'
import { parse } from 'tsconfck'

export type ExtensionMode = 'none' | '.js' | '.ts'

export const detectExtensionMode = (cwd: string): Effect.Effect<ExtensionMode> =>
  Effect.gen(function*() {
    const result = yield* Effect.tryPromise(() => parse(resolve(cwd, 'madmod-probe.ts'), { root: cwd })).pipe(
      Effect.catchAll(() => {
        return Effect.logWarning('madmod: could not read tsconfig.json, defaulting to no extensions').pipe(
          Effect.as(null),
        )
      }),
    )

    if (!result) {
      return 'none' as const
    }

    const mr = (result.tsconfig.compilerOptions?.moduleResolution as string | undefined)?.toLowerCase()

    switch (mr) {
      case 'bundler':
        return 'none' as const
      case 'node16':
      case 'nodenext': {
        const allowTs = result.tsconfig.compilerOptions?.allowImportingTsExtensions === true
        const noEmit = result.tsconfig.compilerOptions?.noEmit === true
        const declOnly = result.tsconfig.compilerOptions?.emitDeclarationOnly === true
        return (allowTs && (noEmit || declOnly)) ? '.ts' as const : '.js' as const
      }
      default:
        return 'none' as const
    }
  })
