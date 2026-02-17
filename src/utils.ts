export function parseIntervalDays(interval: string): number {
  const match = interval.match(/^(\d+)\s*(d|w|m)$/)
  if (!match) return 90
  const value = parseInt(match[1], 10)
  switch (match[2]) {
    case 'd': return value
    case 'w': return value * 7
    case 'm': return value * 30
    default: return 90
  }
}
