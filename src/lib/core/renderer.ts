import { Array as A, pipe } from 'effect'
import { HEADER_LINE } from '../header.js'
import { toPascalCase } from '../naming.js'
import type { ModuleEntry } from './entities.js'

export type ExtensionMode = 'none' | '.js' | '.ts'

/**
 * Map a source filename to its import specifier with the appropriate extension.
 */
const mapExtension = (filename: string, mode: ExtensionMode): string => {
  const stem = filename.replace(/\.[^.]+$/, '')
  switch (mode) {
    case 'none':
      return `./${stem}`
    case '.ts':
      return `./${filename}`
    case '.js': {
      if (filename.endsWith('.mts')) return `./${stem}.mjs`
      if (filename.endsWith('.cts')) return `./${stem}.cjs`
      return `./${stem}.js`
    }
  }
}

/**
 * Render a barrel file's content from a sorted list of modules and an extension mode.
 */
export const renderBarrel = (
  modules: ReadonlyArray<typeof ModuleEntry.Type>,
  extensionMode: ExtensionMode,
): string => {
  const lines = pipe(
    modules,
    A.map((mod) => {
      const specifier = mapExtension(mod.filename, extensionMode)
      switch (mod.style) {
        case 'star':
          return `export * from '${specifier}'`
        case 'namespace': {
          const name = toPascalCase(mod.filename)
          return `export * as ${name} from '${specifier}'`
        }
      }
    }),
  )

  if (A.isEmptyArray(lines)) {
    return HEADER_LINE
  }

  return HEADER_LINE + A.join(lines, '\n') + '\n'
}
