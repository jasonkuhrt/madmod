# madmod

## Package Manager

pnpm

## Release Flow

Manual publish — no CI automation.

### Steps

1. **Bump version**: `npm version <patch|minor|major> --no-git-tag-version`
2. **Build**: `pnpm build` (prepack runs `build:clean` automatically)
3. **Publish**: `npm publish`
4. **Tag**: `git tag v<version> && git push origin v<version>`
5. **GitHub release**: `gh release create v<version> --title "v<version>" --notes "<changelog>"`
6. **Commit**: `git add package.json && git commit -m "release: v<version>"` then push

### Rules

- Always tag after publish, not before (publish can fail)
- Tag format: `v<semver>` (e.g., `v0.2.0`)
- Never publish without building first — `pnpm build` must succeed
- Never publish without types passing — `pnpm check:types` must pass
- Never publish without tests passing — `pnpm test` must pass
- The user handles `npm login` and `npm publish` — agent provides the commands

### Versioning

- `patch`: bug fixes, internal refactors
- `minor`: new features, new CLI commands, new config options
- `major`: breaking changes to config format, CLI flags, or programmatic API

## Checks

- `pnpm check` — runs all checks (types, lint, format, publint, attw, actionlint)
- `pnpm check:types` — type check with tsgo
- `pnpm test` — runs unit + integration tests

## Architecture

- `src/bin/cli.ts` — @effect/cli entry point
- `src/bin/daemon-entry.ts` — forked daemon child process
- `src/lib/config/` — schema + jiti loader
- `src/lib/core/` — scanner, renderer, writer, planner, cache, doctor, formatter
- `src/lib/watch/` — @parcel/watcher + debouncer
- `src/lib/daemon/` — lifecycle (fork, PID, signals)
- `src/lib/ui/` — symbols, format, spinner
- `src/exports/index.ts` — public API barrel

Config files: `madmod.config.ts` (also `.js`, `.mjs`)
Cache: `node_modules/.cache/madmod/`
CLI aliases: `madmod`, `mm`

## Effect Conventions

This project uses Effect heavily. See the `/effect` skill for conventions.

Key patterns:
- `Data.TaggedEnum` for Action and DoctorCheck (use `$match`/`$is`, not switch)
- `Schema.TaggedClass` for domain entities (`.is()`, `.make()`)
- `Data.TaggedError` for typed errors
- Let return types be inferred — don't annotate `never` in error channels when using FileSystem
