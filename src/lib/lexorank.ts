/**
 * Lexorank-style position helpers using floats.
 * Returns a position value between two neighbors.
 */

export function between(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1.0
  if (before === null) return (after as number) / 2
  if (after === null) return (before as number) + 1.0
  return (before + after) / 2
}

export function initial(): number {
  return 1.0
}
