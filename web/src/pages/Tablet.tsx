import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { envState } from '../format'
import { useLive, useLiveEvent } from '../live'
import type { DashboardApp, DashboardTarget, Run } from '../types'
import { Chip, Confirm, Dot, Icon, useToast } from '../components/ui'

type Tile = { app: DashboardApp; target: DashboardTarget }
type Result = { tone: 'ok' | 'bad' | 'warn'; text: string }

/** Итог без подробностей: детали остаются на ПК. */
function resultOf(run: Run): Result {
  const what = run.kind === 'Rollback' ? 'Откат' : 'Обновление'
  if (run.status === 'Succeeded') return { tone: 'ok', text: run.kind === 'Rollback' ? 'Откат завершён' : 'Обновление завершено' }
  if (run.status === 'Cancelled') return { tone: 'warn', text: `${what} отменён на ПК` }
  return { tone: 'bad', text: `${what} не удался. Подробности на ПК` }
}

export default function Tablet() {
  const [apps, setApps] = useState<DashboardApp[] | null>(null)
  const [offline, setOffline] = useState(false)
  const [confirm, setConfirm] = useState<Tile | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const { connected } = useLive()
  const toast = useToast()
  const resultTimer = useRef<number>(0)

  const load = useCallback(() => api.dashboard()
    .then(a => { setApps(a); setOffline(false) })
    .catch(() => setOffline(true)), [])

  // События приходят сами; опрос — страховка на случай потерянного соединения
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => { if (connected) load() }, [connected, load])

  useLiveEvent('runUpdated', (run: Run) => {
    load()
    if (run.status === 'Running') { setResult(null); return }
    setResult(resultOf(run))
    clearTimeout(resultTimer.current)
    resultTimer.current = window.setTimeout(() => setResult(null), 12_000)
  })
  useLiveEvent('healthUpdated', () => load())

  // Терминал не должен гаснуть сам (нужен secure context; localhost им считается)
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const take = () => navigator.wakeLock?.request('screen').then(l => { lock = l }).catch(() => {})
    const onVisible = () => { if (document.visibilityState === 'visible') take() }
    take()
    document.addEventListener('visibilitychange', onVisible)
    return () => { document.removeEventListener('visibilitychange', onVisible); lock?.release().catch(() => {}) }
  }, [])

  const tiles: Tile[] = (apps ?? []).flatMap(app => app.targets.map(target => ({ app, target })))
  const busy = tiles.some(t => t.target.busy)
  const down = offline || !connected

  const start = async () => {
    if (!confirm || sending) return
    const { target } = confirm
    setSending(true)
    try {
      await api.deploy(target.id)
      setConfirm(null)
      setResult(null)
      load()
    } catch (e) {
      setConfirm(null)
      toast((e as Error).message, true)
    } finally { setSending(false) }
  }

  return (
    <div className="tablet">
      <header className="tablet-top">
        <span className="brand"><span className="brand-mark"><i /></span>DeployDock</span>
        {down && <Chip tone="warn">нет связи с ПК</Chip>}
      </header>

      {busy
        ? <div className="tablet-plate t-busy" role="status"><Dot tone="busy" lg />Готовится обновление. Подробности на ПК</div>
        : result && <div className={`tablet-plate t-${result.tone}`} role="status"><Dot tone={result.tone} lg />{result.text}</div>}

      {apps === null
        ? <p className="muted tablet-note">{offline ? 'Не достучался до ПК. Проверь кабель и adb reverse, дальше попробую сам.' : 'Загружаю…'}</p>
        : tiles.length === 0
          ? <p className="muted tablet-note">Приложений пока нет. Добавь их на ПК.</p>
          : (
            <main className="tablet-grid">
              {tiles.map(({ app, target }) => {
                const s = envState(target)
                return (
                  <button key={target.id} className={`tablet-tile t-${s.tone}${target.busy ? ' is-busy' : ''}`}
                    disabled={busy || down} onClick={() => setConfirm({ app, target })}>
                    <span className="tablet-tile-env">{target.name}</span>
                    <span className="tablet-tile-name">{app.name}</span>
                    <span className="tablet-tile-state"><Dot tone={s.tone} />{s.label}</span>
                    <span className="tablet-tile-go"><Icon name="play" size={18} /></span>
                  </button>
                )
              })}
            </main>
          )}

      {confirm && (
        <Confirm
          title="Опубликовать новую версию?"
          text={<><b>{confirm.app.name}</b>, окружение <b>{confirm.target.name}</b>.<br />Установка пойдёт на ПК.</>}
          action={sending ? 'Запускаю…' : 'Опубликовать'}
          onYes={start}
          onNo={() => !sending && setConfirm(null)} />
      )}
    </div>
  )
}
