import { defineConfig, type Options } from 'tsup'

// Options shared by both build configs — kept in one place so a change (e.g.
// dropping sourcemaps) can never silently diverge between the CLI and lib builds.
// No sourcemaps: the maps' embedded sourcesContent ships the original
// TypeScript (comments included) into the npm tarball, and nothing consumes
// maps in a published CLI. tsup has no "emit locally but exclude from publish"
// mode, so the build simply doesn't produce them.
const shared: Options = {
  format: ['cjs', 'esm'],
  target: 'node20',
  dts: true,
}

// Two build configs: `banner` applies per-config (not per-entry), so the CLI
// shebang must be scoped to its own config or it lands on the library barrel.
// Only the first config may set `clean: true` — a second clean wipes the first
// config's output.
export default defineConfig([
  {
    ...shared,
    entry: { cli: 'src/cli.ts' },
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    clean: false,
  },
])
