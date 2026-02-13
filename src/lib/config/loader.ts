import { Effect, Schema } from 'effect'
import { createJiti } from 'jiti'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ConfigInvalid, ConfigNotFound } from '../errors.js'
import { Config } from './schema.js'

const CONFIG_NAMES = ['madmod.config.ts', 'madmod.config.js', 'madmod.config.mjs']

export const loadConfig = (
  cwd: string,
  configPath?: string,
): Effect.Effect<Config, ConfigNotFound | ConfigInvalid> =>
  Effect.gen(function*() {
    const jiti = createJiti(import.meta.url)

    let raw: unknown
    if (configPath) {
      const abs = resolve(cwd, configPath)
      raw = yield* Effect.tryPromise({
        try: () => jiti.import(abs, { default: true }),
        catch: (e) => new ConfigInvalid({ path: abs, message: String(e) }),
      })
    } else {
      let found = false
      for (const name of CONFIG_NAMES) {
        const abs = resolve(cwd, name)
        if (existsSync(abs)) {
          raw = yield* Effect.tryPromise({
            try: () => jiti.import(abs, { default: true }),
            catch: (e) => new ConfigInvalid({ path: abs, message: String(e) }),
          })
          found = true
          break
        }
      }
      if (!found) {
        return yield* new ConfigNotFound({ cwd, searched: CONFIG_NAMES })
      }
    }

    return yield* Schema.decode(Config)(raw as any).pipe(
      Effect.mapError((e) =>
        new ConfigInvalid({
          path: configPath ?? cwd,
          message: String(e),
        })
      ),
    )
  })
