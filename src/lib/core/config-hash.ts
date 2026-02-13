import { createHash } from 'node:crypto'
import type { ResolvedConfig } from '../config/schema.js'

export const hashConfig = (config: ResolvedConfig): string =>
  createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16)
