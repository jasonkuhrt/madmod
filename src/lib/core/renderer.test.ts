import { describe, expect, it } from 'vitest'
import { HEADER_LINE } from '../header.js'
import { ModuleEntry } from './entities.js'
import { renderBarrel } from './renderer.js'

const makeModule = (filename: string, style: 'star' | 'namespace') =>
  ModuleEntry.make({ filename, specifier: filename.replace(/\.[^.]+$/, ''), style })

describe('renderBarrel', () => {
  describe('star exports', () => {
    const modules = [
      makeModule('auth.ts', 'star'),
      makeModule('billing.ts', 'star'),
    ]

    it('no extensions', () => {
      const result = renderBarrel(modules, 'none')
      expect(result).toBe(
        HEADER_LINE
          + "export * from './auth'\n"
          + "export * from './billing'\n",
      )
    })

    it('.js extensions', () => {
      const result = renderBarrel(modules, '.js')
      expect(result).toBe(
        HEADER_LINE
          + "export * from './auth.js'\n"
          + "export * from './billing.js'\n",
      )
    })

    it('.ts extensions', () => {
      const result = renderBarrel(modules, '.ts')
      expect(result).toBe(
        HEADER_LINE
          + "export * from './auth.ts'\n"
          + "export * from './billing.ts'\n",
      )
    })
  })

  describe('namespace exports', () => {
    const modules = [
      makeModule('auth.ts', 'namespace'),
      makeModule('billing.ts', 'namespace'),
    ]

    it('no extensions', () => {
      const result = renderBarrel(modules, 'none')
      expect(result).toBe(
        HEADER_LINE
          + "export * as Auth from './auth'\n"
          + "export * as Billing from './billing'\n",
      )
    })

    it('.js extensions', () => {
      const result = renderBarrel(modules, '.js')
      expect(result).toBe(
        HEADER_LINE
          + "export * as Auth from './auth.js'\n"
          + "export * as Billing from './billing.js'\n",
      )
    })

    it('.ts extensions', () => {
      const result = renderBarrel(modules, '.ts')
      expect(result).toBe(
        HEADER_LINE
          + "export * as Auth from './auth.ts'\n"
          + "export * as Billing from './billing.ts'\n",
      )
    })
  })

  describe('mixed exports', () => {
    it('handles star and namespace together', () => {
      const modules = [
        makeModule('auth.ts', 'star'),
        makeModule('users.ts', 'namespace'),
      ]
      const result = renderBarrel(modules, '.js')
      expect(result).toBe(
        HEADER_LINE
          + "export * from './auth.js'\n"
          + "export * as Users from './users.js'\n",
      )
    })
  })

  describe('extension mapping', () => {
    it('maps .mts to .mjs in .js mode', () => {
      const modules = [makeModule('utils.mts', 'star')]
      const result = renderBarrel(modules, '.js')
      expect(result).toContain("from './utils.mjs'")
    })

    it('maps .cts to .cjs in .js mode', () => {
      const modules = [makeModule('legacy.cts', 'star')]
      const result = renderBarrel(modules, '.js')
      expect(result).toContain("from './legacy.cjs'")
    })

    it('keeps .mts as-is in .ts mode', () => {
      const modules = [makeModule('utils.mts', 'star')]
      const result = renderBarrel(modules, '.ts')
      expect(result).toContain("from './utils.mts'")
    })
  })

  describe('edge cases', () => {
    it('returns header only for empty modules', () => {
      const result = renderBarrel([], 'none')
      expect(result).toBe(HEADER_LINE)
    })
  })
})
