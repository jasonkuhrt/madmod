import { Data } from 'effect'

export type Action = Data.TaggedEnum<{
  Create: { readonly path: string; readonly content: string }
  Update: { readonly path: string; readonly content: string }
  Skip: { readonly path: string; readonly reason: string }
  Conflict: { readonly path: string; readonly reason: string }
}>

export const Action = Data.taggedEnum<Action>()
