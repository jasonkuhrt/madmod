import { FileSystem } from '@effect/platform'
import { Array as A, Effect, HashMap, Option, pipe, Schema } from 'effect'
import type { ResolvedConfig } from '../config/schema.js'
import { hashConfig } from './config-hash.js'
import { CacheEntry } from './entities.js'

const ExtensionModeSchema = Schema.Literal('none', '.js', '.ts')

export class ScanCache extends Schema.TaggedClass<ScanCache>('ScanCache')('ScanCache', {
  version: Schema.Literal(1),
  configHash: Schema.String,
  extensionMode: ExtensionModeSchema,
  tsconfigMtime: Schema.Number,
  dirs: Schema.HashMap({ key: Schema.String, value: CacheEntry }),
}) {
  static is = Schema.is(ScanCache)
}

const CACHE_PATH = 'node_modules/.cache/madmod/cache.json'

const ScanCacheCodec = Schema.parseJson(ScanCache)

export const loadCache = (
  cwd: string,
  config: ResolvedConfig,
): Effect.Effect<Option.Option<typeof ScanCache.Type>, never, FileSystem.FileSystem> =>
  pipe(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const cachePath = `${cwd}/${CACHE_PATH}`
      const exists = yield* fs.exists(cachePath)
      if (!exists) return Option.none()
      const raw = yield* fs.readFileString(cachePath)
      const cache = yield* Schema.decode(ScanCacheCodec)(raw)
      return cache.configHash === hashConfig(config)
        ? Option.some(cache)
        : Option.none()
    }),
    Effect.catchAll(() => Effect.succeed(Option.none())),
  )

export const saveCache = (
  cwd: string,
  cache: typeof ScanCache.Type,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  pipe(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const cachePath = `${cwd}/${CACHE_PATH}`
      yield* fs.makeDirectory(`${cwd}/node_modules/.cache/madmod`, { recursive: true })
      const json = yield* Schema.encode(ScanCacheCodec)(cache)
      yield* fs.writeFileString(cachePath, json)
    }),
    Effect.catchAll(() => Effect.void),
  )

export const isCacheHit = (
  cache: typeof ScanCache.Type,
  dir: string,
  currentFiles: readonly string[],
): Option.Option<typeof CacheEntry.Type> =>
  pipe(
    HashMap.get(cache.dirs, dir),
    Option.filter((entry) =>
      entry.files.length === currentFiles.length
      && A.every(entry.files, (f, i) => f === currentFiles[i])
    ),
  )
