import { Array as A, Effect, Order, pipe } from 'effect'
import { readdirSync } from 'node:fs'
import picomatch from 'picomatch'
import { glob } from 'tinyglobby'
import type { ExportStyle } from '../config/schema.js'
import type { ResolvedConfig, ResolvedRule } from '../config/schema.js'
import { ModuleEntry, ScanResult } from './entities.js'

const bySpecifier = Order.mapInput(
  Order.string,
  (
    m: {
      readonly specifier: string
      readonly filename: string
      readonly style: ExportStyle
      readonly _tag: 'ModuleEntry'
    },
  ) => m.specifier,
)

export const scanRule = (
  rule: ResolvedRule,
  config: ResolvedConfig,
  cwd: string,
): Effect.Effect<ReadonlyArray<typeof ScanResult.Type>> =>
  Effect.gen(function*() {
    const dirs = yield* Effect.tryPromise(() =>
      glob(rule.dirs, {
        cwd,
        onlyDirectories: true,
        absolute: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
      })
    ).pipe(Effect.orDie)

    const excludeMatcher = picomatch([...config.exclude])

    return pipe(
      dirs,
      A.map((dir) => {
        const filenames = pipe(
          readdirSync(dir, { withFileTypes: true }),
          A.filter((e) => e.isFile()),
          A.map((e) => e.name),
        )

        const modules = pipe(
          rule.modules,
          A.flatMap((moduleGlob) => {
            const includeMatcher = picomatch(moduleGlob.include)
            return pipe(
              filenames,
              A.filter((f) => f !== config.barrelFile && includeMatcher(f) && !excludeMatcher(f)),
              A.map((filename) =>
                ModuleEntry.make({
                  filename,
                  specifier: filename.replace(/\.[^.]+$/, ''),
                  style: moduleGlob.style,
                })
              ),
            )
          }),
          A.dedupeWith((a, b) => a.filename === b.filename),
          A.sort(bySpecifier),
        )

        return ScanResult.make({ dir, modules })
      }),
    )
  })
