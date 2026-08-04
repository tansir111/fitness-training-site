import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Barbell,
  CalendarDots,
  ChartLineUp,
  Check,
  CopySimple,
  DownloadSimple,
  GearSix,
  HandFist,
  House,
  Minus,
  Microphone,
  MicrophoneSlash,
  Notebook,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Repeat,
  Timer as TimerIcon,
  Trash,
  UploadSimple,
  WechatLogo,
  X,
} from '@phosphor-icons/react'
import { applyAdjustment, flexibleLiftIds, generatePlan, getDefaultLiftDays, getFailureAdvice, getLiftDays, liftIds, setFlexibleLiftEnabled, type AdjustmentType } from './plan'
import { defaultData, loadData, normalizeData, saveData, validateBackup } from './storage'
import { LIFT_NAMES, type AppData, type ArmBandDifficulty, type ArmBandRecord, type LiftId, type MemoRecord, type PlanConfig, type PushUpLoadType, type PushUpRecord, type SetResult, type TrainingSession, type Weekday } from './types'
import benchIcon from './assets/bench-v3.png'
import deadliftIcon from './assets/deadlift-v3.png'
import squatIcon from './assets/squat-v3.png'
import curlIcon from './assets/curl-v3.png'
import pressIcon from './assets/press-v3.png'
import armBandTabIcon from './assets/armband-tab-icon.png'
import pushUpTabIcon from './assets/pushup-icon-xiaoxin8.png'
import navOtherMask from './assets/imagegen2/nav-other-mask.png'
import navSettingsMask from './assets/imagegen2/nav-settings-mask.png'
import alarmSoundUrl from './assets/cheerful-notification-simple.mp3'

type View = 'today' | 'plan' | 'progress' | 'other' | 'settings'

type SpeechRecognitionResultEvent = Event & {
  resultIndex: number
  results: {
    length: number
    [index: number]: { isFinal: boolean; [index: number]: { transcript: string } }
  }
}

type SpeechRecognitionErrorEvent = Event & { error?: string }
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

const AUTHOR_WECHAT = 'ABC2023393253'

const navItems: { id: View; label: string; icon: typeof House }[] = [
  { id: 'today', label: '训练', icon: House },
  { id: 'plan', label: '计划', icon: CalendarDots },
  { id: 'progress', label: '进度', icon: ChartLineUp },
  { id: 'other', label: '其它', icon: HandFist },
  { id: 'settings', label: '设置', icon: GearSix },
]

const liftIcons: Partial<Record<LiftId, string>> = {
  squat: squatIcon,
  bench: benchIcon,
  deadlift: deadliftIcon,
  curl: curlIcon,
  press: pressIcon,
}

const liftSymbolText: Record<LiftId, string> = {
  squat: '蹲',
  bench: '推',
  deadlift: '拉',
  curl: '弯',
  press: '推',
}

const WEEKDAY_OPTIONS: { value: Weekday; label: string }[] = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' },
]

const majorLiftRank: Record<LiftId, number> = { squat: 0, bench: 1, deadlift: 2, press: 3, curl: 4 }
const majorLifts = new Set<LiftId>(['squat', 'bench', 'deadlift'])

function compareTrainingSessions(a: TrainingSession, b: TrainingSession) {
  const dayDifference = (a.day ?? 8) - (b.day ?? 8)
  if (dayDifference !== 0) return dayDifference

  const majorDifference = Number(!majorLifts.has(a.lift)) - Number(!majorLifts.has(b.lift))
  if (majorDifference !== 0) return majorDifference

  const kindDifference = Number(a.kind !== 'main') - Number(b.kind !== 'main')
  if (kindDifference !== 0) return kindDifference
  return majorLiftRank[a.lift] - majorLiftRank[b.lift]
}

function WeekdayPicker({
  lift,
  frequency,
  days,
  onChange,
  disabled = false,
}: {
  lift: LiftId
  frequency: 1 | 2
  days: Weekday[]
  onChange: (days: Weekday[]) => void
  disabled?: boolean
}) {
  const selectDay = (day: Weekday) => {
    if (disabled) return
    if (days.includes(day)) {
      if (days.length === 1) return
      onChange(days.filter((value) => value !== day))
      return
    }

    const next = days.length < frequency ? [...days, day] : [days[0], day]
    onChange(next as Weekday[])
  }

  return (
    <div className="day-picker" role="group" aria-label={`${LIFT_NAMES[lift]}训练日`}>
      {WEEKDAY_OPTIONS.map((option) => (
        <button
          type="button"
          key={option.value}
          disabled={disabled}
          className={[days.includes(option.value) ? 'selected' : '', days[0] === option.value ? 'heavy-day' : '', days[1] === option.value ? 'light-day' : ''].filter(Boolean).join(' ')}
          onClick={() => selectDay(option.value)}
        >
          周{option.label}
        </button>
      ))}
      <div className="day-picker-footer"><span>重日 {days[0] ? `周${WEEKDAY_OPTIONS.find((option) => option.value === days[0])?.label}` : '未选'}</span>{frequency === 2 && <><span>轻日 {days[1] ? `周${WEEKDAY_OPTIONS.find((option) => option.value === days[1])?.label}` : '未选'}</span>{days.length === 2 && <button type="button" disabled={disabled} className="day-swap" onClick={() => onChange([days[1], days[0]])}><Repeat />交换重日/轻日</button>}</>}</div>
    </div>
  )
}

export function App() {
  const [data, setData] = useState<AppData>(loadData)
  const [view, setView] = useState<View>('today')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [adjustingId, setAdjustingId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  useEffect(() => saveData(data), [data])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (!data.plan) {
    if (view === 'other') {
      return <OtherView armBandRecords={data.armBandRecords} pushUpRecords={data.pushUpRecords} memos={data.memos} setData={setData} notify={setToast} standalone onBack={() => setView('today')} />
    }
    return <PlanSetup onCreate={(config) => setData((current) => ({ ...current, plan: generatePlan(config) }))} onOpenOther={() => setView('other')} />
  }

  const plan = data.plan
  const activeSession = plan.sessions.find((session) => session.id === activeSessionId)
  const adjustingSession = plan.sessions.find((session) => session.id === adjustingId)

  const updateSession = (sessionId: string, updater: (session: TrainingSession) => TrainingSession) => {
    setData((current) => current.plan ? {
      ...current,
      plan: { ...current.plan, sessions: current.plan.sessions.map((session) => session.id === sessionId ? updater(session) : session) },
    } : current)
  }

  const finishSession = (session: TrainingSession) => {
    const failed = session.results.includes('failed')
    updateSession(session.id, (current) => ({
      ...current,
      results: current.results.map((result) => result === 'pending' ? 'failed' : result),
      completedAt: new Date().toISOString(),
    }))
    setActiveSessionId(null)
    if (failed || session.results.includes('pending')) setAdjustingId(session.id)
    else setToast('训练已完成，做得很稳。')
  }

  const chooseAdjustment = (type: AdjustmentType) => {
    if (!adjustingSession) return
    setData((current) => current.plan ? { ...current, plan: applyAdjustment(current.plan, adjustingSession, type) } : current)
    setAdjustingId(null)
    setToast('后续计划已更新。')
  }

  const updateLiftSchedule = (lift: LiftId, days: Weekday[]) => {
    setData((current) => current.plan ? {
      ...current,
      plan: {
        ...current.plan,
        config: {
          ...current.plan.config,
          lifts: { ...current.plan.config.lifts, [lift]: { ...current.plan.config.lifts[lift], days } },
        },
        sessions: current.plan.sessions.map((session) => {
          if (session.lift !== lift || session.completedAt) return session
          const day = days[session.kind === 'main' ? 0 : 1] ?? days[0]
          return { ...session, day }
        }),
      },
    } : current)
  }

  const updateLiftEnabled = (lift: LiftId, enabled: boolean) => {
    setData((current) => current.plan ? { ...current, plan: setFlexibleLiftEnabled(current.plan, lift, enabled) } : current)
    setToast(enabled ? `${LIFT_NAMES[lift]}已加入后续计划` : `${LIFT_NAMES[lift]}已从后续计划移除`)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="主导航">
          {navItems.map((item) => <NavButton key={item.id} item={item} active={view === item.id} onClick={() => setView(item.id)} />)}
        </nav>
        <div className="sidebar-cycle">
          <span>当前周期</span>
          <strong>{plan.config.weeks} 周 · {Math.round(plan.config.growthRate * 1000) / 10}% 增幅</strong>
        </div>
      </aside>

      <main className="main-content">
        {view === 'today' && <TodayView plan={plan} onStart={setActiveSessionId} />}
        {view === 'plan' && <PlanView plan={plan} onStart={setActiveSessionId} onScheduleChange={updateLiftSchedule} onEnabledChange={updateLiftEnabled} />}
        {view === 'progress' && <ProgressView plan={plan} />}
        {view === 'other' && <OtherView armBandRecords={data.armBandRecords} pushUpRecords={data.pushUpRecords} memos={data.memos} setData={setData} notify={setToast} />}
        {view === 'settings' && <SettingsView data={data} setData={setData} notify={setToast} />}
      </main>

      <nav className="bottom-nav" aria-label="主导航">
        {navItems.map((item) => <NavButton key={item.id} item={item} active={view === item.id} onClick={() => setView(item.id)} />)}
      </nav>

      {activeSession && (
        <WorkoutView
          session={activeSession}
          restSeconds={data.restSeconds[activeSession.lift]}
          onRestChange={(seconds) => setData((current) => ({ ...current, restSeconds: { ...current.restSeconds, [activeSession.lift]: seconds } }))}
          onSetResult={(index, result) => updateSession(activeSession.id, (session) => ({ ...session, results: session.results.map((value, setIndex) => setIndex === index ? result : value) }))}
          onClose={() => setActiveSessionId(null)}
          onFinish={() => finishSession(activeSession)}
        />
      )}

      {adjustingSession && <AdjustmentSheet session={adjustingSession} onChoose={chooseAdjustment} onSkip={() => setAdjustingId(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><Barbell weight="bold" /></span><span><strong>稳步</strong><small>力量训练周期</small></span></div>
}

function NavButton({ item, active, onClick }: { item: typeof navItems[number]; active: boolean; onClick: () => void }) {
  const Icon = item.icon
  const navIcon = item.id === 'other'
    ? <span className="nav-image-icon nav-image-icon-other" style={{ '--nav-mask': `url(${navOtherMask})` } as React.CSSProperties} aria-hidden="true" />
    : item.id === 'settings'
      ? <span className="nav-image-icon nav-image-icon-settings" style={{ '--nav-mask': `url(${navSettingsMask})` } as React.CSSProperties} aria-hidden="true" />
      : <Icon weight={active ? 'fill' : 'regular'} />
  return <button className={active ? 'nav-button active' : 'nav-button'} onClick={onClick}>{navIcon}<span>{item.label}</span></button>
}

function PlanSetup({ onCreate, onOpenOther }: { onCreate: (config: PlanConfig) => void; onOpenOther: () => void }) {
  const [step, setStep] = useState(1)
  const [weeks, setWeeks] = useState(9)
  const [customWeeks, setCustomWeeks] = useState(false)
  const [growthRate, setGrowthRate] = useState(0.05)
  const [testAtEnd, setTestAtEnd] = useState(false)
  const [lifts, setLifts] = useState<PlanConfig['lifts']>({
    squat: { oneRm: 120, frequency: 2, enabled: true },
    bench: { oneRm: 80, frequency: 2, enabled: true },
    deadlift: { oneRm: 150, frequency: 1, enabled: true },
    curl: { oneRm: 30, frequency: 1, enabled: false },
    press: { oneRm: 50, frequency: 1, enabled: false },
  })
  const valid = liftIds.every((lift) => {
    const config = lifts[lift]
    const optional = flexibleLiftIds.includes(lift)
    return (optional && !config.enabled) || (Number.isFinite(config.oneRm) && config.oneRm > 0)
  }) && weeks >= 4 && weeks <= 20

  const updateLift = (lift: LiftId, patch: Partial<PlanConfig['lifts'][LiftId]>) => setLifts((current) => ({ ...current, [lift]: { ...current[lift], ...patch } }))
  const toggleLiftEnabled = (lift: LiftId, enabled: boolean) => updateLift(lift, { enabled })
  const setFrequency = (lift: LiftId, frequency: 1 | 2) => setLifts((current) => {
    const nextLifts = { ...current, [lift]: { ...current[lift], frequency } }
    const setupConfig = { weeks, growthRate, testAtEnd, lifts: nextLifts }
    const currentDays = current[lift].days ?? []
    const fallbackDays = getDefaultLiftDays(setupConfig, lift)
    const days = [...currentDays, ...fallbackDays.filter((day) => !currentDays.includes(day))].slice(0, frequency) as Weekday[]
    return { ...current, [lift]: { ...current[lift], frequency, days } }
  })
  const setupConfig = { weeks, growthRate, testAtEnd, lifts }

  return (
    <main className="setup-page">
      <header className="setup-header"><Brand /><span>第 {step} / 2 步</span></header>
      <div className="setup-layout">
        <section className="setup-intro">
          <span className="kicker">从现在，走向更强</span>
          <h1>{step === 1 ? '先记录你的起点' : '选择你的节奏'}</h1>
          <p>{step === 1 ? '填写三大项当前真实 1RM。计划会用它计算每周训练重量。' : '周期越长，进步会更从容。每次重量都会自动取整到 2.5kg。'}</p>
          <div className="setup-progress" aria-hidden="true"><span className={step >= 1 ? 'filled' : ''} /><span className={step >= 2 ? 'filled' : ''} /></div>
        </section>

        <section className="setup-form">
          {step === 1 ? (
            <div className="lift-inputs">
              {liftIds.map((lift) => (
                <div className={`lift-input ${flexibleLiftIds.includes(lift) && !lifts[lift].enabled ? 'optional-disabled' : ''}`} key={lift}>
                  <div>
                    <label htmlFor={`${lift}-rm`}>{LIFT_NAMES[lift]}</label>
                    <small>{flexibleLiftIds.includes(lift) ? '可选动作 · 当前 1RM' : '当前 1RM'}</small>
                    {flexibleLiftIds.includes(lift) && <label className="lift-enable-toggle"><input type="checkbox" checked={Boolean(lifts[lift].enabled)} onChange={(event) => toggleLiftEnabled(lift, event.target.checked)} /><span>加入计划</span></label>}
                  </div>
                  <div className="weight-field"><input id={`${lift}-rm`} type="number" min="2.5" step="2.5" value={lifts[lift].oneRm} disabled={flexibleLiftIds.includes(lift) && !lifts[lift].enabled} onChange={(event) => updateLift(lift, { oneRm: Number(event.target.value) })} /><span>kg</span></div>
                  <div className="frequency-control" aria-label={`${LIFT_NAMES[lift]}每周频率`}>
                    {[1, 2].map((frequency) => <button type="button" disabled={flexibleLiftIds.includes(lift) && !lifts[lift].enabled} key={frequency} className={lifts[lift].frequency === frequency ? 'selected' : ''} onClick={() => setFrequency(lift, frequency as 1 | 2)}>每周 {frequency} 次</button>)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="cycle-options">
              <fieldset><legend>训练周期</legend><div className="option-grid">{[6, 8, 9, 12].map((value) => <button key={value} className={!customWeeks && weeks === value ? 'selected' : ''} onClick={() => { setWeeks(value); setCustomWeeks(false) }}>{value} 周</button>)}<button className={customWeeks ? 'selected' : ''} onClick={() => setCustomWeeks(true)}>自定义</button></div>{customWeeks && <label className="custom-weeks">周期周数<input type="number" min="4" max="20" value={weeks} onChange={(event) => setWeeks(Number(event.target.value))} /></label>}</fieldset>
              <fieldset><legend>目标增幅</legend><div className="growth-options">{[{ label: '保守', value: 0.025 }, { label: '标准', value: 0.05 }, { label: '激进', value: 0.075 }].map((option) => <button key={option.label} className={growthRate === option.value ? 'selected' : ''} onClick={() => setGrowthRate(option.value)}><strong>{option.label}</strong><span>+{option.value * 100}%</span></button>)}</div><label className="range-label"><span>微调目标增幅 <strong>{Math.round(growthRate * 1000) / 10}%</strong></span><input type="range" min="1" max="10" step="0.5" value={growthRate * 100} onChange={(event) => setGrowthRate(Number(event.target.value) / 100)} /></label></fieldset>
              <fieldset className="schedule-fieldset"><legend>训练日安排</legend>{liftIds.map((lift) => { const enabled = !flexibleLiftIds.includes(lift) || Boolean(lifts[lift].enabled); return <div className={`schedule-row ${!enabled ? 'schedule-row-disabled' : ''}`} key={lift}><div className="schedule-row-heading"><div><strong>{LIFT_NAMES[lift]}</strong><small>{enabled ? (lifts[lift].frequency === 2 ? '选择重日和轻日' : '选择重训练日') : '未加入计划'}</small></div></div><WeekdayPicker lift={lift} frequency={lifts[lift].frequency} days={lifts[lift].days ?? getDefaultLiftDays(setupConfig, lift)} disabled={!enabled} onChange={(days) => updateLift(lift, { days })} /></div> })}</fieldset>
              <label className="toggle-row"><span><strong>周期末测试目标 1RM</strong><small>关闭时安排高强度低次数训练</small></span><input type="checkbox" checked={testAtEnd} onChange={(event) => setTestAtEnd(event.target.checked)} /></label>
            </div>
          )}

          <div className="setup-actions">
            {step === 2 && <button className="secondary-button" onClick={() => setStep(1)}>返回修改</button>}
            {step === 1 ? <button className="primary-button" disabled={!valid} onClick={() => setStep(2)}>继续设置<ArrowRight /></button> : <button className="primary-button" disabled={!valid} onClick={() => onCreate({ weeks, growthRate, testAtEnd, lifts })}>生成训练计划<ArrowRight /></button>}
          </div>
          <button className="setup-armband-link" onClick={onOpenOther}><HandFist />先记录其它训练</button>
        </section>
      </div>
    </main>
  )
}

const ARM_BAND_RESISTANCES = Array.from({ length: 10 }, (_, index) => (index + 1) * 10)

function getWeekStart(date = new Date()) {
  const start = new Date(date)
  const day = start.getDay()
  const offset = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + offset)
  start.setHours(0, 0, 0, 0)
  return start
}

function formatArmBandDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type OtherTab = 'armband' | 'pushup' | 'memo'

function OtherView({ armBandRecords, pushUpRecords, memos, setData, notify, standalone = false, onBack }: {
  armBandRecords: ArmBandRecord[]
  pushUpRecords: PushUpRecord[]
  memos: MemoRecord[]
  setData: React.Dispatch<React.SetStateAction<AppData>>
  notify: (message: string) => void
  standalone?: boolean
  onBack?: () => void
}) {
  const [tab, setTab] = useState<OtherTab>('armband')

  return (
    <div className={standalone ? 'page other-page standalone-other' : 'page other-page'}>
      {standalone && <header className="other-standalone-header"><Brand /><button className="secondary-button" onClick={onBack}><House />返回计划</button></header>}
      <PageHeader eyebrow="其它记录" title="其它" detail="记录臂力棒、俯卧撑和训练备忘，数据只保存在当前浏览器。" />
      <div className="other-tabs" role="tablist" aria-label="其它记录类型">
        <button type="button" role="tab" aria-selected={tab === 'armband'} className={tab === 'armband' ? 'active' : ''} onClick={() => setTab('armband')}><img className="other-tab-icon" src={armBandTabIcon} alt="" />臂力棒</button>
        <button type="button" role="tab" aria-selected={tab === 'pushup'} className={tab === 'pushup' ? 'active' : ''} onClick={() => setTab('pushup')}><img className="other-tab-icon" src={pushUpTabIcon} alt="" />俯卧撑</button>
        <button type="button" role="tab" aria-selected={tab === 'memo'} className={tab === 'memo' ? 'active' : ''} onClick={() => setTab('memo')}><Notebook weight="bold" />备忘录</button>
      </div>
      {tab !== 'memo' && <OtherTrainingTools />}
      {tab === 'armband'
        ? <ArmBandView records={armBandRecords} setData={setData} notify={notify} />
        : tab === 'pushup'
          ? <PushUpView records={pushUpRecords} setData={setData} notify={notify} />
          : <MemoView records={memos} setData={setData} notify={notify} />}
    </div>
  )
}

function OtherTrainingTools() {
  const [completedSets, setCompletedSets] = useState(0)

  return (
    <section className="other-tools" aria-label="其它训练辅助">
      <div className="section-heading"><div><h2>训练辅助</h2><span>记录组间休息和本次完成组数</span></div><button className="text-button other-tools-reset" type="button" onClick={() => setCompletedSets(0)}>清零组数</button></div>
      <RestTimer initialSeconds={90} onDefaultChange={() => undefined} />
      <div className="set-counter">
        <div className="set-counter-display"><span>已完成组数</span><div><strong>{completedSets}</strong><small>组</small></div></div>
        <div className="set-counter-actions"><button type="button" className="set-counter-button" title="撤销一组" aria-label="撤销一组" disabled={completedSets === 0} onClick={() => setCompletedSets((value) => Math.max(0, value - 1))}><Minus /></button><button type="button" className="set-counter-button primary" title="完成一组" aria-label="完成一组" onClick={() => setCompletedSets((value) => value + 1)}><Plus /></button></div>
      </div>
    </section>
  )
}

function ArmBandView({ records, setData, notify }: {
  records: ArmBandRecord[]
  setData: React.Dispatch<React.SetStateAction<AppData>>
  notify: (message: string) => void
}) {
  const [difficulty, setDifficulty] = useState<ArmBandDifficulty>('normal')
  const [resistance, setResistance] = useState(10)
  const [sets, setSets] = useState(3)
  const [reps, setReps] = useState(10)
  const [editingId, setEditingId] = useState<string | null>(null)
  const orderedRecords = [...records].sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
  const weekStart = getWeekStart()
  const weekRecords = orderedRecords.filter((record) => new Date(record.recordedAt) >= weekStart)
  const totalSets = records.reduce((sum, record) => sum + record.sets, 0)
  const totalReps = records.reduce((sum, record) => sum + record.sets * record.reps, 0)

  const resetForm = () => {
    setDifficulty('normal')
    setResistance(10)
    setSets(3)
    setReps(10)
    setEditingId(null)
  }

  const saveRecord = () => {
    if (!ARM_BAND_RESISTANCES.includes(resistance) || !Number.isFinite(sets) || !Number.isFinite(reps) || sets < 1 || reps < 1) {
      notify('请填写有效的阻力、组数和次数。')
      return
    }
    const nextRecord: ArmBandRecord = {
      id: editingId ?? `armband-${Date.now()}`,
      difficulty,
      resistance,
      sets: Math.round(sets),
      reps: Math.round(reps),
      recordedAt: editingId ? records.find((record) => record.id === editingId)?.recordedAt ?? new Date().toISOString() : new Date().toISOString(),
    }
    setData((current) => ({
      ...current,
      armBandRecords: editingId
        ? current.armBandRecords.map((record) => record.id === editingId ? nextRecord : record)
        : [nextRecord, ...current.armBandRecords],
    }))
    notify(editingId ? '臂力棒记录已修改。' : '臂力棒记录已保存。')
    resetForm()
  }

  const editRecord = (record: ArmBandRecord) => {
    setDifficulty(record.difficulty)
    setResistance(record.resistance)
    setSets(record.sets)
    setReps(record.reps)
    setEditingId(record.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const deleteRecord = (id: string) => {
    if (!window.confirm('确定删除这条臂力棒记录吗？')) return
    setData((current) => ({ ...current, armBandRecords: current.armBandRecords.filter((record) => record.id !== id) }))
    if (editingId === id) resetForm()
    notify('臂力棒记录已删除。')
  }

  return (
      <div className="armband-layout">
        <section className="armband-form-panel">
          <div className="section-heading"><h2>{editingId ? '修改记录' : '记录一次训练'}</h2><span>每次填写一条</span></div>
          <fieldset className="armband-fieldset">
            <legend>阻力类型</legend>
            <div className="difficulty-switch" role="group" aria-label="阻力类型">
              <button type="button" className={difficulty === 'normal' ? 'selected' : ''} onClick={() => setDifficulty('normal')}>普通</button>
              <button type="button" className={difficulty === 'extreme' ? 'selected extreme' : ''} onClick={() => setDifficulty('extreme')}>极难</button>
            </div>
          </fieldset>
          <div className="armband-input-grid">
            <label><span>具体阻力</span><select value={resistance} onChange={(event) => setResistance(Number(event.target.value))}>{ARM_BAND_RESISTANCES.map((value) => <option value={value} key={value}>{value} kg</option>)}</select></label>
            <label><span>组数</span><input type="number" min="1" max="99" step="1" value={sets} onChange={(event) => setSets(Number(event.target.value))} /></label>
            <label><span>每组次数</span><input type="number" min="1" max="999" step="1" value={reps} onChange={(event) => setReps(Number(event.target.value))} /></label>
          </div>
          <div className="armband-form-actions">
            {editingId && <button className="secondary-button" onClick={resetForm}>取消修改</button>}
            <button className="primary-button" onClick={saveRecord}><Check weight="bold" />{editingId ? '保存修改' : '保存记录'}</button>
          </div>
        </section>

        <section className="armband-stats-section">
          <div className="section-heading"><h2>训练统计</h2><span>自动汇总</span></div>
          <div className="armband-stats">
            <div className="armband-stat-primary"><span>本周训练</span><strong>{weekRecords.length}</strong><small>次记录</small></div>
            <div><span>累计组数</span><strong>{totalSets}</strong><small>组</small></div>
            <div><span>累计次数</span><strong>{totalReps}</strong><small>次</small></div>
          </div>
        </section>

        <section className="armband-history-section">
          <div className="section-heading"><h2>历史记录</h2><span>{orderedRecords.length} 条</span></div>
          {orderedRecords.length ? <div className="armband-history-list">{orderedRecords.map((record) => (
            <article className="armband-record" key={record.id}>
              <div className="armband-record-main"><div><strong>{record.difficulty === 'extreme' ? '极难' : '普通'} · {record.resistance} kg</strong><small>{record.sets} 组 × {record.reps} 次 · 共 {record.sets * record.reps} 次</small></div><time>{formatArmBandDate(record.recordedAt)}</time></div>
              <div className="armband-record-actions"><button title="编辑记录" aria-label="编辑记录" onClick={() => editRecord(record)}><PencilSimple /></button><button title="删除记录" aria-label="删除记录" onClick={() => deleteRecord(record.id)}><Trash /></button></div>
            </article>
          ))}</div> : <div className="armband-empty"><img className="history-image-icon history-image-icon-armband" src={armBandTabIcon} alt="" /><strong>还没有臂力棒记录</strong><span>完成一次训练后，记录会显示在这里。</span></div>}
        </section>
      </div>
  )
}

function PushUpView({ records, setData, notify }: {
  records: PushUpRecord[]
  setData: React.Dispatch<React.SetStateAction<AppData>>
  notify: (message: string) => void
}) {
  const [loadType, setLoadType] = useState<PushUpLoadType>('bodyweight')
  const [weight, setWeight] = useState(10)
  const [sets, setSets] = useState(3)
  const [reps, setReps] = useState(10)
  const [editingId, setEditingId] = useState<string | null>(null)
  const orderedRecords = [...records].sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
  const weekStart = getWeekStart()
  const weekRecords = orderedRecords.filter((record) => new Date(record.recordedAt) >= weekStart)
  const totalSets = records.reduce((sum, record) => sum + record.sets, 0)
  const totalReps = records.reduce((sum, record) => sum + record.sets * record.reps, 0)

  const resetForm = () => {
    setLoadType('bodyweight')
    setWeight(10)
    setSets(3)
    setReps(10)
    setEditingId(null)
  }

  const saveRecord = () => {
    if (!Number.isFinite(sets) || !Number.isFinite(reps) || sets < 1 || reps < 1 || (loadType === 'weighted' && (!Number.isFinite(weight) || weight <= 0))) {
      notify('请填写有效的负重、组数和次数。')
      return
    }
    const nextRecord: PushUpRecord = {
      id: editingId ?? `pushup-${Date.now()}`,
      loadType,
      weight: loadType === 'weighted' ? Math.round(weight * 2) / 2 : 0,
      sets: Math.round(sets),
      reps: Math.round(reps),
      recordedAt: editingId ? records.find((record) => record.id === editingId)?.recordedAt ?? new Date().toISOString() : new Date().toISOString(),
    }
    setData((current) => ({
      ...current,
      pushUpRecords: editingId
        ? current.pushUpRecords.map((record) => record.id === editingId ? nextRecord : record)
        : [nextRecord, ...current.pushUpRecords],
    }))
    notify(editingId ? '俯卧撑记录已修改。' : '俯卧撑记录已保存。')
    resetForm()
  }

  const editRecord = (record: PushUpRecord) => {
    setLoadType(record.loadType)
    setWeight(record.weight > 0 ? record.weight : 10)
    setSets(record.sets)
    setReps(record.reps)
    setEditingId(record.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const deleteRecord = (id: string) => {
    if (!window.confirm('确定删除这条俯卧撑记录吗？')) return
    setData((current) => ({ ...current, pushUpRecords: current.pushUpRecords.filter((record) => record.id !== id) }))
    if (editingId === id) resetForm()
    notify('俯卧撑记录已删除。')
  }

  return (
    <div className="armband-layout pushup-layout">
      <section className="armband-form-panel pushup-form-panel">
        <div className="section-heading"><h2>{editingId ? '修改记录' : '记录一次训练'}</h2><span>每次填写一条</span></div>
        <div className="pushup-note"><Repeat /><span>记录标准俯卧撑的完成组数和每组次数。</span></div>
        <fieldset className="armband-fieldset pushup-load-fieldset">
          <legend>负重方式</legend>
          <div className="difficulty-switch pushup-load-switch" role="group" aria-label="俯卧撑负重方式">
            <button type="button" className={loadType === 'bodyweight' ? 'selected' : ''} onClick={() => setLoadType('bodyweight')}>自重</button>
            <button type="button" className={loadType === 'weighted' ? 'selected' : ''} onClick={() => setLoadType('weighted')}>负重</button>
          </div>
          {loadType === 'weighted' && <label className="pushup-weight-input"><span>负重</span><div className="pushup-weight-control"><input type="number" min="0.5" max="200" step="0.5" value={weight} onChange={(event) => setWeight(Number(event.target.value))} /><span>kg</span></div></label>}
        </fieldset>
        <div className="armband-input-grid pushup-input-grid">
          <label><span>组数</span><input type="number" min="1" max="99" step="1" value={sets} onChange={(event) => setSets(Number(event.target.value))} /></label>
          <label><span>每组次数</span><input type="number" min="1" max="999" step="1" value={reps} onChange={(event) => setReps(Number(event.target.value))} /></label>
        </div>
        <div className="armband-form-actions">
          {editingId && <button className="secondary-button" onClick={resetForm}>取消修改</button>}
          <button className="primary-button" onClick={saveRecord}><Check weight="bold" />{editingId ? '保存修改' : '保存记录'}</button>
        </div>
      </section>

      <section className="armband-stats-section">
        <div className="section-heading"><h2>训练统计</h2><span>自动汇总</span></div>
        <div className="armband-stats">
          <div className="armband-stat-primary"><span>本周训练</span><strong>{weekRecords.length}</strong><small>次记录</small></div>
          <div><span>累计组数</span><strong>{totalSets}</strong><small>组</small></div>
          <div><span>累计次数</span><strong>{totalReps}</strong><small>次</small></div>
        </div>
      </section>

      <section className="armband-history-section">
        <div className="section-heading"><h2>历史记录</h2><span>{orderedRecords.length} 条</span></div>
        {orderedRecords.length ? <div className="armband-history-list">{orderedRecords.map((record) => (
          <article className="armband-record" key={record.id}>
            <div className="armband-record-main"><div><strong>{record.loadType === 'weighted' ? `负重 ${record.weight} kg` : '自重'} 俯卧撑</strong><small>{record.sets} 组 × {record.reps} 次 · 共 {record.sets * record.reps} 次</small></div><time>{formatArmBandDate(record.recordedAt)}</time></div>
            <div className="armband-record-actions"><button title="编辑记录" aria-label="编辑记录" onClick={() => editRecord(record)}><PencilSimple /></button><button title="删除记录" aria-label="删除记录" onClick={() => deleteRecord(record.id)}><Trash /></button></div>
          </article>
        ))}</div> : <div className="armband-empty"><img className="history-image-icon" src={pushUpTabIcon} alt="" /><strong>还没有俯卧撑记录</strong><span>完成一次训练后，记录会显示在这里。</span></div>}
      </section>
    </div>
  )
}

function MemoView({ records, setData, notify }: {
  records: MemoRecord[]
  setData: React.Dispatch<React.SetStateAction<AppData>>
  notify: (message: string) => void
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const contentBeforeSpeechRef = useRef('')
  const finalSpeechRef = useRef('')
  const orderedMemos = [...records].sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime())

  const getSpeechRecognition = (): SpeechRecognitionConstructor | null => {
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
    return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
  }

  const toggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop()
      return
    }
    const Recognition = getSpeechRecognition()
    if (!Recognition) {
      notify('当前浏览器不支持语音输入，请使用最新版 Chrome 或 Edge')
      return
    }
    const recognition = new Recognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = true
    contentBeforeSpeechRef.current = content ? `${content.trim()} ` : ''
    finalSpeechRef.current = ''
    recognition.onresult = (event) => {
      let interimTranscript = ''
      const resultIndex = Number.isFinite(event.resultIndex) ? event.resultIndex : 0
      for (let index = resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) finalSpeechRef.current += transcript
        else interimTranscript += transcript
      }
      setContent(`${contentBeforeSpeechRef.current}${finalSpeechRef.current}${interimTranscript}`.trimStart())
    }
    recognition.onerror = (event) => {
      setIsListening(false)
      recognitionRef.current = null
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') notify('麦克风权限被拒绝，请在浏览器设置中允许麦克风')
      else if (event.error !== 'aborted') notify('语音识别暂时不可用，请重试')
    }
    recognition.onend = () => {
      setIsListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = recognition
    try {
      recognition.start()
      setIsListening(true)
    } catch {
      recognitionRef.current = null
      notify('无法启动语音输入，请重试')
    }
  }

  useEffect(() => () => {
    recognitionRef.current?.abort()
    recognitionRef.current = null
    finalSpeechRef.current = ''
  }, [])

  const resetForm = () => {
    recognitionRef.current?.stop()
    setTitle('')
    setContent('')
    setEditingId(null)
    setIsListening(false)
    finalSpeechRef.current = ''
  }

  const saveMemo = () => {
    const trimmedTitle = title.trim()
    const trimmedContent = content.trim()
    if (!trimmedContent) {
      notify('请先写下备忘内容')
      return
    }
    const now = new Date().toISOString()
    const existing = editingId ? records.find((memo) => memo.id === editingId) : undefined
    const nextMemo: MemoRecord = {
      id: editingId ?? `memo-${Date.now()}`,
      title: trimmedTitle,
      content: trimmedContent,
      createdAt: existing?.createdAt ?? now,
      ...(editingId ? { updatedAt: now } : {}),
    }
    setData((current) => ({
      ...current,
      memos: editingId
        ? current.memos.map((memo) => memo.id === editingId ? nextMemo : memo)
        : [nextMemo, ...current.memos],
    }))
    notify(editingId ? '备忘已更新' : '备忘已保存')
    resetForm()
  }

  const editMemo = (memo: MemoRecord) => {
    setPendingDeleteId(null)
    setTitle(memo.title)
    setContent(memo.content)
    setEditingId(memo.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const requestDeleteMemo = (id: string) => {
    setPendingDeleteId(id)
  }

  const cancelDeleteMemo = () => {
    setPendingDeleteId(null)
  }

  const confirmDeleteMemo = () => {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    setData((current) => ({ ...current, memos: current.memos.filter((memo) => memo.id !== id) }))
    if (editingId === id) resetForm()
    setPendingDeleteId(null)
    notify('备忘已删除')
  }

  return (
    <div className="memo-layout">
      <section className="memo-form-panel">
        <div className="section-heading"><h2>{editingId ? '编辑备忘' : '新建备忘'}</h2><span>记录训练之外的想法</span></div>
        <div className="memo-form">
          <label className="memo-field"><span>标题（可选）</span><input type="text" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：本周训练感受" /></label>
          <label className="memo-field"><span>内容</span><div className="memo-content-control"><textarea rows={7} maxLength={2000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="记录动作要点、身体状态或下次计划……" /><button type="button" className={isListening ? 'memo-voice-button listening' : 'memo-voice-button'} onClick={toggleVoiceInput} aria-label={isListening ? '停止语音输入' : '开始语音输入'} title={isListening ? '停止语音输入' : '语音输入'}>{isListening ? <MicrophoneSlash weight="bold" /> : <Microphone weight="bold" />}</button></div>{isListening && <small className="memo-listening-hint">正在听，请直接说话；再次点击麦克风即可停止</small>}</label>
          <div className="memo-form-actions">
            {editingId && <button type="button" className="secondary-button" onClick={resetForm}>取消编辑</button>}
            <button type="button" className="primary-button" onClick={saveMemo}><Check weight="bold" />{editingId ? '保存修改' : '保存备忘'}</button>
          </div>
        </div>
      </section>

      <section className="memo-list-section">
        <div className="section-heading"><h2>我的备忘</h2><span>{orderedMemos.length} 条</span></div>
        {orderedMemos.length ? <div className="memo-list">{orderedMemos.map((memo) => (
          <article className="memo-record" key={memo.id}>
            <div className="memo-record-header"><div><strong>{memo.title || '未命名备忘'}</strong><time>{formatArmBandDate(memo.updatedAt ?? memo.createdAt)}</time></div><div className="memo-record-actions"><button type="button" title="编辑备忘" aria-label="编辑备忘" onClick={() => editMemo(memo)}><PencilSimple /></button><button type="button" title="删除备忘" aria-label="删除备忘" onClick={() => requestDeleteMemo(memo.id)}><Trash /></button></div></div>
            <p>{memo.content}</p>
            {pendingDeleteId === memo.id && <div className="memo-delete-confirm" role="alert"><span>确定删除这条备忘吗？</span><div className="memo-delete-confirm-actions"><button type="button" className="memo-delete-cancel" onClick={cancelDeleteMemo}>取消</button><button type="button" className="memo-delete-accept" onClick={confirmDeleteMemo}>确认删除</button></div></div>}
          </article>
        ))}</div> : <div className="memo-empty armband-empty"><Notebook size={30} /><strong>还没有备忘</strong><span>把训练感受、动作要点和下一步计划记在这里。</span></div>}
      </section>
    </div>
  )
}

function PageHeader({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <header className="page-header"><span>{eyebrow}</span><h1>{title}</h1><p>{detail}</p></header>
}

function getCurrentWeek(plan: AppData['plan']) {
  if (!plan) return 1
  const next = plan.sessions.find((session) => !session.completedAt)
  return next?.week ?? plan.config.weeks
}

function TodayView({ plan, onStart }: { plan: NonNullable<AppData['plan']>; onStart: (id: string) => void }) {
  const currentWeek = getCurrentWeek(plan)
  const sessions = plan.sessions.filter((session) => session.week === currentWeek).sort(compareTrainingSessions)
  const done = sessions.filter((session) => session.completedAt).length

  return (
    <div className="page">
      <PageHeader eyebrow={`第 ${currentWeek} 周`} title={done === sessions.length ? '本周训练已完成' : '今天，稳稳完成一组'} detail={`${done} / ${sessions.length} 次训练已完成，按自己的恢复状态安排顺序。`} />
      <section className="week-summary">
        <div className="week-ring" style={{ '--progress': `${sessions.length ? done / sessions.length * 360 : 0}deg` } as React.CSSProperties}><span><strong>{Math.round(done / sessions.length * 100) || 0}%</strong><small>本周</small></span></div>
        <div><span>目标进度</span><strong>{plan.config.weeks} 周周期中的第 {currentWeek} 周</strong><p>专注动作质量，不必急着追赶重量。</p></div>
      </section>
      <section className="section-block">
        <div className="section-heading"><h2>本周训练</h2><span>{sessions.length} 次</span></div>
        <div className="session-list">{sessions.map((session) => <SessionRow key={session.id} session={session} onStart={() => onStart(session.id)} />)}</div>
      </section>
      <section className="targets-strip">
        <h2>本周期目标</h2>
        <div>{liftIds.filter((lift) => plan.config.lifts[lift].enabled !== false).map((lift) => <span key={lift}><small>{LIFT_NAMES[lift]}</small><strong>{plan.targets[lift]} kg</strong></span>)}</div>
      </section>
    </div>
  )
}

function SessionRow({ session, onStart }: { session: TrainingSession; onStart: () => void }) {
  const failed = session.results.includes('failed')
  const completedSets = session.results.filter((result) => result === 'done').length
  const dayLabel = session.day ? WEEKDAY_OPTIONS.find((option) => option.value === session.day)?.label : ''
  return (
    <article className={`session-row ${session.completedAt ? 'completed' : ''}`}>
      <div className={`lift-symbol lift-symbol-${session.lift} lift-symbol-${session.kind}`} aria-hidden="true">{liftIcons[session.lift] ? <img src={liftIcons[session.lift]} alt="" /> : <span className="lift-symbol-text">{liftSymbolText[session.lift]}</span>}</div>
      <div className="session-main"><span>{LIFT_NAMES[session.lift]} / {dayLabel ? `周${dayLabel} / ` : ''}{session.kind === 'main' ? '重训练' : '轻训练'}</span><strong>{session.weight} kg</strong><small>{session.sets} 组 × {session.reps} 次 / {Math.round(session.intensity * 1000) / 10}%</small></div>
      {session.completedAt ? <span className={failed ? 'status failed' : 'status success'}>{failed ? '未完成' : '已完成'}</span> : <button className="start-button" onClick={onStart}><Play weight="fill" />开始</button>}
      {!session.completedAt && completedSets > 0 && <small className="resume-note">已记录 {completedSets} 组</small>}
    </article>
  )
}

function PlanView({ plan, onStart, onScheduleChange, onEnabledChange }: { plan: NonNullable<AppData['plan']>; onStart: (id: string) => void; onScheduleChange: (lift: LiftId, days: Weekday[]) => void; onEnabledChange: (lift: LiftId, enabled: boolean) => void }) {
  const [week, setWeek] = useState(getCurrentWeek(plan))
  const sessions = plan.sessions.filter((session) => session.week === week).sort(compareTrainingSessions)
  return (
    <div className="page">
      <PageHeader eyebrow="完整周期" title="你的训练路线" detail="每一次调整都会保留历史，只改变尚未开始的训练。" />
      <section className="schedule-editor">
        <div className="section-heading"><div><h2>训练日安排</h2><span>默认按周一、周二、周三顺延，可随时调整</span></div><small>每周 1 或 2 次</small></div>
        <div className="schedule-fieldset">
          {liftIds.map((lift) => {
            const config = plan.config.lifts[lift]
            const optional = flexibleLiftIds.includes(lift)
            const enabled = config?.enabled !== false
            const days = getLiftDays(plan.config, lift)
            return <div className={`schedule-row ${!enabled ? 'schedule-row-disabled' : ''}`} key={lift}>
              <div className="schedule-row-heading"><div><strong>{LIFT_NAMES[lift]}</strong><small>{enabled ? `每周 ${config.frequency} 次` : '创建周期时未加入计划'}</small></div>{optional && <label className="schedule-enable-toggle"><input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(lift, event.target.checked)} /><span>{enabled ? '已加入计划' : '加入计划'}</span></label>}</div>
              <WeekdayPicker lift={lift} frequency={config?.frequency ?? 1} days={days} disabled={!enabled} onChange={(nextDays) => onScheduleChange(lift, nextDays)} />
            </div>
          })}
        </div>
      </section>
      <div className="week-tabs" role="tablist">{Array.from({ length: plan.config.weeks }, (_, index) => index + 1).map((value) => <button role="tab" aria-selected={week === value} className={week === value ? 'active' : ''} key={value} onClick={() => setWeek(value)}>第 {value} 周</button>)}</div>
      <section className="plan-week-header"><div><span>第 {week} 周</span><strong>{sessions[0]?.intensity ? `${Math.round(sessions[0].intensity * 1000) / 10}% 强度起` : ''}</strong></div><small>{sessions.filter((session) => session.completedAt).length} / {sessions.length} 已完成</small></section>
      <div className="session-list plan-list">{sessions.map((session) => <SessionRow key={session.id} session={session} onStart={() => onStart(session.id)} />)}</div>
    </div>
  )
}

function ProgressView({ plan }: { plan: NonNullable<AppData['plan']> }) {
  const completed = plan.sessions.filter((session) => session.completedAt)
  const successes = completed.filter((session) => !session.results.includes('failed'))
  const overall = Math.round(completed.length / plan.sessions.length * 100) || 0
  return (
    <div className="page">
      <PageHeader eyebrow="周期进度" title="每一组都算数" detail="这里记录的是执行，不是完美。失败也会成为下一步的依据。" />
      <section className="metric-grid">
        <div className="primary-metric"><span>整体完成</span><strong>{overall}%</strong><small>{completed.length} / {plan.sessions.length} 次训练</small></div>
        <div><span>按计划完成</span><strong>{successes.length}</strong><small>次训练</small></div>
        <div><span>剩余周期</span><strong>{Math.max(0, plan.config.weeks - getCurrentWeek(plan) + 1)}</strong><small>周</small></div>
      </section>
      <section className="section-block lift-progress"><div className="section-heading"><h2>动作进度</h2></div>{liftIds.filter((lift) => plan.config.lifts[lift].enabled !== false).map((lift) => {
        const all = plan.sessions.filter((session) => session.lift === lift)
        const liftDone = all.filter((session) => session.completedAt).length
        return <div className="lift-progress-row" key={lift}><div><strong>{LIFT_NAMES[lift]}</strong><small>{plan.config.lifts[lift].oneRm} → {plan.targets[lift]} kg</small></div><div className="progress-track"><span style={{ width: `${all.length ? liftDone / all.length * 100 : 0}%` }} /></div><b>{liftDone}/{all.length}</b></div>
      })}</section>
      <section className="section-block"><div className="section-heading"><h2>最近训练</h2></div>{completed.length ? <div className="history-list">{completed.slice(-6).reverse().map((session) => <div key={session.id}><span className={session.results.includes('failed') ? 'history-icon failure' : 'history-icon'}>{session.results.includes('failed') ? <X /> : <Check />}</span><div><strong>{LIFT_NAMES[session.lift]} · 第 {session.week} 周</strong><small>{session.weight}kg · {session.sets}×{session.reps}</small></div><time>{new Date(session.completedAt!).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time></div>)}</div> : <EmptyState />}</section>
    </div>
  )
}

function EmptyState() {
  return <div className="empty-state"><Barbell /><strong>完成第一场训练后，记录会出现在这里</strong></div>
}

function WorkoutView({ session, restSeconds, onRestChange, onSetResult, onClose, onFinish }: { session: TrainingSession; restSeconds: number; onRestChange: (seconds: number) => void; onSetResult: (index: number, result: SetResult) => void; onClose: () => void; onFinish: () => void }) {
  const completed = session.results.filter((result) => result !== 'pending').length
  return (
    <div className="workout-overlay" role="dialog" aria-modal="true" aria-label={`${LIFT_NAMES[session.lift]}训练`}>
      <div className="workout-topbar"><button className="icon-button" onClick={onClose} aria-label="关闭训练"><X /></button><span>第 {session.week} 周 · {session.kind === 'main' ? '重训练' : '轻训练'}</span><strong>{completed}/{session.sets} 组</strong></div>
      <div className="workout-content">
        <section className="workout-prescription"><span>{LIFT_NAMES[session.lift]}</span><div><strong>{session.weight}</strong><small>kg</small></div><p>{session.sets} 组 × 每组 {session.reps} 次</p></section>
        <RestTimer initialSeconds={restSeconds} onDefaultChange={onRestChange} />
        <section className="sets-panel"><div className="section-heading"><h2>训练组</h2><span>点选每组结果</span></div><div className="set-list">{session.results.map((result, index) => <div className={`set-row ${result}`} key={index}><span>第 {index + 1} 组</span><strong>{session.reps} 次</strong><div><button aria-label={`第 ${index + 1} 组完成`} className="set-done" onClick={() => onSetResult(index, result === 'done' ? 'pending' : 'done')}><Check weight="bold" /></button><button aria-label={`第 ${index + 1} 组未完成`} className="set-failed" onClick={() => onSetResult(index, result === 'failed' ? 'pending' : 'failed')}><X weight="bold" /></button></div></div>)}</div></section>
      </div>
      <div className="workout-footer"><button className="primary-button" onClick={onFinish} disabled={completed === 0}>{completed === session.sets ? '完成训练' : '结束并记录'}<Check weight="bold" /></button></div>
    </div>
  )
}

function RestTimer({ initialSeconds, onDefaultChange }: { initialSeconds: number; onDefaultChange: (seconds: number) => void }) {
  const [duration, setDuration] = useState(initialSeconds)
  const [remaining, setRemaining] = useState(initialSeconds)
  const [endAt, setEndAt] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [alarmActive, setAlarmActive] = useState(false)
  const notifiedRef = useRef(false)
  const alarmAudioRef = useRef<HTMLAudioElement | null>(null)
  const vibrationTimerRef = useRef<number | null>(null)
  const alarmResetTimerRef = useRef<number | null>(null)
  const alarmGenerationRef = useRef(0)

  useEffect(() => {
    if (!running || !endAt) return
    const update = () => {
      const next = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
      setRemaining(next)
      if (next === 0) setRunning(false)
    }
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [running, endAt])

  useEffect(() => {
    if (remaining !== 0 || notifiedRef.current) return
    notifiedRef.current = true
    startAlarm()
    notifyTimerEnd()
  }, [remaining])

  const prepareAudio = () => {
    const audio = alarmAudioRef.current
    if (!audio) return
    audio.load()
    audio.muted = true
    void audio.play().then(() => {
      audio.pause()
      audio.currentTime = 0
      audio.muted = false
    }).catch(() => {
      audio.muted = false
    })
  }

  const stopAlarm = () => {
    alarmGenerationRef.current += 1
    const audio = alarmAudioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }
    if (alarmResetTimerRef.current !== null) {
      window.clearTimeout(alarmResetTimerRef.current)
      alarmResetTimerRef.current = null
    }
    if (vibrationTimerRef.current !== null) {
      window.clearInterval(vibrationTimerRef.current)
      vibrationTimerRef.current = null
    }
    try {
      if ('vibrate' in navigator) navigator.vibrate(0)
    } catch { /* Vibration is unavailable on many desktop browsers. */ }
    setAlarmActive(false)
  }

  const startAlarm = () => {
    stopAlarm()
    const generation = alarmGenerationRef.current
    setAlarmActive(true)
    const vibrate = () => {
      try {
        if ('vibrate' in navigator) navigator.vibrate([300, 120, 300, 120, 600])
      } catch { /* Vibration is unavailable on many desktop browsers. */ }
    }
    vibrate()
    vibrationTimerRef.current = window.setInterval(vibrate, 1800)
    alarmResetTimerRef.current = window.setTimeout(() => {
      stopAlarm()
      setRunning(false)
      setEndAt(null)
      setRemaining(duration)
      notifiedRef.current = false
    }, 3 * 60 * 1000)

    const audio = alarmAudioRef.current
    if (!audio) return
    audio.currentTime = 0
    void audio.play().catch(() => {
      if (generation === alarmGenerationRef.current) stopAlarm()
    })
  }

  useEffect(() => () => {
    alarmGenerationRef.current += 1
    alarmAudioRef.current?.pause()
    if (alarmResetTimerRef.current !== null) window.clearTimeout(alarmResetTimerRef.current)
    if (vibrationTimerRef.current !== null) window.clearInterval(vibrationTimerRef.current)
  }, [])

  const adjust = (amount: number) => {
    const next = Math.min(600, Math.max(30, duration + amount))
    setDuration(next)
    if (!running) setRemaining(next)
    onDefaultChange(next)
  }
  const startPause = () => {
    if (running) {
      setRunning(false)
      setEndAt(null)
    } else {
      prepareAudio()
      notifiedRef.current = false
      const seconds = remaining === 0 ? duration : remaining
      setRemaining(seconds)
      setEndAt(Date.now() + seconds * 1000)
      setRunning(true)
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
    }
  }
  const reset = () => { stopAlarm(); setRunning(false); setEndAt(null); setRemaining(duration); notifiedRef.current = false }
  const format = `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`

  return (
    <section className="timer-panel">
      <audio ref={alarmAudioRef} src={alarmSoundUrl} preload="auto" loop hidden aria-hidden="true" />
      <div className="timer-heading"><span><TimerIcon weight="bold" />组间休息</span><button onClick={reset}><Repeat />重置</button></div>
      <div className="timer-main"><button className="timer-adjust" onClick={() => adjust(-30)} aria-label="减少30秒"><Minus /></button><button className={running ? 'timer-display running' : 'timer-display'} onClick={startPause} aria-label={running ? '暂停计时' : '开始计时'}><strong>{format}</strong><span>{running ? <><Pause weight="fill" />暂停</> : <><Play weight="fill" />开始计时</>}</span></button><button className="timer-adjust" onClick={() => adjust(30)} aria-label="增加30秒"><Plus /></button></div>
      {alarmActive && <div className="timer-alarm" role="alert"><strong>休息结束</strong><button type="button" onClick={stopAlarm}><X />关闭铃声</button></div>}
    </section>
  )
}

function notifyTimerEnd() {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('休息结束', { body: '可以开始下一组了。' })
    }
  } catch { /* Notifications can be blocked by the browser or device. */ }
}

function AdjustmentSheet({ session, onChoose, onSkip }: { session: TrainingSession; onChoose: (type: AdjustmentType) => void; onSkip: () => void }) {
  const choices: { id: AdjustmentType; title: string; detail: string }[] = [
    { id: 'weight', title: '降低 2.5kg', detail: '保持组数和次数，减轻后续训练重量' },
    { id: 'reps', title: '每组少 1 次', detail: '保持重量和组数，降低单组疲劳' },
    { id: 'sets', title: '减少 1 组', detail: '保持重量和次数，降低总训练量' },
    { id: 'repeat', title: '下周重复本周', detail: '暂缓加重，再适应一次当前处方' },
  ]
  return <div className="sheet-backdrop" role="dialog" aria-modal="true"><section className="adjustment-sheet"><div className="sheet-handle" /><span className="kicker">训练调整</span><h2>{LIFT_NAMES[session.lift]}没有全部完成</h2><p>{getFailureAdvice(session)}</p><div className="adjustment-list">{choices.map((choice) => <button key={choice.id} onClick={() => onChoose(choice.id)}><span><strong>{choice.title}</strong><small>{choice.detail}</small></span><ArrowRight /></button>)}</div><button className="text-button" onClick={onSkip}>暂不调整</button></section></div>
}

function ContactAuthorSection({ onCopy }: { onCopy: () => void }) {
  return <section className="settings-section contact-author-section"><h2>联系作者</h2><div className="contact-author-row"><span className="setting-icon contact-author-icon"><WechatLogo /></span><span><strong>微信号</strong><small>{AUTHOR_WECHAT}</small></span><button className="copy-contact-button" type="button" onClick={onCopy} aria-label="复制微信号" title="复制微信号"><CopySimple /></button></div></section>
}

function SettingsView({ data, setData, notify }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>>; notify: (message: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `稳步训练备份-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    notify('备份文件已导出。')
  }
  const importData = async (file?: File) => {
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!validateBackup(parsed)) throw new Error('invalid')
      setData(normalizeData(parsed))
      notify('训练数据已恢复。')
    } catch { notify('无法读取这个备份文件。') }
  }
  const reset = () => {
    if (window.confirm('确定删除当前周期吗？训练记录也会一起删除。')) setData(defaultData)
  }
  const copyWechatId = async () => {
    try {
      await navigator.clipboard.writeText(AUTHOR_WECHAT)
      notify('微信号已复制')
    } catch {
      notify(`复制失败，请手动添加 ${AUTHOR_WECHAT}`)
    }
  }
  return <div className="page"><PageHeader eyebrow="偏好与数据" title="设置" detail="数据只留在这台设备的当前浏览器中，请定期导出备份。" /><section className="settings-section"><h2>默认休息时长</h2>{liftIds.map((lift) => <label className="setting-row" key={lift}><span><strong>{LIFT_NAMES[lift]}</strong><small>每次可在计时器内微调</small></span><select value={data.restSeconds[lift]} onChange={(event) => setData((current) => ({ ...current, restSeconds: { ...current.restSeconds, [lift]: Number(event.target.value) } }))}>{[90, 120, 150, 180, 210, 240, 300].map((seconds) => <option value={seconds} key={seconds}>{Math.floor(seconds / 60)}分{seconds % 60 ? `${seconds % 60}秒` : ''}</option>)}</select></label>)}</section><section className="settings-section"><h2>数据备份</h2><button className="setting-action" onClick={exportData}><span className="setting-icon"><DownloadSimple /></span><span><strong>导出备份</strong><small>保存为 JSON 文件</small></span><ArrowRight /></button><button className="setting-action" onClick={() => fileRef.current?.click()}><span className="setting-icon"><UploadSimple /></span><span><strong>导入备份</strong><small>恢复此前导出的训练数据</small></span><ArrowRight /></button><input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => void importData(event.target.files?.[0])} /></section><ContactAuthorSection onCopy={() => void copyWechatId()} /><section className="settings-section danger-zone"><h2>当前周期</h2><button className="setting-action danger" onClick={reset}><span className="setting-icon"><Trash /></span><span><strong>删除并重新开始</strong><small>此操作无法撤销，建议先导出备份</small></span><ArrowRight /></button></section></div>
}
