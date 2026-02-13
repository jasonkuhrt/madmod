import { Schema } from 'effect'

export const ExportStyle = Schema.Literal('star', 'namespace')
export type ExportStyle = typeof ExportStyle.Type

export const ExtensionConfig = Schema.Literal('auto', 'none', '.js', '.ts')
export type ExtensionConfig = typeof ExtensionConfig.Type

export const ModuleGlob = Schema.Struct({
  include: Schema.String,
  style: ExportStyle,
})
export type ModuleGlob = typeof ModuleGlob.Type

const ModulePattern = Schema.Union(Schema.String, ModuleGlob)

export const BarrelRule = Schema.Struct({
  dirs: Schema.String,
  modules: Schema.optional(Schema.Array(ModulePattern)),
  defaultStyle: Schema.optional(ExportStyle),
})

const FormatterConfig = Schema.Union(
  Schema.Literal('auto', 'biome', 'dprint', 'prettier', 'oxfmt'),
  Schema.Literal(false),
)

export const Config = Schema.Struct({
  extensions: Schema.optional(ExtensionConfig),
  exclude: Schema.optional(Schema.Array(Schema.String)),
  barrelFile: Schema.optional(Schema.String),
  formatter: Schema.optional(FormatterConfig),
  rules: Schema.optional(Schema.Array(BarrelRule)),
})
export type Config = typeof Config.Type

export interface ResolvedConfig {
  readonly extensions: ExtensionConfig
  readonly exclude: readonly string[]
  readonly barrelFile: string
  readonly formatter: 'auto' | 'biome' | 'dprint' | 'prettier' | 'oxfmt' | false
  readonly rules: readonly ResolvedRule[]
}

export interface ResolvedRule {
  readonly dirs: string
  readonly modules: readonly ModuleGlob[]
  readonly defaultStyle: ExportStyle
}

export function defineConfig(config: Config): Config {
  return config
}

export function resolveDefaults(config: Config): ResolvedConfig {
  return {
    extensions: config.extensions ?? 'auto',
    formatter: config.formatter ?? 'auto',
    exclude: config.exclude ?? ['*.test.*', '*.spec.*', '*.stories.*', '*.d.ts'],
    barrelFile: config.barrelFile ?? 'index.ts',
    rules: (config.rules ?? []).map((rule) => {
      const defaultStyle = rule.defaultStyle ?? 'star'
      return {
        dirs: rule.dirs,
        defaultStyle,
        modules: (rule.modules ?? [{ include: './*', style: 'star' as const }]).map((m) =>
          typeof m === 'string' ? { include: m, style: defaultStyle } : m
        ),
      }
    }),
  }
}
