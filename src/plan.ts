import type { LiftId, PlanConfig, TrainingPlan, TrainingSession } from './types'

export const liftIds: LiftId[] = ['squat', 'bench', 'deadlift']

const weeklyOrder: { lift: LiftId; kind: 'main' | 'light' }[] = [
  { lift: 'bench', kind: 'main' },
  { lift: 'deadlift', kind: 'light' },
  { lift: 'squat', kind: 'main' },
  { lift: 'bench', kind: 'light' },
  { lift: 'deadlift', kind: 'main' },
  { lift: 'squat', kind: 'light' },
]

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
  const targets = Object.fromEntries(
    liftIds.map((lift) => [lift, roundToPlate(config.lifts[lift].oneRm * (1 + config.growthRate))]),
  ) as Record<LiftId, number>

  const sessions: TrainingSession[] = []
  for (let week = 1; week <= config.weeks; week += 1) {
    const progress = config.weeks === 1 ? 1 : (week - 1) / (config.weeks - 1)
    let weekPlan = prescription(progress)
    const isDeload = config.weeks >= 10 && week % 4 === 0 && week !== config.weeks
    if (isDeload) {
      weekPlan = {
        intensity: Math.max(0.65, weekPlan.intensity - 0.075),
        sets: Math.max(3, weekPlan.sets - 1),
        reps: weekPlan.reps,
      }
    }

    const isTest = config.testAtEnd && week === config.weeks
    const main = isTest ? { intensity: 1, sets: 1, reps: 1 } : weekPlan
    const light = {
      intensity: Math.max(0.55, main.intensity * 0.82),
      sets: Math.max(3, main.sets - 1),
      reps: isTest ? 3 : Math.min(8, main.reps + 2),
    }

    for (const slot of weeklyOrder) {
      if (slot.kind === 'light' && config.lifts[slot.lift].frequency !== 2) continue
      sessions.push(makeSession(week, slot.lift, slot.kind, targets[slot.lift], slot.kind === 'main' ? main : light))
    }
  }

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    config,
    targets,
    sessions,
  }
}

function makeSession(
  week: number,
  lift: LiftId,
  kind: 'main' | 'light',
  target: number,
  prescription: { intensity: number; sets: number; reps: number },
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
