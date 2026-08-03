export type LiftId = 'squat' | 'bench' | 'deadlift' | 'curl' | 'press'
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type SessionKind = 'main' | 'light'
export type SetResult = 'pending' | 'done' | 'failed'
export type ArmBandDifficulty = 'normal' | 'extreme'
export type PushUpLoadType = 'bodyweight' | 'weighted'

export interface LiftConfig {
  oneRm: number
  frequency: 1 | 2
  days?: Weekday[]
  enabled?: boolean
}

export interface PlanConfig {
  weeks: number
  growthRate: number
  testAtEnd: boolean
  lifts: Record<LiftId, LiftConfig>
}

export interface TrainingSession {
  id: string
  week: number
  lift: LiftId
  kind: SessionKind
  intensity: number
  weight: number
  sets: number
  reps: number
  results: SetResult[]
  day?: Weekday
  completedAt?: string
  adjustment?: string
}

export interface TrainingPlan {
  id: string
  createdAt: string
  config: PlanConfig
  targets: Record<LiftId, number>
  sessions: TrainingSession[]
}

export interface ArmBandRecord {
  id: string
  difficulty: ArmBandDifficulty
  resistance: number
  sets: number
  reps: number
  recordedAt: string
}

export interface PushUpRecord {
  id: string
  loadType: PushUpLoadType
  weight: number
  sets: number
  reps: number
  recordedAt: string
}

export interface AppData {
  version: 1
  plan: TrainingPlan | null
  restSeconds: Record<LiftId, number>
  armBandRecords: ArmBandRecord[]
  pushUpRecords: PushUpRecord[]
}

export const LIFT_NAMES: Record<LiftId, string> = {
  squat: '深蹲',
  bench: '卧推',
  deadlift: '硬拉',
  curl: '二头弯举',
  press: '实力推',
}
