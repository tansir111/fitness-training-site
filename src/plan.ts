import type { LiftConfig, LiftId, PlanConfig, TrainingPlan, TrainingSession, Weekday } from './types'

export const liftIds: LiftId[] = ['squat', 'bench', 'deadlift', 'curl', 'press']
export const flexibleLiftIds: LiftId[] = ['curl', 'press']

export const DEFAULT_LIFT_DAYS: Record<LiftId, Weekday[]> = {
  squat: [1, 4],
  bench: [1, 3],
  deadlift: [2],
  curl: [2],
  press: [3],
}

export const DEFAULT_LIFT_CONFIGS: Record<LiftId, LiftConfig> = {
  squat: { oneRm: 120, frequency: 2, days: DEFAULT_LIFT_DAYS.squat, enabled: true },
  bench: { oneRm: 80, frequency: 2, days: DEFAULT_LIFT_DAYS.bench, enabled: true },
  deadlift: { oneRm: 150, frequency: 1, days: DEFAULT_LIFT_DAYS.deadlift, enabled: true },
  curl: { oneRm: 30, frequency: 1, days: DEFAULT_LIFT_DAYS.curl, enabled: false },
  press: { oneRm: 50, frequency: 1, days: DEFAULT_LIFT_DAYS.press, enabled: false },
}

function normalizeDays(days: Weekday[] | undefined, fallback: Weekday[], frequency: 1 | 2): Weekday[] {
  const valid = (days ?? []).filter((day): day is Weekday => Number.isInteger(day) && day >= 1 && day <= 7)
  const unique = [...new Set(valid)]
  const merged = [...unique, ...fallback.filter((day) => !unique.includes(day))]
  return (merged.length ? merged : [1]).slice(0, frequency) as Weekday[]
}

export function getLiftDays(config: PlanConfig, lift: LiftId): Weekday[] {
  const liftConfig = config.lifts[lift] ?? DEFAULT_LIFT_CONFIGS[lift]
  return normalizeDays(liftConfig.days, getDefaultLiftDays(config, lift), liftConfig.frequency)
}

export function normalizePlanConfig(config: PlanConfig): PlanConfig {
  const lifts = {} as Record<LiftId, LiftConfig>
  const configuredLifts = config.lifts ?? ({} as Record<LiftId, LiftConfig>)
  for (const lift of liftIds) {
    const fallback = DEFAULT_LIFT_CONFIGS[lift]
    const current = configuredLifts[lift] ?? fallback
    const frequency = current.frequency === 2 ? 2 : 1
    const oneRm = Number.isFinite(current.oneRm) && current.oneRm > 0 ? current.oneRm : fallback.oneRm
    lifts[lift] = {
      ...current,
      oneRm,
      frequency,
      enabled: current.enabled ?? (flexibleLiftIds.includes(lift) ? false : true),
      days: normalizeDays(current.days, getDefaultLiftDays({ ...config, lifts: configuredLifts }, lift), frequency),
    }
  }
  return { ...config, lifts }
}

const weeklyOrder: { lift: LiftId; kind: 'main' | 'light' }[] = [
  { lift: 'bench', kind: 'main' },
  { lift: 'deadlift', kind: 'light' },
  { lift: 'squat', kind: 'main' },
  { lift: 'bench', kind: 'light' },
  { lift: 'deadlift', kind: 'main' },
  { lift: 'squat', kind: 'light' },
  { lift: 'press', kind: 'main' },
  { lift: 'curl', kind: 'main' },
  { lift: 'press', kind: 'light' },
  { lift: 'curl', kind: 'light' },
]

const sessionOrder = new Map(weeklyOrder.map((slot, index) => [`${slot.lift}-${slot.kind}`, index]))

export function getDefaultLiftDays(config: PlanConfig, lift: LiftId): Weekday[] {
  const activeSlots = weeklyOrder.filter((slot) => {
    const fallback = DEFAULT_LIFT_CONFIGS[slot.lift]
    const current = config.lifts?.[slot.lift] ?? fallback
    const enabled = current.enabled ?? !flexibleLiftIds.includes(slot.lift)
    return enabled && (slot.kind === 'main' || current.frequency === 2)
  })
  const daysByLift: Partial<Record<LiftId, Weekday[]>> = {}
  activeSlots.forEach((slot, index) => {
    const days = daysByLift[slot.lift] ?? []
    days.push(((index % 7) + 1) as Weekday)
    daysByLift[slot.lift] = days
  })
  return daysByLift[lift]?.slice(0, config.lifts?.[lift]?.frequency ?? DEFAULT_LIFT_CONFIGS[lift].frequency) ?? DEFAULT_LIFT_DAYS[lift]
}

export function roundToPlate(weight: number): number {
  return Math.round(weight / 2.5) * 2.5
}

function prescription(progress: number) {
  if (progress < 0.16) return { intensity: 0.7, sets: 5, reps: 8 }
  if (progress < 0.31) return { intensity: 0.725, sets: 4, reps: 8 }
  if (progress < 0.46) return { intensity: 0.75, sets: 4, reps: 6 }
  if (progress < 0.61) return { intensity: 0.775, sets: 4, reps: 5 }
  if (progress < 0.74) return { intensity: 0.8, sets: 5, reps: 4 }
  if (progress < 0.84) return { intensity: 0.825, sets: 4, reps: 4 }
  if (progress < 0.93) return { intensity: 0.875, sets: 4, reps: 3 }
  return { intensity: 0.925, sets: 3, reps: 2 }
}

export function generatePlan(config: PlanConfig): TrainingPlan {
  const normalizedConfig = normalizePlanConfig(config)
  const targets = Object.fromEntries(
    liftIds.map((lift) => [lift, roundToPlate(normalizedConfig.lifts[lift].oneRm * (1 + normalizedConfig.growthRate))]),
  ) as Record<LiftId, number>

  const sessions: TrainingSession[] = []
  for (let week = 1; week <= normalizedConfig.weeks; week += 1) {
    const progress = normalizedConfig.weeks === 1 ? 1 : (week - 1) / (normalizedConfig.weeks - 1)
    let weekPlan = prescription(progress)
    const isDeload = normalizedConfig.weeks >= 10 && week % 4 === 0 && week !== normalizedConfig.weeks
    if (isDeload) {
      weekPlan = {
        intensity: Math.max(0.65, weekPlan.intensity - 0.075),
        sets: Math.max(3, weekPlan.sets - 1),
        reps: weekPlan.reps,
      }
    }

    const isTest = normalizedConfig.testAtEnd && week === normalizedConfig.weeks
    const main = isTest ? { intensity: 1, sets: 1, reps: 1 } : weekPlan
    const light = {
      intensity: Math.max(0.55, main.intensity * 0.82),
      sets: Math.max(3, main.sets - 1),
      reps: isTest ? 3 : Math.min(8, main.reps + 2),
    }

    for (const slot of weeklyOrder) {
      if (!normalizedConfig.lifts[slot.lift].enabled) continue
      if (slot.kind === 'light' && normalizedConfig.lifts[slot.lift].frequency !== 2) continue
      const days = getLiftDays(normalizedConfig, slot.lift)
      const day = days[slot.kind === 'main' ? 0 : 1]
      sessions.push(makeSession(week, slot.lift, slot.kind, targets[slot.lift], slot.kind === 'main' ? main : light, day))
    }
  }

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    config: normalizedConfig,
    targets,
    sessions,
  }
}

export function setFlexibleLiftEnabled(plan: TrainingPlan, lift: LiftId, enabled: boolean): TrainingPlan {
  if (!flexibleLiftIds.includes(lift)) return plan

  const configSeed = {
    ...plan.config,
    lifts: {
      ...plan.config.lifts,
      [lift]: { ...plan.config.lifts[lift], enabled },
    },
  }
  if (enabled) {
    configSeed.lifts[lift] = { ...configSeed.lifts[lift], days: getDefaultLiftDays(configSeed, lift) }
  }
  const config = normalizePlanConfig(configSeed)
  const targetPlan = generatePlan(config)
  const firstOpenWeek = plan.sessions.reduce(
    (week, session) => session.completedAt ? week : Math.min(week, session.week),
    plan.config.weeks + 1,
  )
  const keepSessions = plan.sessions.filter((session) => !(session.lift === lift && !session.completedAt))
  const existingIds = new Set(keepSessions.map((session) => session.id))
  const addedSessions = enabled
    ? targetPlan.sessions.filter((session) => session.lift === lift && session.week >= firstOpenWeek && !existingIds.has(session.id))
    : []
  const sessions = [...keepSessions, ...addedSessions].sort((a, b) => {
    if (a.week !== b.week) return a.week - b.week
    return (sessionOrder.get(`${a.lift}-${a.kind}`) ?? weeklyOrder.length) - (sessionOrder.get(`${b.lift}-${b.kind}`) ?? weeklyOrder.length)
  })

  return {
    ...plan,
    config,
    targets: { ...plan.targets, [lift]: targetPlan.targets[lift] },
    sessions,
  }
}

function makeSession(
  week: number,
  lift: LiftId,
  kind: 'main' | 'light',
  target: number,
  prescription: { intensity: number; sets: number; reps: number },
  day?: Weekday,
): TrainingSession {
  return {
    id: `${week}-${lift}-${kind}`,
    week,
    lift,
    kind,
    intensity: Math.round(prescription.intensity * 1000) / 1000,
    weight: roundToPlate(target * prescription.intensity),
    sets: prescription.sets,
    reps: prescription.reps,
    results: Array.from({ length: prescription.sets }, () => 'pending'),
    day,
  }
}

export type AdjustmentType = 'weight' | 'reps' | 'sets' | 'repeat'

export function applyAdjustment(
  plan: TrainingPlan,
  failedSession: TrainingSession,
  type: AdjustmentType,
): TrainingPlan {
  const description: Record<AdjustmentType, string> = {
    weight: '后续重量降低 2.5kg',
    reps: '后续每组减少 1 次',
    sets: '后续减少 1 组',
    repeat: '下周重复本周训练处方',
  }

  const sessions = plan.sessions.map((session) => {
    if (session.id === failedSession.id) return { ...session, adjustment: description[type] }
    if (session.lift !== failedSession.lift || session.week <= failedSession.week || session.completedAt) return session

    if (type === 'weight') return { ...session, weight: Math.max(2.5, session.weight - 2.5) }
    if (type === 'reps') return { ...session, reps: Math.max(1, session.reps - 1) }
    if (type === 'sets') {
      const sets = Math.max(1, session.sets - 1)
      return { ...session, sets, results: session.results.slice(0, sets) }
    }
    if (session.week !== failedSession.week + 1) return session
    const sameKind = plan.sessions.find(
      (item) => item.week === failedSession.week && item.lift === session.lift && item.kind === session.kind,
    )
    return sameKind
      ? { ...session, intensity: sameKind.intensity, weight: sameKind.weight, sets: sameKind.sets, reps: sameKind.reps, results: Array.from({ length: sameKind.sets }, () => 'pending' as const) }
      : session
  })

  return { ...plan, sessions }
}

export function getFailureAdvice(session: TrainingSession): string {
  const firstFailure = session.results.findIndex((result) => result === 'failed')
  if (firstFailure < 0) return ''
  if (firstFailure <= 1) return '较早出现失败，优先降低重量或重复本周。'
  if (firstFailure >= session.sets - 1) return '只差最后一组，优先减少一组或每组一次。'
  return '中段出现失败，建议降低 2.5kg，保持动作质量。'
}
