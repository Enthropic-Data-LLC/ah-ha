import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/api.ts', 'src/ws.ts', 'src/presence.ts', 'src/mqtt-bridge.ts', 'src/notifier.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  external: ["ical.js"],
})
