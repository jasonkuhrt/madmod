// Programmatic API
export { loadConfig } from '../lib/config/loader.js'
export { defineConfig, resolveDefaults } from '../lib/config/schema.js'
export { execute, plan } from '../lib/core/planner.js'
export { detectExtensionMode } from '../lib/extensions.js'

// Types
export type { BarrelRule, Config, ExportStyle, ModuleGlob, ResolvedConfig, ResolvedRule } from '../lib/config/schema.js'
export type { Action } from '../lib/core/action.js'
export type { PlanResult } from '../lib/core/planner.js'
export type { ExtensionMode } from '../lib/extensions.js'
