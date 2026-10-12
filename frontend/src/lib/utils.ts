import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Merge conditional class names and de-dupe conflicting Tailwind classes.
// Used by every shadcn/ui component.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Flip one key in a Set, returning a new Set (never mutating the argument — the
// fold/expand state it backs lives in useState, which ignores an in-place edit).
// Call as `setFolded((prev) => toggled(prev, key))`.
// [minX, minY, maxX, maxY] of a list of 2D points. Coordinate-space agnostic — used
// for both lon/lat GeoJSON rings and projected map coordinates.
export function extentOf(points: number[][]): [number, number, number, number] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

export function toggled<T>(set: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
