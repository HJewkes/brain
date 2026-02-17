import { describe, it, expect } from 'vitest'
import { parseIntervalDays } from '../src/utils.js'

describe('parseIntervalDays', () => {
  it('parses days', () => {
    expect(parseIntervalDays('30d')).toBe(30)
    expect(parseIntervalDays('1d')).toBe(1)
  })

  it('parses weeks', () => {
    expect(parseIntervalDays('4w')).toBe(28)
    expect(parseIntervalDays('1w')).toBe(7)
  })

  it('parses months', () => {
    expect(parseIntervalDays('6m')).toBe(180)
    expect(parseIntervalDays('1m')).toBe(30)
  })

  it('returns 90 for invalid formats', () => {
    expect(parseIntervalDays('')).toBe(90)
    expect(parseIntervalDays('abc')).toBe(90)
    expect(parseIntervalDays('30')).toBe(90)
  })
})
