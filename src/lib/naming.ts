import { Array as A, pipe } from 'effect'
import { InvalidIdentifier, NamespaceCollision } from './errors.js'

/**
 * Convert a filename (without extension) to PascalCase for namespace exports.
 * Handles kebab-case, snake_case, and dot-separated names.
 */
export const toPascalCase = (filename: string): string => {
  const stem = filename.replace(/\.[^.]+$/, '')
  const result = stem
    .split(/[-_.]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(result)) {
    throw new InvalidIdentifier({ filename, result })
  }

  return result
}

/**
 * Check for PascalCase collisions among a list of modules.
 * Throws NamespaceCollision if two filenames map to the same PascalCase name.
 */
export const checkCollisions = (
  modules: ReadonlyArray<{ readonly filename: string; readonly style: string }>,
): void => {
  const namespaceModules = pipe(
    modules,
    A.filter((m) => m.style === 'namespace'),
  )

  const seen = new Map<string, string>()
  for (const mod of namespaceModules) {
    const derived = toPascalCase(mod.filename)
    const existing = seen.get(derived)
    if (existing !== undefined) {
      throw new NamespaceCollision({
        filename1: existing,
        filename2: mod.filename,
        derivedName: derived,
      })
    }
    seen.set(derived, mod.filename)
  }
}
