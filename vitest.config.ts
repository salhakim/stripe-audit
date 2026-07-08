import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Gate src/** specifically (not just imported files) so an untested module
      // drags the number down instead of hiding — see coverage.include docs.
      include: ['src/**'],
      // FAIL the run when line, function, OR branch coverage on src/ drops below
      // 80%. Gates locally (npm run test:coverage) as well as in CI.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
})
