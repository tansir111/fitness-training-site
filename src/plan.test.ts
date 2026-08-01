import { describe, expect, it } from 'vitest'
import { applyAdjustment, generatePlan, roundToPlate } from './plan'
import { normalizePlan } from './storage'
import type { PlanConfig } from './types'

const config: PlanConfig = {
  weeks: 9,
  growthRate: 0.05,
  testAtEnd: false,
  lifts: {
    squat: { oneRm: 120, frequency: 2 },
    bench: { oneRm: 80, frequency: 2 },
    deadlift: { oneRm: 150, frequency: 1 },
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
    expect(plan.targets).toEqual({ squat: 125, bench: 85, deadlift: 157.5 })

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
})
