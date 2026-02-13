import { FileSystem } from '@effect/platform'
import { Array as A, Data, Effect, Option, pipe } from 'effect'
import { readdirSync } from 'node:fs'
import { relative } from 'node:path'
import pc from 'picocolors'
import { glob } from 'tinyglobby'
import { loadConfig } from '../config/loader.js'
import type { ResolvedConfig, ResolvedRule } from '../config/schema.js'
import { detectExtensionMode } from '../extensions.js'
import { isOwned } from '../header.js'
import { toPascalCase } from '../naming.js'
import { symbols } from '../ui/symbols.js'
import { Action } from './action.js'
import { detectFormatter } from './formatter.js'
import { plan } from './planner.js'

// ---------------------------------------------------------------------------
// DoctorCheck TaggedEnum
// ---------------------------------------------------------------------------

type CheckCategory = 'setup' | 'environment' | 'lint' | 'suggestion'

export type DoctorCheck = Data.TaggedEnum<{
  Pass: { readonly category: CheckCategory; readonly message: string }
  Fail: {
    readonly category: CheckCategory
    readonly message: string
    readonly fix?: string | undefined
  }
  Suggestion: { readonly category: CheckCategory; readonly message: string }
}>
export const DoctorCheck = Data.taggedEnum<DoctorCheck>()

// ---------------------------------------------------------------------------
// Setup checks
// ---------------------------------------------------------------------------

const checkConfigExists = (cwd: string) =>
  loadConfig(cwd).pipe(
    Effect.map((): DoctorCheck => DoctorCheck.Pass({ category: 'setup', message: 'Config file found' })),
    Effect.catchAll(() =>
      Effect.succeed<DoctorCheck>(DoctorCheck.Fail({
        category: 'setup',
        message: 'No config file found',
        fix: 'Run `madmod init` to create one',
      }))
    ),
  )

const checkConfigParses = (cwd: string) =>
  loadConfig(cwd).pipe(
    Effect.map((config): DoctorCheck => {
      const ruleCount = config.rules?.length ?? 0
      return DoctorCheck.Pass({ category: 'setup', message: `Config valid (${ruleCount} rules)` })
    }),
    Effect.catchTag('ConfigNotFound', () =>
      Effect.succeed<DoctorCheck>(DoctorCheck.Fail({
        category: 'setup',
        message: 'No config file found',
        fix: 'Run `madmod init` to create one',
      }))),
    Effect.catchTag('ConfigInvalid', (e) =>
      Effect.succeed<DoctorCheck>(DoctorCheck.Fail({
        category: 'setup',
        message: `Config parse error: ${e.message}`,
      }))),
  )

const checkRulesExist = (config: ResolvedConfig): DoctorCheck => {
  if (config.rules.length === 0) {
    return DoctorCheck.Fail({
      category: 'setup',
      message: '0 rules configured — nothing will be generated',
      fix: 'Add at least one rule to your config',
    })
  }
  return DoctorCheck.Pass({ category: 'setup', message: `${config.rules.length} rules configured` })
}

const checkRuleDirsMatch = (rule: ResolvedRule, cwd: string) =>
  Effect.gen(function*() {
    const dirs = yield* Effect.tryPromise(() =>
      glob(rule.dirs, {
        cwd,
        onlyDirectories: true,
        absolute: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
      })
    ).pipe(Effect.orDie)

    if (dirs.length === 0) {
      return DoctorCheck.Fail({
        category: 'setup' as CheckCategory,
        message: `Rule "${rule.dirs}" matches 0 directories`,
        fix: 'Check the path pattern — does it match existing directories?',
      })
    }
    return DoctorCheck.Pass({
      category: 'setup' as CheckCategory,
      message: `Rule "${rule.dirs}" matches ${dirs.length} directories`,
    })
  })

// ---------------------------------------------------------------------------
// Environment checks
// ---------------------------------------------------------------------------

const checkTsconfig = (cwd: string) =>
  Effect.gen(function*() {
    const mode = yield* detectExtensionMode(cwd)
    return DoctorCheck.Pass({
      category: 'environment' as CheckCategory,
      message: `Extension mode: ${mode === 'none' ? 'none (no extensions)' : mode}`,
    })
  })

const checkFormatterDetected = (config: ResolvedConfig, cwd: string) =>
  Effect.gen(function*() {
    if (config.formatter === false) {
      return DoctorCheck.Pass({
        category: 'environment' as CheckCategory,
        message: 'Formatter: disabled (config)',
      })
    }

    const detected = yield* detectFormatter(cwd)
    return pipe(
      detected,
      Option.match({
        onNone: (): DoctorCheck =>
          DoctorCheck.Fail({
            category: 'environment',
            message: "No formatter detected — generated files won't be auto-formatted",
            fix: 'Add `formatter: false` to config to suppress this warning',
          }),
        onSome: (kind): DoctorCheck => DoctorCheck.Pass({ category: 'environment', message: `Formatter: ${kind}` }),
      }),
    )
  })

const checkCacheHealth = (cwd: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const cachePath = `${cwd}/node_modules/.cache/madmod/cache.json`
    const exists = yield* fs.exists(cachePath).pipe(
      Effect.catchAll(() => Effect.succeed(false)),
    )
    if (!exists) {
      return DoctorCheck.Pass({
        category: 'environment' as CheckCategory,
        message: 'Cache: not created yet',
      })
    }

    const stat = yield* fs.stat(cachePath).pipe(
      Effect.map((s) => s as FileSystem.File.Info | null),
      Effect.catchAll(() => Effect.succeed(null as FileSystem.File.Info | null)),
    )
    if (!stat) {
      return DoctorCheck.Fail({
        category: 'environment' as CheckCategory,
        message: 'Cache: unable to read',
        fix: 'Delete cache: `rm -rf node_modules/.cache/madmod/`',
      })
    }
    const sizeKB = Math.round(Number(stat.size) / 1024)
    return DoctorCheck.Pass({
      category: 'environment' as CheckCategory,
      message: `Cache: ${sizeKB}KB`,
    })
  })

// ---------------------------------------------------------------------------
// Lint checks
// ---------------------------------------------------------------------------

const checkStaleness = (config: ResolvedConfig, cwd: string) =>
  Effect.gen(function*() {
    const result = yield* plan(config, cwd)
    const stale = pipe(
      result.actions,
      A.filter((a) => Action.$is('Create')(a) || Action.$is('Update')(a)),
    )

    if (stale.length === 0) {
      const total = result.actions.length
      return DoctorCheck.Pass({
        category: 'lint' as CheckCategory,
        message: `${total} managed index files, all up-to-date`,
      })
    }

    const createCount = pipe(stale, A.filter(Action.$is('Create'))).length
    const updateCount = pipe(stale, A.filter(Action.$is('Update'))).length
    const parts = pipe(
      [
        createCount > 0 ? `${createCount} to create` : '',
        updateCount > 0 ? `${updateCount} to update` : '',
      ],
      A.filter((s) => s.length > 0),
      A.join(', '),
    )

    return DoctorCheck.Fail({
      category: 'lint' as CheckCategory,
      message: `${stale.length} index files are stale (${parts})`,
      fix: 'Run `madmod generate` to fix',
    })
  })

const checkNamespaceCollisions = (config: ResolvedConfig, cwd: string) =>
  Effect.gen(function*() {
    const checks: Array<DoctorCheck> = []

    for (const rule of config.rules) {
      const dirs = yield* Effect.tryPromise(() =>
        glob(rule.dirs, {
          cwd,
          onlyDirectories: true,
          absolute: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        })
      ).pipe(Effect.orDie)

      for (const dir of dirs) {
        const namespaceModules = pipe(
          rule.modules,
          A.filter((m) => m.style === 'namespace'),
        )

        if (namespaceModules.length === 0) continue

        const filenames = pipe(
          readdirSync(dir, { withFileTypes: true }),
          A.filter((e) => e.isFile()),
          A.map((e) => e.name),
        )

        const seen = new Map<string, string>()
        for (const filename of filenames) {
          try {
            const derived = toPascalCase(filename)
            const existing = seen.get(derived)
            if (existing !== undefined) {
              checks.push(DoctorCheck.Fail({
                category: 'lint',
                message: `Namespace collision: ${existing} and ${filename} both map to ${derived}`,
                fix: 'Rename one of the files',
              }))
            }
            seen.set(derived, filename)
          } catch {
            // InvalidIdentifier — skip, not a collision issue
          }
        }
      }
    }

    if (checks.length === 0) {
      checks.push(DoctorCheck.Pass({ category: 'lint', message: 'No namespace collisions' }))
    }

    return checks
  })

// ---------------------------------------------------------------------------
// Suggestion checks
// ---------------------------------------------------------------------------

const checkUnmanagedDirectories = (config: ResolvedConfig, cwd: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const suggestions: Array<DoctorCheck> = []

    const allTsDirs = yield* Effect.tryPromise(() =>
      glob('src/**', {
        cwd,
        onlyDirectories: true,
        absolute: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
      })
    ).pipe(
      Effect.catchAll(() => Effect.succeed([] as string[])),
    )

    const managedDirs = new Set<string>()
    for (const rule of config.rules) {
      const dirs = yield* Effect.tryPromise(() =>
        glob(rule.dirs, {
          cwd,
          onlyDirectories: true,
          absolute: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        })
      ).pipe(
        Effect.catchAll(() => Effect.succeed([] as string[])),
      )
      for (const dir of dirs) {
        managedDirs.add(dir)
      }
    }

    for (const dir of allTsDirs) {
      if (managedDirs.has(dir)) continue

      const entries = yield* fs.readDirectory(dir).pipe(
        Effect.catchAll(() => Effect.succeed([] as string[])),
      )
      const tsFiles = pipe(
        entries,
        A.filter((f) => /\.tsx?$/.test(f) && f !== config.barrelFile),
      )

      const hasBarrel = yield* fs.exists(`${dir}/${config.barrelFile}`).pipe(
        Effect.catchAll(() => Effect.succeed(false)),
      )

      if (tsFiles.length > 0 && !hasBarrel) {
        const relDir = relative(cwd, dir)
        suggestions.push(DoctorCheck.Suggestion({
          category: 'suggestion',
          message: `${relDir}/ has ${tsFiles.length} .ts files with no ${config.barrelFile} — consider adding a rule`,
        }))
      }
    }

    return suggestions
  })

const checkHandWrittenBarrels = (config: ResolvedConfig, cwd: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const suggestions: Array<DoctorCheck> = []

    for (const rule of config.rules) {
      const dirs = yield* Effect.tryPromise(() =>
        glob(rule.dirs, {
          cwd,
          onlyDirectories: true,
          absolute: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        })
      ).pipe(
        Effect.catchAll(() => Effect.succeed([] as string[])),
      )

      for (const dir of dirs) {
        const barrelPath = `${dir}/${config.barrelFile}`
        const exists = yield* fs.exists(barrelPath).pipe(
          Effect.catchAll(() => Effect.succeed(false)),
        )
        if (!exists) continue

        const content = yield* fs.readFileString(barrelPath).pipe(
          Effect.catchAll(() => Effect.succeed('')),
        )

        if (!isOwned(content) && looksLikeBarrel(content)) {
          const relPath = relative(cwd, barrelPath)
          suggestions.push(DoctorCheck.Suggestion({
            category: 'suggestion',
            message: `${relPath} looks like a hand-written barrel — madmod could manage it`,
          }))
        }
      }
    }

    return suggestions
  })

/**
 * Heuristic: a file "looks like a barrel" if every non-empty, non-comment line
 * is an export statement.
 */
const looksLikeBarrel = (content: string): boolean => {
  const lines = content.split('\n').filter((l) => {
    const trimmed = l.trim()
    return trimmed.length > 0 && !trimmed.startsWith('//')
  })
  if (lines.length === 0) return false
  return lines.every((l) => l.trim().startsWith('export '))
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export const runDoctor = (config: ResolvedConfig, cwd: string) =>
  Effect.gen(function*() {
    const checks: Array<DoctorCheck> = []

    // Setup checks
    checks.push(yield* checkConfigExists(cwd))
    checks.push(yield* checkConfigParses(cwd))
    checks.push(checkRulesExist(config))
    for (const rule of config.rules) {
      checks.push(yield* checkRuleDirsMatch(rule, cwd))
    }

    // Environment checks
    checks.push(yield* checkTsconfig(cwd))
    checks.push(yield* checkFormatterDetected(config, cwd))
    checks.push(yield* checkCacheHealth(cwd))

    // Lint checks
    if (config.rules.length > 0) {
      checks.push(yield* checkStaleness(config, cwd))
      const collisionChecks = yield* checkNamespaceCollisions(config, cwd)
      for (const c of collisionChecks) checks.push(c)
    }

    // Suggestions
    const unmanagedSuggestions = yield* checkUnmanagedDirectories(config, cwd)
    for (const s of unmanagedSuggestions) checks.push(s)
    const barrelSuggestions = yield* checkHandWrittenBarrels(config, cwd)
    for (const s of barrelSuggestions) checks.push(s)

    return checks
  })

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

const formatCheck = (check: DoctorCheck): string =>
  DoctorCheck.$match(check, {
    Pass: (c) => `    ${symbols.pass} ${c.message}`,
    Fail: (c) => {
      const line = `    ${symbols.fail} ${c.message}`
      if (c.fix) {
        return `${line}\n      ${symbols.arrow} ${c.fix}`
      }
      return line
    },
    Suggestion: (c) => `    ${symbols.suggest} ${c.message}`,
  })

export const formatDoctorResults = (checks: ReadonlyArray<DoctorCheck>): string => {
  const groups = A.groupBy(checks, (c) => c.category)
  const sections: string[] = []

  const categoryOrder: readonly CheckCategory[] = ['setup', 'environment', 'lint', 'suggestion']
  const categoryLabels: Record<CheckCategory, string> = {
    setup: 'Setup',
    environment: 'Environment',
    lint: 'Lint',
    suggestion: 'Suggestions',
  }

  for (const category of categoryOrder) {
    const categoryChecks = groups[category]
    if (!categoryChecks || categoryChecks.length === 0) continue

    const header = `  ${pc.bold(categoryLabels[category])}`
    const lines = pipe(categoryChecks, A.map(formatCheck))
    sections.push(`${header}\n${A.join(lines, '\n')}`)
  }

  // Summary line
  const passCount = pipe(checks, A.filter(DoctorCheck.$is('Pass'))).length
  const failCount = pipe(checks, A.filter(DoctorCheck.$is('Fail'))).length
  const suggestionCount = pipe(checks, A.filter(DoctorCheck.$is('Suggestion'))).length

  const summaryParts = pipe(
    [
      passCount > 0 ? pc.green(`${passCount} passed`) : '',
      failCount > 0 ? pc.red(`${failCount} failed`) : '',
      suggestionCount > 0 ? pc.cyan(`${suggestionCount} suggestions`) : '',
    ],
    A.filter((s) => s.length > 0),
    A.join(', '),
  )

  return `\n${A.join(sections, '\n\n')}\n\n  ${summaryParts}\n`
}
