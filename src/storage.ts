import type { AppData, TrainingPlan } from './types'

const STORAGE_KEY = 'strength-cycle-data-v1'

export const defaultData: AppData = {
  version: 1,
  plan: null,
  restSeconds: { squat: 180, bench: 150, deadlift: 210 },
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

const sessionOrder = ['bench-main', 'deadlift-light', 'squat-main', 'bench-light', 'deadlift-main', 'squat-light']

export function normalizePlan(plan: TrainingPlan): TrainingPlan {
  return {
    ...plan,
    sessions: [...plan.sessions].sort((a, b) => {
      if (a.week !== b.week) return a.week - b.week
      return sessionOrder.indexOf(`${a.lift}-${a.kind}`) - sessionOrder.indexOf(`${b.lift}-${b.kind}`)
    }),
  }
}

export function normalizeData(data: AppData): AppData {
  return data.plan ? { ...data, plan: normalizePlan(data.plan) } : data
}

export function saveData(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function validateBackup(value: unknown): value is AppData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<AppData>
  return data.version === 1 && 'plan' in data && !!data.restSeconds
}
