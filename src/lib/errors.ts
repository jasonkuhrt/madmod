import { Data } from 'effect'

export class ConfigNotFound extends Data.TaggedError('ConfigNotFound')<{
  readonly cwd: string
  readonly searched: readonly string[]
}> {}

export class ConfigInvalid extends Data.TaggedError('ConfigInvalid')<{
  readonly path: string
  readonly message: string
}> {}

export class NamespaceCollision extends Data.TaggedError('NamespaceCollision')<{
  readonly filename1: string
  readonly filename2: string
  readonly derivedName: string
}> {}

export class InvalidIdentifier extends Data.TaggedError('InvalidIdentifier')<{
  readonly filename: string
  readonly result: string
}> {}
