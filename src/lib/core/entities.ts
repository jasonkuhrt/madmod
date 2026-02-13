import { Schema } from "effect";

export const ExportStyle = Schema.Literal("star", "namespace");
export type ExportStyle = typeof ExportStyle.Type;

export class ModuleEntry extends Schema.TaggedClass<ModuleEntry>("ModuleEntry")(
  "ModuleEntry",
  {
    filename: Schema.String,
    specifier: Schema.String,
    style: ExportStyle,
    isDirectory: Schema.Boolean,
  },
) {
  static is = Schema.is(ModuleEntry);
}

export class ScanResult extends Schema.TaggedClass<ScanResult>("ScanResult")(
  "ScanResult",
  {
    dir: Schema.String,
    modules: Schema.Array(ModuleEntry),
  },
) {
  static is = Schema.is(ScanResult);
}

export class CacheEntry extends Schema.TaggedClass<CacheEntry>("CacheEntry")(
  "CacheEntry",
  {
    files: Schema.Array(Schema.String),
    barrelContent: Schema.String,
  },
) {
  static is = Schema.is(CacheEntry);
}
