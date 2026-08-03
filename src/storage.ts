import { getLiftDays, liftIds, normalizePlanConfig, roundToPlate } from './plan'
import type { AppData, LiftId, TrainingPlan } from './types'

const STORAGE_KEY = 'strength-cycle-data-v1'

export const defaultData: AppData = {
  version: 1,
  plan: null,
  restSeconds: { squat: 180, bench: 150, deadlift: 210, curl: 90, press: 150 },
  armBandRecords: [],
  pushUpRecords: [],
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultData
    const parsed = JSON.parse(raw) as AppData
    return parsed.version === 1 ? normalizeData(parsed) : defaultData
  } catch {
    return defaultData
  }
}

const sessionOrder = ['bench-main', 'deadlift-light', 'squat-main', 'bench-light', 'deadlift-main', 'squat-light', 'press-main', 'curl-main', 'press-light', 'curl-light']

export function normalizePlan(plan: TrainingPlan): TrainingPlan {
  const config = normalizePlanConfig(plan.config)
  const targets = { ...plan.targets } as Record<LiftId, number>
  for (const lift of liftIds) {
    if (!Number.isFinite(targets[lift])) {
      targets[lift] = roundToPlate(config.lifts[lift].oneRm * (1 + config.growthRate))
    }
  }

  return {
    ...plan,
    config,
    targets,
    sessions: plan.sessions.map((session) => ({
      ...session,
      results: Array.from({ length: session.sets }, (_, index) => session.results?.[index] ?? 'pending'),
      day: session.day ?? getLiftDays(config, session.lift)[session.kind === 'main' ? 0 : 1] ?? getLiftDays(config, session.lift)[0],
    })).sort((a, b) => {
      if (a.week !== b.week) return a.week - b.week
      const aOrder = sessionOrder.indexOf(`${a.lift}-${a.kind}`)
      const bOrder = sessionOrder.indexOf(`${b.lift}-${b.kind}`)
      return (aOrder < 0 ? sessionOrder.length : aOrder) - (bOrder < 0 ? sessionOrder.length : bOrder)
    }),
  }
}

export function normalizeData(data: AppData): AppData {
  return {
    ...data,
    restSeconds: { ...defaultData.restSeconds, ...(data.restSeconds ?? {}) },
    armBandRecords: Array.isArray(data.armBandRecords) ? data.armBandRecords : [],
    pushUpRecords: Array.isArray(data.pushUpRecords) ? data.pushUpRecords.map((record) => ({
      ...record,
      loadType: record.loadType === 'weighted' ? 'weighted' : 'bodyweight',
      weight: Number.isFinite(record.weight) ? record.weight : 0,
    })) : [],
    ...(data.plan ? { plan: normalizePlan(data.plan) } : {}),
  }
}

export function saveData(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function validateBackup(value: unknown): value is AppData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<AppData>
  return data.version === 1 && 'plan' in data && !!data.restSeconds
}
