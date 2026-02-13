import { Array as A, pipe } from "effect";
import { HEADER_LINE } from "../header.js";
import { toPascalCase } from "../naming.js";
import type { ModuleEntry } from "./entities.js";

export type ExtensionMode = "none" | ".js" | ".ts";

/**
 * Map a source file's specifier to its import path with the appropriate extension.
 * Directory modules never get extensions — they resolve via their index file.
 */
const mapSpecifier = (
  mod: typeof ModuleEntry.Type,
  mode: ExtensionMode,
): string => {
  if (mod.isDirectory) {
    return `./${mod.specifier}`;
  }

  switch (mode) {
    case "none":
      return `./${mod.specifier}`;
    case ".ts": {
      // In .ts mode, preserve the original file extension (.ts, .mts, .cts)
      const ext = mod.filename.match(/\.[^.]+$/)?.[0] ?? ".ts";
      return `./${mod.specifier}${ext}`;
    }
    case ".js": {
      const filename = mod.filename;
      if (filename.endsWith(".mts")) return `./${mod.specifier}.mjs`;
      if (filename.endsWith(".cts")) return `./${mod.specifier}.cjs`;
      return `./${mod.specifier}.js`;
    }
  }
};

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
      const specifier = mapSpecifier(mod, extensionMode);
      switch (mod.style) {
        case "star":
          return `export * from '${specifier}';`;
        case "namespace": {
          const name = toPascalCase(mod.filename);
          return `export * as ${name} from '${specifier}';`;
        }
      }
    }),
  );

  if (A.isEmptyArray(lines)) {
    return HEADER_LINE;
  }

  return HEADER_LINE + A.join(lines, "\n") + "\n";
};
