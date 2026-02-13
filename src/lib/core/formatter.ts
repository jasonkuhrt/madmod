import { FileSystem } from '@effect/platform'
import { Effect, Option, pipe } from 'effect'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type FormatterKind = 'biome' | 'dprint' | 'prettier' | 'oxfmt'

const CONFIG_FILE_MAP: ReadonlyArray<readonly [FormatterKind, readonly string[]]> = [
  ['biome', ['biome.json', 'biome.jsonc']],
  ['dprint', ['dprint.json', '.dprint.json']],
  ['prettier', [
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.yml',
    '.prettierrc.yaml',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.mjs',
    'prettier.config.js',
    'prettier.config.cjs',
    'prettier.config.mjs',
  ]],
]

export const detectFormatter = (
  cwd: string,
): Effect.Effect<Option.Option<FormatterKind>, never, FileSystem.FileSystem> =>
  pipe(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem

      for (const [kind, configs] of CONFIG_FILE_MAP) {
        for (const config of configs) {
          if (yield* fs.exists(`${cwd}/${config}`)) {
            return Option.some(kind)
          }
        }
      }

      return yield* pipe(
        fs.readFileString(`${cwd}/package.json`),
        Effect.map((raw) => {
          const pkg = JSON.parse(raw) as { devDependencies?: Record<string, string> }
          const devDeps = pkg.devDependencies ?? {}
          if ('@biomejs/biome' in devDeps) return Option.some('biome' as FormatterKind)
          if ('dprint' in devDeps) return Option.some('dprint' as FormatterKind)
          if ('prettier' in devDeps) return Option.some('prettier' as FormatterKind)
          return Option.none()
        }),
        Effect.catchAll(() => Effect.succeed(Option.none())),
      )
    }),
    Effect.catchAll(() => Effect.succeed(Option.none())),
  )

export const formatFiles = (
  kind: FormatterKind,
  files: string[],
  cwd: string,
): Effect.Effect<void> =>
  Effect.tryPromise({
    try: async () => {
      if (files.length === 0) return
      switch (kind) {
        case 'biome':
          await execFileAsync('npx', ['biome', 'format', '--write', ...files], { cwd })
          break
        case 'dprint':
          await execFileAsync('npx', ['dprint', 'fmt', ...files], { cwd })
          break
        case 'prettier':
          await execFileAsync('npx', ['prettier', '--write', ...files], { cwd })
          break
        case 'oxfmt':
          await execFileAsync('npx', ['oxfmt', ...files], { cwd })
          break
      }
    },
    catch: (e) => {
      console.warn(`madmod: formatter (${kind}) failed:`, e)
    },
  }).pipe(Effect.catchAll(() => Effect.void))
