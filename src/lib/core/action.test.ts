import { describe, expect, it } from 'vitest'
import { Action } from './action.js'

describe('Action', () => {
  describe('construction', () => {
    it('creates a Create action', () => {
      const action = Action.Create({ path: '/test/index.ts', content: '// content' })
      expect(action._tag).toBe('Create')
      expect(action.path).toBe('/test/index.ts')
      expect(action.content).toBe('// content')
    })

    it('creates an Update action', () => {
      const action = Action.Update({ path: '/test/index.ts', content: '// updated' })
      expect(action._tag).toBe('Update')
    })

    it('creates a Skip action', () => {
      const action = Action.Skip({ path: '/test/index.ts', reason: 'up-to-date' })
      expect(action._tag).toBe('Skip')
      expect(action.reason).toBe('up-to-date')
    })

    it('creates a Conflict action', () => {
      const action = Action.Conflict({ path: '/test/index.ts', reason: 'hand-written' })
      expect(action._tag).toBe('Conflict')
    })
  })

  describe('$match', () => {
    it('exhaustively matches Create', () => {
      const action = Action.Create({ path: '/p', content: 'c' })
      const result = Action.$match(action, {
        Create: () => 'create',
        Update: () => 'update',
        Skip: () => 'skip',
        Conflict: () => 'conflict',
      })
      expect(result).toBe('create')
    })

    it('exhaustively matches Skip', () => {
      const action = Action.Skip({ path: '/p', reason: 'r' })
      const result = Action.$match(action, {
        Create: () => 'create',
        Update: () => 'update',
        Skip: () => 'skip',
        Conflict: () => 'conflict',
      })
      expect(result).toBe('skip')
    })
  })

  describe('$is', () => {
    it('returns true for matching tag', () => {
      const action = Action.Create({ path: '/p', content: 'c' })
      expect(Action.$is('Create')(action)).toBe(true)
    })

    it('returns false for non-matching tag', () => {
      const action = Action.Create({ path: '/p', content: 'c' })
      expect(Action.$is('Update')(action)).toBe(false)
    })
  })
})
