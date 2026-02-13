import { NodeContext } from '@effect/platform-node'
import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect } from 'vitest'
import { resolveDefaults } from '../config/schema.js'
import { HEADER_LINE } from '../header.js'
import { Action } from './action.js'
import { execute, plan } from './planner.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string

const makeTmp = () => mkdtempSync(join(tmpdir(), 'madmod-test-'))

const writeFile = (relPath: string, content = '') => {
  const abs = join(tmp, relPath)
  const dir = abs.replace(/\/[^/]+$/, '')
  mkdirSync(dir, { recursive: true })
  writeFileSync(abs, content)
}

const readFile = (relPath: string) => readFileSync(join(tmp, relPath), 'utf-8')

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provide(NodeContext.layer))

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmp = makeTmp()
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('planner integration', () => {
  describe('star re-exports with no extensions', () => {
    it.effect('creates barrel with star exports', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/lib/auth.ts', 'export const auth = true')
          writeFile('src/lib/billing.ts', 'export const billing = true')

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            rules: [{ dirs: 'src/lib' }],
          })

          const result = yield* plan(config, tmp)
          expect(result.errors).toHaveLength(0)
          expect(result.actions).toHaveLength(1)

          const action = result.actions[0]!
          expect(Action.$is('Create')(action)).toBe(true)
          expect(action.path).toBe(join(tmp, 'src/lib/index.ts'))

          if (Action.$is('Create')(action)) {
            expect(action.content).toContain(HEADER_LINE)
            expect(action.content).toContain("export * from './auth'")
            expect(action.content).toContain("export * from './billing'")
          }

          // Execute and verify file written
          const written = yield* execute(result)
          expect(written).toHaveLength(1)
          expect(readFile('src/lib/index.ts')).toContain("export * from './auth'")
        }),
      ))
  })

  describe('namespace re-exports', () => {
    it.effect('creates barrel with namespace exports', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/lib/auth.ts', 'export const auth = true')
          writeFile('src/lib/billing.ts', 'export const billing = true')

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            rules: [{
              dirs: 'src/lib',
              modules: [{ include: './*', style: 'namespace' }],
            }],
          })

          const result = yield* plan(config, tmp)
          expect(result.errors).toHaveLength(0)
          expect(result.actions).toHaveLength(1)

          const action = result.actions[0]!
          expect(Action.$is('Create')(action)).toBe(true)

          if (Action.$is('Create')(action)) {
            expect(action.content).toContain("export * as Auth from './auth'")
            expect(action.content).toContain("export * as Billing from './billing'")
          }
        }),
      ))
  })

  describe('hand-written conflict', () => {
    it.effect('detects conflict when index.ts exists without @generated header', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/lib/auth.ts', 'export const auth = true')
          writeFile('src/lib/index.ts', 'export { auth } from "./auth"\n')

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            rules: [{ dirs: 'src/lib' }],
          })

          const result = yield* plan(config, tmp)
          expect(result.errors).toHaveLength(0)
          expect(result.actions).toHaveLength(1)

          const action = result.actions[0]!
          expect(Action.$is('Conflict')(action)).toBe(true)
          expect(action.path).toBe(join(tmp, 'src/lib/index.ts'))

          if (Action.$is('Conflict')(action)) {
            expect(action.reason).toBe('hand-written')
          }

          // Execute should not write anything
          const written = yield* execute(result)
          expect(written).toHaveLength(0)

          // Original file should be untouched
          expect(readFile('src/lib/index.ts')).toBe('export { auth } from "./auth"\n')
        }),
      ))
  })

  describe('skip when up-to-date', () => {
    it.effect('skips writing when content matches', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/lib/auth.ts', 'export const auth = true')

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            rules: [{ dirs: 'src/lib' }],
          })

          // First run: create
          const result1 = yield* plan(config, tmp)
          expect(result1.actions).toHaveLength(1)
          expect(Action.$is('Create')(result1.actions[0]!)).toBe(true)
          yield* execute(result1)

          // Second run: skip
          const result2 = yield* plan(config, tmp)
          expect(result2.actions).toHaveLength(1)

          const action = result2.actions[0]!
          expect(Action.$is('Skip')(action)).toBe(true)

          if (Action.$is('Skip')(action)) {
            expect(action.reason).toBe('up-to-date')
          }

          const written = yield* execute(result2)
          expect(written).toHaveLength(0)
        }),
      ))
  })

  describe('multiple rules matching different dirs', () => {
    it.effect('creates barrels for multiple directories', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/models/user.ts', 'export type User = {}')
          writeFile('src/models/post.ts', 'export type Post = {}')
          writeFile('src/utils/format.ts', 'export const format = () => {}')
          writeFile('src/utils/parse.ts', 'export const parse = () => {}')

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            rules: [
              { dirs: 'src/models' },
              { dirs: 'src/utils', modules: [{ include: './*', style: 'namespace' }] },
            ],
          })

          const result = yield* plan(config, tmp)
          expect(result.errors).toHaveLength(0)
          expect(result.actions).toHaveLength(2)

          const modelsAction = result.actions.find((a) => a.path.includes('models'))!
          const utilsAction = result.actions.find((a) => a.path.includes('utils'))!

          expect(Action.$is('Create')(modelsAction)).toBe(true)
          expect(Action.$is('Create')(utilsAction)).toBe(true)

          if (Action.$is('Create')(modelsAction)) {
            expect(modelsAction.content).toContain("export * from './post'")
            expect(modelsAction.content).toContain("export * from './user'")
          }

          if (Action.$is('Create')(utilsAction)) {
            expect(utilsAction.content).toContain("export * as Format from './format'")
            expect(utilsAction.content).toContain("export * as Parse from './parse'")
          }

          const written = yield* execute(result)
          expect(written).toHaveLength(2)
        }),
      ))
  })

  describe('exclude patterns filter out test files', () => {
    it.effect('excludes test files by default', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/lib/auth.ts', 'export const auth = true')
          writeFile('src/lib/auth.test.ts', 'import { auth } from "./auth"')
          writeFile('src/lib/auth.spec.ts', 'test suite')
          writeFile('src/lib/auth.stories.ts', 'stories')

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            rules: [{ dirs: 'src/lib' }],
          })

          const result = yield* plan(config, tmp)
          expect(result.actions).toHaveLength(1)

          const action = result.actions[0]!
          expect(Action.$is('Create')(action)).toBe(true)

          if (Action.$is('Create')(action)) {
            expect(action.content).toContain("export * from './auth'")
            expect(action.content).not.toContain('test')
            expect(action.content).not.toContain('spec')
            expect(action.content).not.toContain('stories')
          }
        }),
      ))

    it.effect('excludes files matching custom exclude patterns', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/lib/auth.ts', 'export const auth = true')
          writeFile('src/lib/internal.ts', 'export const secret = true')
          writeFile('src/lib/helpers.ts', 'export const help = true')

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            exclude: ['internal.*'],
            rules: [{ dirs: 'src/lib' }],
          })

          const result = yield* plan(config, tmp)
          expect(result.actions).toHaveLength(1)

          const action = result.actions[0]!
          if (Action.$is('Create')(action)) {
            expect(action.content).toContain("export * from './auth'")
            expect(action.content).toContain("export * from './helpers'")
            expect(action.content).not.toContain('internal')
          }
        }),
      ))
  })

  describe('glob patterns', () => {
    it.effect('matches multiple directories with glob', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/a/one.ts', 'export const one = 1')
          writeFile('src/b/two.ts', 'export const two = 2')
          writeFile('src/c/three.ts', 'export const three = 3')

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            rules: [{ dirs: 'src/*' }],
          })

          const result = yield* plan(config, tmp)
          expect(result.errors).toHaveLength(0)
          expect(result.actions).toHaveLength(3)

          const tags = result.actions.map((a) => a._tag)
          expect(tags.every((t) => t === 'Create')).toBe(true)
        }),
      ))
  })

  describe('update existing managed file', () => {
    it.effect('detects update when managed barrel is stale', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/lib/auth.ts', 'export const auth = true')

          // Write a managed barrel with only the header (stale)
          writeFile('src/lib/index.ts', HEADER_LINE)

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            rules: [{ dirs: 'src/lib' }],
          })

          const result = yield* plan(config, tmp)
          expect(result.actions).toHaveLength(1)

          const action = result.actions[0]!
          expect(Action.$is('Update')(action)).toBe(true)

          if (Action.$is('Update')(action)) {
            expect(action.content).toContain("export * from './auth'")
          }

          yield* execute(result)
          const content = readFile('src/lib/index.ts')
          expect(content).toContain(HEADER_LINE)
          expect(content).toContain("export * from './auth'")
        }),
      ))
  })

  describe('mixed module patterns', () => {
    it.effect('handles mixed include patterns and styles in a single rule', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/lib/auth.ts', 'export const auth = true')
          writeFile('src/lib/billing.ts', 'export const billing = true')
          writeFile('src/lib/utils.ts', 'export const utils = true')

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            rules: [{
              dirs: 'src/lib',
              modules: [
                { include: './auth.*', style: 'star' },
                { include: './billing.*', style: 'namespace' },
              ],
            }],
          })

          const result = yield* plan(config, tmp)
          expect(result.actions).toHaveLength(1)

          const action = result.actions[0]!
          expect(Action.$is('Create')(action)).toBe(true)

          if (Action.$is('Create')(action)) {
            expect(action.content).toContain("export * from './auth'")
            expect(action.content).toContain("export * as Billing from './billing'")
            // utils.ts is not matched by either pattern
            expect(action.content).not.toContain('utils')
          }
        }),
      ))
  })

  describe('extensions', () => {
    it.effect('generates .js extensions when configured', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/lib/auth.ts', 'export const auth = true')

          const config = resolveDefaults({
            extensions: '.js',
            formatter: false,
            rules: [{ dirs: 'src/lib' }],
          })

          const result = yield* plan(config, tmp)
          const action = result.actions[0]!

          if (Action.$is('Create')(action)) {
            expect(action.content).toContain("export * from './auth.js'")
          }
        }),
      ))

    it.effect('generates .ts extensions when configured', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/lib/auth.ts', 'export const auth = true')

          const config = resolveDefaults({
            extensions: '.ts',
            formatter: false,
            rules: [{ dirs: 'src/lib' }],
          })

          const result = yield* plan(config, tmp)
          const action = result.actions[0]!

          if (Action.$is('Create')(action)) {
            expect(action.content).toContain("export * from './auth.ts'")
          }
        }),
      ))
  })

  describe('empty directory', () => {
    it.effect('generates header-only barrel for empty dir', () =>
      run(
        Effect.gen(function*() {
          mkdirSync(join(tmp, 'src/lib'), { recursive: true })

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            rules: [{ dirs: 'src/lib' }],
          })

          const result = yield* plan(config, tmp)
          expect(result.actions).toHaveLength(1)

          const action = result.actions[0]!
          expect(Action.$is('Create')(action)).toBe(true)

          if (Action.$is('Create')(action)) {
            expect(action.content).toBe(HEADER_LINE)
          }
        }),
      ))
  })

  describe('custom barrel file name', () => {
    it.effect('uses custom barrelFile name', () =>
      run(
        Effect.gen(function*() {
          writeFile('src/lib/auth.ts', 'export const auth = true')

          const config = resolveDefaults({
            extensions: 'none',
            formatter: false,
            barrelFile: 'mod.ts',
            rules: [{ dirs: 'src/lib' }],
          })

          const result = yield* plan(config, tmp)
          expect(result.actions).toHaveLength(1)

          const action = result.actions[0]!
          expect(action.path).toBe(join(tmp, 'src/lib/mod.ts'))
          expect(Action.$is('Create')(action)).toBe(true)

          yield* execute(result)
          expect(readFile('src/lib/mod.ts')).toContain("export * from './auth'")
        }),
      ))
  })
})
