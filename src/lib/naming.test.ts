import { describe, expect, it } from 'vitest'
import { checkCollisions, toPascalCase } from './naming.js'

describe('toPascalCase', () => {
  it('converts kebab-case', () => {
    expect(toPascalCase('foo-bar.ts')).toBe('FooBar')
  })

  it('converts snake_case', () => {
    expect(toPascalCase('foo_bar.ts')).toBe('FooBar')
  })

  it('converts dot-separated', () => {
    expect(toPascalCase('foo.bar.ts')).toBe('FooBar')
  })

  it('handles single word', () => {
    expect(toPascalCase('auth.ts')).toBe('Auth')
  })

  it('handles already PascalCase', () => {
    expect(toPascalCase('FooBar.ts')).toBe('FooBar')
  })

  it('handles mixed separators', () => {
    expect(toPascalCase('foo-bar_baz.ts')).toBe('FooBarBaz')
  })

  it('strips extension correctly', () => {
    expect(toPascalCase('my-module.mts')).toBe('MyModule')
  })

  it('throws InvalidIdentifier for leading digit', () => {
    expect(() => toPascalCase('123-foo.ts')).toThrow()
  })
})

describe('checkCollisions', () => {
  it('passes with no collisions', () => {
    expect(() =>
      checkCollisions([
        { filename: 'foo-bar.ts', style: 'namespace' },
        { filename: 'baz-qux.ts', style: 'namespace' },
      ])
    ).not.toThrow()
  })

  it('detects PascalCase collisions among namespace modules', () => {
    expect(() =>
      checkCollisions([
        { filename: 'foo-bar.ts', style: 'namespace' },
        { filename: 'foo_bar.ts', style: 'namespace' },
      ])
    ).toThrow()
  })

  it('ignores star modules for collision detection', () => {
    expect(() =>
      checkCollisions([
        { filename: 'foo-bar.ts', style: 'star' },
        { filename: 'foo_bar.ts', style: 'star' },
      ])
    ).not.toThrow()
  })

  it('passes with empty array', () => {
    expect(() => checkCollisions([])).not.toThrow()
  })
})
