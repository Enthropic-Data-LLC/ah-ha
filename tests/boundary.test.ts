/**
 * Ah! Today and the modules are layers on core: code under src/today/ and src/modules/
 * reads and writes only through src/core/, never MongoDB, TimescaleDB or Redis directly. Docs: "Ah-Ha: Today as a
 * layer on core". If this fails, add (or use) a function in src/core/ instead.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['today', 'modules'].map(d => join(__dirname, '..', 'src', d))

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\.mongo\b/, 'MongoDB (fastify.mongo)'],
  [/\.redis\b/, 'Redis (fastify.redis)'],
  [/\bgetPool\b|lib\/timescale/, 'TimescaleDB'],
  [/^\s*import\s+(?!type\b)[^;]*from\s+['"]mongodb['"]/m, 'a value import from mongodb (types are fine)'],
  [/^\s*import\s+(?!type\b)[^;]*from\s+['"]\.\.\/(\.\.\/)?lib\/(places|repeat|ical-fetch|situation)\.js['"]/m, 'a core lib directly, past src/core/ (types are fine)'],
]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []
  })
}

describe('Layers → core boundary (Ah! Today, modules)', () => {
  for (const root of ROOTS) it(`${relative(join(__dirname, '..'), root)}/ exists and has code`, () => {
    expect(files(root).length).toBeGreaterThan(0)
  })

  for (const f of ROOTS.flatMap(files)) {
    const ROOT = join(__dirname, '..', 'src')
    it(`${relative(ROOT, f)} reaches data only through src/core/`, () => {
      // Comments may talk about the stores; only code counts.
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      const hits = FORBIDDEN.filter(([re]) => re.test(code)).map(([, what]) => what)
      expect(hits, `${relative(ROOT, f)} uses ${hits.join(', ')}`).toEqual([])
    })
  }
})
