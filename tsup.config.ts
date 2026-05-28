import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/api.ts', 'src/ws.ts', 'src/presence.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
})
