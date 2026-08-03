import { describe, expect, it } from 'vitest'
import { applyAdjustment, generatePlan, roundToPlate, setFlexibleLiftEnabled } from './plan'
import { normalizeData, normalizePlan } from './storage'
import type { AppData, PlanConfig } from './types'

const config: PlanConfig = {
  weeks: 9,
  growthRate: 0.05,
  testAtEnd: false,
  lifts: {
    squat: { oneRm: 120, frequency: 2, days: [1, 4], enabled: true },
    bench: { oneRm: 80, frequency: 2, days: [1, 3], enabled: true },
    deadlift: { oneRm: 150, frequency: 1, days: [2], enabled: true },
    curl: { oneRm: 30, frequency: 1, days: [2], enabled: false },
    press: { oneRm: 50, frequency: 1, days: [3], enabled: false },
  },
}

describe('plan generation', () => {
  it('rounds every load to the nearest 2.5kg', () => {
    expect(roundToPlate(116.4)).toBe(117.5)
    expect(roundToPlate(116.2)).toBe(115)
  })

  it('generates main and light sessions from each lift frequency', () => {
    const plan = generatePlan(config)
    expect(plan.sessions).toHaveLength(45)
    expect(plan.targets).toEqual({ squat: 125, bench: 85, deadlift: 157.5, curl: 32.5, press: 52.5 })

    expect(plan.sessions.slice(0, 5).map((session) => `${session.lift}-${session.kind}`)).toEqual([
      'bench-main', 'squat-main', 'bench-light', 'deadlift-main', 'squat-light',
    ])

    const squatMain = plan.sessions.find((session) => session.id === '1-squat-main')!
    const squatLight = plan.sessions.find((session) => session.id === '1-squat-light')!
    expect(squatLight.weight).toBeLessThan(squatMain.weight)
    expect(squatLight.reps).toBeGreaterThanOrEqual(squatMain.reps)
  })

  it('removes only light slots when a lift is once per week', () => {
    const plan = generatePlan({ ...config, lifts: { ...config.lifts, bench: { oneRm: 80, frequency: 1 } } })
    expect(plan.sessions.slice(0, 4).map((session) => `${session.lift}-${session.kind}`)).toEqual([
      'bench-main', 'squat-main', 'deadlift-main', 'squat-light',
    ])
  })

  it('migrates an existing plan into the fixed weekly order without changing sessions', () => {
    const plan = generatePlan(config)
    const shuffled = { ...plan, sessions: [...plan.sessions].reverse() }
    const normalized = normalizePlan(shuffled)
    expect(normalized.sessions.slice(0, 5).map((session) => `${session.lift}-${session.kind}`)).toEqual([
      'bench-main', 'squat-main', 'bench-light', 'deadlift-main', 'squat-light',
    ])
    expect(normalized.sessions.find((session) => session.id === '2-bench-main')?.weight)
      .toBe(plan.sessions.find((session) => session.id === '2-bench-main')?.weight)
  })

  it('only adjusts future sessions of the failed lift', () => {
    const plan = generatePlan(config)
    const failed = plan.sessions.find((session) => session.id === '2-bench-main')!
    failed.results[0] = 'failed'
    const adjusted = applyAdjustment(plan, failed, 'weight')

    expect(adjusted.sessions.find((session) => session.id === '1-bench-main')?.weight)
      .toBe(plan.sessions.find((session) => session.id === '1-bench-main')?.weight)
    expect(adjusted.sessions.find((session) => session.id === '3-bench-main')?.weight)
      .toBe(plan.sessions.find((session) => session.id === '3-bench-main')!.weight - 2.5)
    expect(adjusted.sessions.find((session) => session.id === '3-squat-main')?.weight)
      .toBe(plan.sessions.find((session) => session.id === '3-squat-main')?.weight)
  })

  it('repeats the prescription for the next week only', () => {
    const plan = generatePlan(config)
    const failed = plan.sessions.find((session) => session.id === '2-squat-main')!
    const adjusted = applyAdjustment(plan, failed, 'repeat')

    expect(adjusted.sessions.find((session) => session.id === '3-squat-main')?.weight).toBe(failed.weight)
    expect(adjusted.sessions.find((session) => session.id === '4-squat-main')?.weight)
      .toBe(plan.sessions.find((session) => session.id === '4-squat-main')?.weight)
  })

  it('keeps optional lifts out of a plan until enabled', () => {
    const plan = generatePlan(config)
    expect(plan.sessions.some((session) => session.lift === 'curl' || session.lift === 'press')).toBe(false)
  })

  it('generates optional lifts with their selected training day', () => {
    const plan = generatePlan({
      ...config,
      lifts: {
        ...config.lifts,
        curl: { oneRm: 30, frequency: 2, days: [4, 6], enabled: true },
      },
    })
    const curlSessions = plan.sessions.filter((session) => session.lift === 'curl')
    expect(curlSessions).toHaveLength(2 * config.weeks)
    expect(curlSessions.filter((session) => session.kind === 'main').every((session) => session.day === 4)).toBe(true)
    expect(curlSessions.filter((session) => session.kind === 'light').every((session) => session.day === 6)).toBe(true)
  })

  it('preserves heavy and light roles when the heavy day is later in the week', () => {
    const plan = generatePlan({
      ...config,
      lifts: {
        ...config.lifts,
        curl: { oneRm: 30, frequency: 2, days: [6, 2], enabled: true },
      },
    })
    expect(plan.sessions.find((session) => session.id === '1-curl-main')?.day).toBe(6)
    expect(plan.sessions.find((session) => session.id === '1-curl-light')?.day).toBe(2)
  })

  it('can add and remove an optional lift after the cycle is created', () => {
    const base = generatePlan(config)
    const enabled = setFlexibleLiftEnabled(base, 'press', true)
    expect(enabled.config.lifts.press.enabled).toBe(true)
    expect(enabled.sessions.filter((session) => session.lift === 'press')).toHaveLength(config.weeks)
    expect(enabled.sessions.find((session) => session.id === '1-press-main')?.day).toBe(6)

    const completedPress = {
      ...enabled,
      sessions: enabled.sessions.map((session) => session.id === '1-press-main' ? { ...session, completedAt: '2026-08-03T08:00:00.000Z' } : session),
    }
    const disabled = setFlexibleLiftEnabled(completedPress, 'press', false)
    expect(disabled.sessions.some((session) => session.id === '1-press-main')).toBe(true)
    expect(disabled.sessions.some((session) => session.lift === 'press' && !session.completedAt)).toBe(false)
    expect(setFlexibleLiftEnabled(disabled, 'press', true).sessions.filter((session) => session.lift === 'press')).toHaveLength(config.weeks)
  })
})

describe('local data migration', () => {
  it('adds an empty arm-band history to legacy data', () => {
    const legacy = {
      version: 1,
      plan: null,
      restSeconds: { squat: 180, bench: 150, deadlift: 210 },
    } as unknown as AppData

    expect(normalizeData(legacy).armBandRecords).toEqual([])
    expect(normalizeData(legacy).pushUpRecords).toEqual([])
    expect(normalizeData(legacy).restSeconds).toMatchObject({ curl: 90, press: 150 })
  })

  it('defaults legacy push-up entries to bodyweight', () => {
    const legacy = {
      version: 1,
      plan: null,
      restSeconds: { squat: 180, bench: 150, deadlift: 210 },
      armBandRecords: [],
      pushUpRecords: [{ id: 'old-pushup', sets: 3, reps: 10, recordedAt: '2026-08-01T08:00:00.000Z' }],
    } as unknown as AppData

    expect(normalizeData(legacy).pushUpRecords[0]).toMatchObject({ loadType: 'bodyweight', weight: 0 })
  })

  it('keeps a legacy three-lift plan valid without adding optional sessions', () => {
    const plan = generatePlan(config)
    const legacyPlan = {
      ...plan,
      config: {
        ...plan.config,
        lifts: {
          squat: plan.config.lifts.squat,
          bench: plan.config.lifts.bench,
          deadlift: plan.config.lifts.deadlift,
        },
      },
    } as unknown as AppData['plan']
    const migrated = normalizeData({
      version: 1,
      plan: legacyPlan,
      restSeconds: { squat: 180, bench: 150, deadlift: 210 },
      armBandRecords: [],
      pushUpRecords: [],
    } as unknown as AppData)

    expect(migrated.plan?.config.lifts.curl.enabled).toBe(false)
    expect(migrated.plan?.sessions).toHaveLength(plan.sessions.length)
    expect(migrated.plan?.sessions.every((session) => session.day)).toBe(true)
  })
})
