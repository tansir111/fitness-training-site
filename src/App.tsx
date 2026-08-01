import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Barbell,
  CalendarDots,
  ChartLineUp,
  Check,
  DownloadSimple,
  GearSix,
  House,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  Timer as TimerIcon,
  Trash,
  UploadSimple,
  X,
} from '@phosphor-icons/react'
import { applyAdjustment, generatePlan, getFailureAdvice, liftIds, type AdjustmentType } from './plan'
import { defaultData, loadData, normalizeData, saveData, validateBackup } from './storage'
import { LIFT_NAMES, type AppData, type LiftId, type PlanConfig, type SetResult, type TrainingSession } from './types'
import benchIcon from './assets/bench.png'
import deadliftIcon from './assets/deadlift.png'
import squatIcon from './assets/squat.png'

type View = 'today' | 'plan' | 'progress' | 'settings'

const navItems: { id: View; label: string; icon: typeof House }[] = [
  { id: 'today', label: '训练', icon: House },
  { id: 'plan', label: '计划', icon: CalendarDots },
  { id: 'progress', label: '进度', icon: ChartLineUp },
  { id: 'settings', label: '设置', icon: GearSix },
]

const liftIcons: Record<LiftId, string> = {
  squat: squatIcon,
  bench: benchIcon,
  deadlift: deadliftIcon,
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
    return <PlanSetup onCreate={(config) => setData((current) => ({ ...current, plan: generatePlan(config) }))} />
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
        {view === 'plan' && <PlanView plan={plan} onStart={setActiveSessionId} />}
        {view === 'progress' && <ProgressView plan={plan} />}
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
  return <button className={active ? 'nav-button active' : 'nav-button'} onClick={onClick}><Icon weight={active ? 'fill' : 'regular'} /><span>{item.label}</span></button>
}

function PlanSetup({ onCreate }: { onCreate: (config: PlanConfig) => void }) {
  const [step, setStep] = useState(1)
  const [weeks, setWeeks] = useState(9)
  const [customWeeks, setCustomWeeks] = useState(false)
  const [growthRate, setGrowthRate] = useState(0.05)
  const [testAtEnd, setTestAtEnd] = useState(false)
  const [lifts, setLifts] = useState<PlanConfig['lifts']>({
    squat: { oneRm: 120, frequency: 2 },
    bench: { oneRm: 80, frequency: 2 },
    deadlift: { oneRm: 150, frequency: 1 },
  })
  const valid = liftIds.every((lift) => lifts[lift].oneRm > 0) && weeks >= 4 && weeks <= 20

  const updateLift = (lift: LiftId, patch: Partial<PlanConfig['lifts'][LiftId]>) => setLifts((current) => ({ ...current, [lift]: { ...current[lift], ...patch } }))

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
                <div className="lift-input" key={lift}>
                  <div><label htmlFor={`${lift}-rm`}>{LIFT_NAMES[lift]}</label><small>当前 1RM</small></div>
                  <div className="weight-field"><input id={`${lift}-rm`} type="number" min="2.5" step="2.5" value={lifts[lift].oneRm} onChange={(event) => updateLift(lift, { oneRm: Number(event.target.value) })} /><span>kg</span></div>
                  <div className="frequency-control" aria-label={`${LIFT_NAMES[lift]}每周频率`}>
                    {[1, 2].map((frequency) => <button key={frequency} className={lifts[lift].frequency === frequency ? 'selected' : ''} onClick={() => updateLift(lift, { frequency: frequency as 1 | 2 })}>每周 {frequency} 次</button>)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="cycle-options">
              <fieldset><legend>训练周期</legend><div className="option-grid">{[6, 8, 9, 12].map((value) => <button key={value} className={!customWeeks && weeks === value ? 'selected' : ''} onClick={() => { setWeeks(value); setCustomWeeks(false) }}>{value} 周</button>)}<button className={customWeeks ? 'selected' : ''} onClick={() => setCustomWeeks(true)}>自定义</button></div>{customWeeks && <label className="custom-weeks">周期周数<input type="number" min="4" max="20" value={weeks} onChange={(event) => setWeeks(Number(event.target.value))} /></label>}</fieldset>
              <fieldset><legend>目标增幅</legend><div className="growth-options">{[{ label: '保守', value: 0.025 }, { label: '标准', value: 0.05 }, { label: '激进', value: 0.075 }].map((option) => <button key={option.label} className={growthRate === option.value ? 'selected' : ''} onClick={() => setGrowthRate(option.value)}><strong>{option.label}</strong><span>+{option.value * 100}%</span></button>)}</div><label className="range-label"><span>微调目标增幅 <strong>{Math.round(growthRate * 1000) / 10}%</strong></span><input type="range" min="1" max="10" step="0.5" value={growthRate * 100} onChange={(event) => setGrowthRate(Number(event.target.value) / 100)} /></label></fieldset>
              <label className="toggle-row"><span><strong>周期末测试目标 1RM</strong><small>关闭时安排高强度低次数训练</small></span><input type="checkbox" checked={testAtEnd} onChange={(event) => setTestAtEnd(event.target.checked)} /></label>
            </div>
          )}

          <div className="setup-actions">
            {step === 2 && <button className="secondary-button" onClick={() => setStep(1)}>返回修改</button>}
            {step === 1 ? <button className="primary-button" disabled={!valid} onClick={() => setStep(2)}>继续设置<ArrowRight /></button> : <button className="primary-button" disabled={!valid} onClick={() => onCreate({ weeks, growthRate, testAtEnd, lifts })}>生成训练计划<ArrowRight /></button>}
          </div>
        </section>
      </div>
    </main>
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
  const sessions = plan.sessions.filter((session) => session.week === currentWeek)
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
        <div>{liftIds.map((lift) => <span key={lift}><small>{LIFT_NAMES[lift]}</small><strong>{plan.targets[lift]} kg</strong></span>)}</div>
      </section>
    </div>
  )
}

function SessionRow({ session, onStart }: { session: TrainingSession; onStart: () => void }) {
  const failed = session.results.includes('failed')
  const completedSets = session.results.filter((result) => result === 'done').length
  return (
    <article className={`session-row ${session.completedAt ? 'completed' : ''}`}>
      <div className={`lift-symbol lift-symbol-${session.lift}`} aria-hidden="true"><img src={liftIcons[session.lift]} alt="" /></div>
      <div className="session-main"><span>{LIFT_NAMES[session.lift]} · {session.kind === 'main' ? '重训练' : '轻训练'}</span><strong>{session.weight} kg</strong><small>{session.sets} 组 × {session.reps} 次 · {Math.round(session.intensity * 1000) / 10}%</small></div>
      {session.completedAt ? <span className={failed ? 'status failed' : 'status success'}>{failed ? '未完成' : '已完成'}</span> : <button className="start-button" onClick={onStart}><Play weight="fill" />开始</button>}
      {!session.completedAt && completedSets > 0 && <small className="resume-note">已记录 {completedSets} 组</small>}
    </article>
  )
}

function PlanView({ plan, onStart }: { plan: NonNullable<AppData['plan']>; onStart: (id: string) => void }) {
  const [week, setWeek] = useState(getCurrentWeek(plan))
  const sessions = plan.sessions.filter((session) => session.week === week)
  return (
    <div className="page">
      <PageHeader eyebrow="完整周期" title="你的训练路线" detail="每一次调整都会保留历史，只改变尚未开始的训练。" />
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
      <section className="section-block lift-progress"><div className="section-heading"><h2>三大项进度</h2></div>{liftIds.map((lift) => {
        const all = plan.sessions.filter((session) => session.lift === lift)
        const liftDone = all.filter((session) => session.completedAt).length
        return <div className="lift-progress-row" key={lift}><div><strong>{LIFT_NAMES[lift]}</strong><small>{plan.config.lifts[lift].oneRm} → {plan.targets[lift]} kg</small></div><div className="progress-track"><span style={{ width: `${liftDone / all.length * 100}%` }} /></div><b>{liftDone}/{all.length}</b></div>
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
  const notifiedRef = useRef(false)

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
    notifyTimerEnd()
  }, [remaining])

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
      notifiedRef.current = false
      const seconds = remaining === 0 ? duration : remaining
      setRemaining(seconds)
      setEndAt(Date.now() + seconds * 1000)
      setRunning(true)
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
    }
  }
  const reset = () => { setRunning(false); setEndAt(null); setRemaining(duration); notifiedRef.current = false }
  const format = `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`

  return <section className="timer-panel"><div className="timer-heading"><span><TimerIcon weight="bold" />组间休息</span><button onClick={reset}><Repeat />重置</button></div><div className="timer-main"><button className="timer-adjust" onClick={() => adjust(-30)} aria-label="减少30秒"><Minus /></button><button className={running ? 'timer-display running' : 'timer-display'} onClick={startPause} aria-label={running ? '暂停计时' : '开始计时'}><strong>{format}</strong><span>{running ? <><Pause weight="fill" />暂停</> : <><Play weight="fill" />开始计时</>}</span></button><button className="timer-adjust" onClick={() => adjust(30)} aria-label="增加30秒"><Plus /></button></div></section>
}

function notifyTimerEnd() {
  if ('vibrate' in navigator) navigator.vibrate([200, 100, 200])
  try {
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 740
    gain.gain.setValueAtTime(0.12, context.currentTime)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.35)
  } catch { /* Browser may require a fresh user gesture. */ }
  if ('Notification' in window && Notification.permission === 'granted') new Notification('休息结束', { body: '可以开始下一组了。' })
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
  return <div className="page"><PageHeader eyebrow="偏好与数据" title="设置" detail="数据只留在这台设备的当前浏览器中，请定期导出备份。" /><section className="settings-section"><h2>默认休息时长</h2>{liftIds.map((lift) => <label className="setting-row" key={lift}><span><strong>{LIFT_NAMES[lift]}</strong><small>每次可在计时器内微调</small></span><select value={data.restSeconds[lift]} onChange={(event) => setData((current) => ({ ...current, restSeconds: { ...current.restSeconds, [lift]: Number(event.target.value) } }))}>{[90, 120, 150, 180, 210, 240, 300].map((seconds) => <option value={seconds} key={seconds}>{Math.floor(seconds / 60)}分{seconds % 60 ? `${seconds % 60}秒` : ''}</option>)}</select></label>)}</section><section className="settings-section"><h2>数据备份</h2><button className="setting-action" onClick={exportData}><span className="setting-icon"><DownloadSimple /></span><span><strong>导出备份</strong><small>保存为 JSON 文件</small></span><ArrowRight /></button><button className="setting-action" onClick={() => fileRef.current?.click()}><span className="setting-icon"><UploadSimple /></span><span><strong>导入备份</strong><small>恢复此前导出的训练数据</small></span><ArrowRight /></button><input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => void importData(event.target.files?.[0])} /></section><section className="settings-section danger-zone"><h2>当前周期</h2><button className="setting-action danger" onClick={reset}><span className="setting-icon"><Trash /></span><span><strong>删除并重新开始</strong><small>此操作无法撤销，建议先导出备份</small></span><ArrowRight /></button></section></div>
}
