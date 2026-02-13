#!/usr/bin/env node

import { Command, Options } from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Array as A, Console, Effect, Match, Option, pipe } from 'effect'
import { readFileSync } from 'node:fs'
import pc from 'picocolors'
import { loadConfig } from '../lib/config/loader.js'
import { resolveDefaults } from '../lib/config/schema.js'
import { type Action, Action as ActionFactory } from '../lib/core/action.js'
import { DoctorCheck, formatDoctorResults, runDoctor } from '../lib/core/doctor.js'
import { detectFormatter, formatFiles } from '../lib/core/formatter.js'
import { execute, plan } from '../lib/core/planner.js'
import { getDaemonStatus, startDaemon, stopDaemon } from '../lib/daemon/lifecycle.js'
import { ConfigInvalid, ConfigNotFound } from '../lib/errors.js'
import { formatAction, formatDuration, formatSummary } from '../lib/ui/format.js'
import { symbols } from '../lib/ui/symbols.js'
import { CONFIG_CHANGED, startWatching, trackWrite } from '../lib/watch/watcher.js'

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
) as { version: string }

// ---------------------------------------------------------------------------
// Shared options
// ---------------------------------------------------------------------------

const configOption = Options.file('config').pipe(
  Options.withAlias('c'),
  Options.withDescription('Path to config file'),
  Options.optional,
)

const noCache = Options.boolean('no-cache').pipe(
  Options.withDescription('Bypass scan cache'),
  Options.withDefault(false),
)

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

const formatError = Match.type<ConfigNotFound | ConfigInvalid>().pipe(
  Match.tag(
    'ConfigNotFound',
    (e) =>
      `${symbols.fail} No config found in ${e.cwd}\n  Searched: ${e.searched.join(', ')}\n  Run ${
        pc.bold('crossmod init')
      } to create one`,
  ),
  Match.tag('ConfigInvalid', (e) => `${symbols.fail} Invalid config at ${e.path}\n  ${e.message}`),
  Match.exhaustive,
)

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

const generate = Command.make(
  'generate',
  {
    config: configOption,
    dryRun: Options.boolean('dry-run').pipe(
      Options.withDescription('Preview changes without writing'),
      Options.withDefault(false),
    ),
    noCache,
  },
  (opts) =>
    Effect.gen(function*() {
      const cwd = process.cwd()
      const configPath = Option.getOrUndefined(opts.config)

      const rawConfig = yield* loadConfig(cwd, configPath).pipe(
        Effect.catchTags({
          ConfigNotFound: (e) => Effect.flatMap(Console.error(formatError(e)), () => Effect.die('exit')),
          ConfigInvalid: (e) => Effect.flatMap(Console.error(formatError(e)), () => Effect.die('exit')),
        }),
      )
      const config = resolveDefaults(rawConfig)

      yield* Console.log(
        `\n  ${symbols.pass} Loaded config (${config.rules.length} rule${config.rules.length === 1 ? '' : 's'})`,
      )

      const result = yield* plan(config, cwd)

      if (opts.dryRun) {
        yield* Console.log(`  ${symbols.info} Dry run — no files will be written\n`)

        for (const action of result.actions) {
          yield* Console.log(formatAction(action, cwd))
        }

        const staleCount = pipe(
          result.actions,
          A.filter((a) => ActionFactory.$is('Create')(a) || ActionFactory.$is('Update')(a)),
          (xs) => xs.length,
        )
        const upToDateCount = pipe(
          result.actions,
          A.filter((a) => ActionFactory.$is('Skip')(a)),
          (xs) => xs.length,
        )
        const conflictCount = pipe(
          result.actions,
          A.filter((a) => ActionFactory.$is('Conflict')(a)),
          (xs) => xs.length,
        )

        const parts = pipe(
          [
            staleCount > 0 ? `${staleCount} would change` : '',
            upToDateCount > 0 ? pc.dim(`${upToDateCount} up-to-date`) : '',
            conflictCount > 0 ? pc.red(`${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`) : '',
          ],
          A.filter((s) => s.length > 0),
          A.join(', '),
        )
        yield* Console.log(`\n  ${parts}`)
      } else {
        const start = Date.now()

        const writtenPaths = yield* execute(result)

        for (const action of result.actions) {
          yield* Console.log(formatAction(action, cwd))
        }

        // Format written files
        const formatterConfig = config.formatter
        if (formatterConfig !== false && A.isNonEmptyArray(writtenPaths)) {
          const formatterOpt = formatterConfig === 'auto'
            ? yield* detectFormatter(cwd)
            : Option.some(formatterConfig)

          yield* Option.match(formatterOpt, {
            onNone: () => Effect.void,
            onSome: (kind) =>
              pipe(
                formatFiles(kind, writtenPaths as unknown as string[], cwd),
                Effect.tap(() =>
                  Console.log(
                    `\n  ${symbols.pass} Formatted ${writtenPaths.length} file${
                      writtenPaths.length === 1 ? '' : 's'
                    } with ${kind}`,
                  )
                ),
              ),
          })
        }

        const elapsed = Date.now() - start
        yield* Console.log(`\n  ${formatSummary(result.actions)}  ${pc.dim('\u23F1')} ${formatDuration(elapsed)}`)
      }
    }),
).pipe(Command.withDescription('Generate index files from config rules'))

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

const check = Command.make(
  'check',
  { config: configOption },
  (opts) =>
    Effect.gen(function*() {
      const cwd = process.cwd()
      const configPath = Option.getOrUndefined(opts.config)

      const rawConfig = yield* loadConfig(cwd, configPath).pipe(
        Effect.catchTags({
          ConfigNotFound: (e) =>
            Effect.flatMap(Console.error(formatError(e)), () => Effect.die({ _tag: 'exit' as const, code: 2 })),
          ConfigInvalid: (e) =>
            Effect.flatMap(Console.error(formatError(e)), () => Effect.die({ _tag: 'exit' as const, code: 2 })),
        }),
      )
      const config = resolveDefaults(rawConfig)

      const result = yield* plan(config, cwd)

      const stale = pipe(
        result.actions,
        A.filter((a): a is Action => ActionFactory.$is('Create')(a) || ActionFactory.$is('Update')(a)),
      )

      if (A.isNonEmptyArray(stale)) {
        yield* Console.log(
          `\n  ${symbols.fail} ${stale.length} index file${stale.length === 1 ? '' : 's'} ${
            stale.length === 1 ? 'is' : 'are'
          } stale\n`,
        )

        for (const action of stale) {
          yield* Console.log(formatAction(action, cwd))
        }

        yield* Console.log(`\n  Run ${pc.bold('crossmod generate')} to fix.`)
        yield* Effect.die({ _tag: 'exit' as const, code: 1 })
      } else {
        const total = result.actions.length
        yield* Console.log(
          `\n  ${symbols.pass} All ${total} index file${total === 1 ? '' : 's'} ${
            total === 1 ? 'is' : 'are'
          } up-to-date\n`,
        )
      }
    }),
).pipe(Command.withDescription('Check index files for drift (CI mode)'))

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

const starterConfig = `import { defineConfig } from 'crossmod'

export default defineConfig({
  rules: [
    {
      dirs: 'src/**',
      modules: [{ include: './*.ts', style: 'star' }],
    },
  ],
})
`

const init = Command.make(
  'init',
  {},
  () =>
    Effect.gen(function*() {
      const cwd = process.cwd()
      const fs = yield* FileSystem.FileSystem
      const configPath = `${cwd}/crossmod.config.ts`

      const exists = yield* fs.exists(configPath)
      if (exists) {
        yield* Console.error(`\n  ${symbols.fail} crossmod.config.ts already exists\n`)
        return
      }

      yield* fs.writeFileString(configPath, starterConfig)

      yield* Console.log(`\n  ${symbols.pass} Created crossmod.config.ts`)
      yield* Console.log(`\n  Next steps:`)
      yield* Console.log(`    1. Edit the config to define your rules`)
      yield* Console.log(`    2. Run ${pc.bold('crossmod generate')} to create index files`)
      yield* Console.log(`    3. Run ${pc.bold('crossmod doctor')} to validate your setup\n`)
    }),
).pipe(Command.withDescription('Create a starter crossmod.config.ts'))

// ---------------------------------------------------------------------------
// watch (placeholder)
// ---------------------------------------------------------------------------

const watch = Command.make(
  'watch',
  { config: configOption },
  (opts) =>
    Effect.gen(function*() {
      const cwd = process.cwd()
      const configPath = Option.getOrUndefined(opts.config)

      const rawConfig = yield* loadConfig(cwd, configPath).pipe(
        Effect.catchTags({
          ConfigNotFound: (e) => Effect.flatMap(Console.error(formatError(e)), () => Effect.die('exit')),
          ConfigInvalid: (e) => Effect.flatMap(Console.error(formatError(e)), () => Effect.die('exit')),
        }),
      )
      let config = resolveDefaults(rawConfig)

      // Initial generation
      const result = yield* plan(config, cwd)
      const writtenPaths = yield* execute(result, { onBeforeWrite: trackWrite })
      const total = result.actions.length
      yield* Console.log(`\n  ${symbols.pass} Generated ${total} index files`)
      if (writtenPaths.length > 0) {
        yield* Console.log(`  ${symbols.pass} ${writtenPaths.length} files written`)
      }

      yield* Console.log(`  ${symbols.pass} Watching for changes... (Ctrl+C to stop)\n`)

      // Start watching
      yield* Effect.tryPromise(() =>
        startWatching(cwd, config, async (affectedDirs) => {
          const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false })

          // Config change — reload
          if (affectedDirs.length === 1 && affectedDirs[0] === CONFIG_CHANGED) {
            console.log(`  [${timestamp}] Config changed — reloading...`)
            try {
              const freshConfig = await Effect.runPromise(
                loadConfig(cwd, configPath).pipe(Effect.provide(NodeContext.layer)),
              )
              config = resolveDefaults(freshConfig)
              console.log(`  [${timestamp}] ${symbols.pass} Reloaded (${config.rules.length} rules)`)
            } catch (err) {
              console.error(`  [${timestamp}] ${symbols.fail} Config reload failed:`, err)
            }
            return
          }

          try {
            const planResult = await Effect.runPromise(
              plan(config, cwd).pipe(Effect.provide(NodeContext.layer)),
            )
            const start = Date.now()
            const written = await Effect.runPromise(
              execute(planResult, { onBeforeWrite: trackWrite }).pipe(Effect.provide(NodeContext.layer)),
            )
            if (written.length > 0) {
              const elapsed = Date.now() - start
              for (const path of written) {
                const rel = path.replace(`${cwd}/`, '')
                console.log(
                  `  [${timestamp}] ${symbols.update}  ${pc.dim(rel)}  ${pc.dim(`\u23F1`)} ${formatDuration(elapsed)}`,
                )
              }
            }
          } catch (err) {
            console.error(`  [${timestamp}] ${symbols.fail} Regeneration error:`, err)
          }
        })
      ).pipe(Effect.orDie)

      // Keep the process running
      yield* Effect.never
    }),
).pipe(Command.withDescription('Watch for changes and regenerate index files'))

// ---------------------------------------------------------------------------
// daemon subcommands (placeholders)
// ---------------------------------------------------------------------------

const daemonStart = Command.make(
  'start',
  { config: configOption },
  (opts) =>
    Effect.gen(function*() {
      const cwd = process.cwd()
      const configPath = Option.getOrUndefined(opts.config)
      const status = startDaemon(cwd, configPath)
      if (status.running) {
        yield* Console.log(`\n  ${symbols.pass} Daemon running (pid ${status.pid})`)
        yield* Console.log(`  ${pc.dim(`Log: ${status.logFile}`)}\n`)
      } else {
        yield* Console.error(`\n  ${symbols.fail} Failed to start daemon\n`)
      }
    }),
).pipe(Command.withDescription('Start background daemon'))

const daemonStop = Command.make(
  'stop',
  {},
  () =>
    Effect.gen(function*() {
      const cwd = process.cwd()
      const status = getDaemonStatus(cwd)
      if (!status.running) {
        yield* Console.log(`\n  ${symbols.info} Daemon is not running\n`)
        return
      }
      stopDaemon(cwd)
      yield* Console.log(`\n  ${symbols.pass} Daemon stopped\n`)
    }),
).pipe(Command.withDescription('Stop background daemon'))

const daemonStatus = Command.make(
  'status',
  {},
  () =>
    Effect.gen(function*() {
      const cwd = process.cwd()
      const status = getDaemonStatus(cwd)
      if (status.running) {
        yield* Console.log(`\n  ${symbols.pass} Daemon running (pid ${status.pid})`)
        yield* Console.log(`  ${pc.dim(`Log: ${status.logFile}`)}\n`)
      } else {
        yield* Console.log(`\n  ${symbols.info} Daemon is not running\n`)
      }
    }),
).pipe(Command.withDescription('Check daemon status'))

const daemon = Command.make('daemon').pipe(
  Command.withDescription('Background daemon management'),
  Command.withSubcommands([daemonStart, daemonStop, daemonStatus]),
)

// ---------------------------------------------------------------------------
// doctor (placeholder — doctor teammate will fill in)
// ---------------------------------------------------------------------------

const doctor = Command.make(
  'doctor',
  {
    config: configOption,
    fix: Options.boolean('fix').pipe(
      Options.withDescription('Auto-apply safe fixes'),
      Options.withDefault(false),
    ),
  },
  (opts) =>
    Effect.gen(function*() {
      const cwd = process.cwd()
      const configPath = Option.getOrUndefined(opts.config)

      const rawConfig = yield* loadConfig(cwd, configPath).pipe(
        Effect.catchTags({
          ConfigNotFound: (e) => Effect.flatMap(Console.error(formatError(e)), () => Effect.die('exit')),
          ConfigInvalid: (e) => Effect.flatMap(Console.error(formatError(e)), () => Effect.die('exit')),
        }),
      )
      const config = resolveDefaults(rawConfig)

      const checks = yield* runDoctor(config, cwd)
      yield* Console.log(formatDoctorResults(checks))

      // --fix: auto-apply safe fixes
      if (opts.fix) {
        const hasStaleness = pipe(
          checks,
          A.some((c) => DoctorCheck.$is('Fail')(c) && c.message.includes('index files are stale')),
        )
        if (hasStaleness) {
          yield* Console.log(`  ${symbols.info} Running generate to fix stale files...\n`)
          const result = yield* plan(config, cwd)
          const written = yield* execute(result)
          yield* Console.log(`  ${symbols.pass} Fixed: ${written.length} files written\n`)
        }
      }

      // Exit code 1 if any failures
      const hasFailures = pipe(checks, A.some(DoctorCheck.$is('Fail')))
      if (hasFailures) {
        yield* Effect.die({ _tag: 'exit' as const, code: 1 })
      }
    }),
).pipe(Command.withDescription('Diagnose setup, validate config, and lint index files'))

// ---------------------------------------------------------------------------
// Root command
// ---------------------------------------------------------------------------

const crossmod = Command.make('crossmod').pipe(
  Command.withDescription('Auto-generate and maintain TypeScript re-export index files'),
  Command.withSubcommands([generate, check, init, watch, doctor, daemon]),
)

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const cli = Command.run(crossmod, {
  name: 'crossmod',
  version: pkg.version,
})

cli(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
)
