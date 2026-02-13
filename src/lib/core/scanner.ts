import { Array as A, Effect, Order, pipe } from "effect";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import picomatch from "picomatch";
import { glob } from "tinyglobby";
import type { ExportStyle } from "../config/schema.js";
import type { ResolvedConfig, ResolvedRule } from "../config/schema.js";
import { ModuleEntry, ScanResult } from "./entities.js";

const bySpecifier = Order.mapInput(
  Order.string,
  (m: {
    readonly specifier: string;
    readonly filename: string;
    readonly style: ExportStyle;
    readonly isDirectory: boolean;
    readonly _tag: "ModuleEntry";
  }) => m.specifier,
);

export const scanRule = (
  rule: ResolvedRule,
  config: ResolvedConfig,
  cwd: string,
): Effect.Effect<ReadonlyArray<typeof ScanResult.Type>> =>
  Effect.gen(function* () {
    const dirs = yield* Effect.tryPromise(() =>
      glob(rule.dirs, {
        cwd,
        onlyDirectories: true,
        expandDirectories: false,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.git/**"],
      }),
    ).pipe(Effect.orDie);

    const excludeMatcher = picomatch([...config.exclude]);

    return pipe(
      dirs,
      A.map((dir) => {
        // Determine where to read modules from
        const modulesDir = rule.sourceDir ? join(dir, rule.sourceDir) : dir;
        // Prefix for specifiers when sourceDir is set
        const specifierPrefix = rule.sourceDir ? `${rule.sourceDir}/` : "";

        const entries = readdirSync(modulesDir, { withFileTypes: true });

        // Collect files
        const fileEntries = pipe(
          entries,
          A.filter((e) => e.isFile()),
          A.map((e) => ({
            name: e.name,
            isDirectory: false,
          })),
        );

        // Collect directories that contain a barrel file (index.ts)
        const dirEntries = pipe(
          entries,
          A.filter(
            (e) =>
              e.isDirectory() &&
              existsSync(join(modulesDir, e.name, config.barrelFile)),
          ),
          A.map((e) => ({
            name: e.name,
            isDirectory: true,
          })),
        );

        const allEntries = [...fileEntries, ...dirEntries];

        const modules = pipe(
          rule.modules,
          A.flatMap((moduleGlob) => {
            const includeMatcher = picomatch(moduleGlob.include);
            return pipe(
              allEntries,
              A.filter(
                (entry) =>
                  entry.name !== config.barrelFile &&
                  includeMatcher(entry.name) &&
                  !excludeMatcher(entry.name),
              ),
              A.map((entry) =>
                ModuleEntry.make({
                  filename: entry.name,
                  specifier: entry.isDirectory
                    ? `${specifierPrefix}${entry.name}`
                    : `${specifierPrefix}${entry.name.replace(/\.[^.]+$/, "")}`,
                  style: moduleGlob.style,
                  isDirectory: entry.isDirectory,
                }),
              ),
            );
          }),
          A.dedupeWith((a, b) => a.filename === b.filename),
          A.sort(bySpecifier),
        );

        return ScanResult.make({ dir, modules });
      }),
    );
  });
