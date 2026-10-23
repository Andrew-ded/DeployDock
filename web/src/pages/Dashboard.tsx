import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { statusText, statusTone, when, type Tone } from '../format'
import { useLiveEvent } from '../live'
import type { DashboardApp, DashboardTarget } from '../types'
import { Chip, Confirm, Dot, Icon, useToast } from '../components/ui'
import { RollbackDialog } from '../components/RollbackDialog'

function envState(t: DashboardTarget): { tone: Tone; label: string } {
  if (t.busy) return { tone: 'busy', label: t.lastRun?.kind === 'Rollback' ? 'Откатывается' : 'Публикуется' }
  if (!t.healthUrl) return { tone: 'idle', label: 'Без health' }
  if (t.lastHealthOk === true) return { tone: 'ok', label: 'Живо' }
  if (t.lastHealthOk === false) return { tone: 'bad', label: 'Не отвечает' }
  return { tone: 'idle', label: 'Не проверяли' }
}

// Выбранное приложение переживает уход на экран запуска и возврат
let rememberedApp: number | null = null

export default function Dashboard() {
  const [apps, setApps] = useState<DashboardApp[] | null>(null)
  const [selId, setSelId] = useState<number | null>(rememberedApp)
  const [confirm, setConfirm] = useState<{ app: DashboardApp; target: DashboardTarget } | null>(null)
  const [rollback, setRollback] = useState<{ app: DashboardApp; target: DashboardTarget } | null>(null)
  const [checking, setChecking] = useState<number | 'all' | null>(null)
  const toast = useToast()
  const nav = useNavigate()

  const load = () => api.dashboard().then(setApps).catch(e => toast(e.message, true))
  useEffect(() => { load() }, [])
  useLiveEvent('runUpdated', () => load())
  useLiveEvent('healthUpdated', () => load())

  const select = (id: number) => { setSelId(id); rememberedApp = id }
  const app = apps?.find(a => a.id === selId) ?? apps?.[0] ?? null

  const deploy = async (t: DashboardTarget) => {
    setConfirm(null)
    try { const { id } = await api.deploy(t.id); nav(`/runs/${id}`) }
    catch (e) { toast((e as Error).message, true) }
  }

  const checkOne = async (t: DashboardTarget) => {
    setChecking(t.id)
    try {
      const r = await api.checkHealth(t.id)
      toast(`${t.name}: ${r.ok ? 'живо' : 'не отвечает'}, ${r.message}`, !r.ok)
    } catch (e) { toast((e as Error).message, true) }
    finally { setChecking(null) }
  }

  const checkAll = async () => {
    setChecking('all')
    try { await api.checkAllHealth(); await load(); toast('Health всех окружений обновлён') }
    finally { setChecking(null) }
  }

  if (apps === null) return <div className="page"><p className="muted">Загружаю…</p></div>

  if (apps.length === 0) return (
    <div className="page">
      <div className="surface empty-state" style={{ marginTop: 24 }}>
        <h2>Пока ни одного приложения</h2>
        <p>Добавь первое: путь к проекту, папку на сервере и URL health. Остальное настроишь потом.</p>
        <Link className="btn go lg" to="/apps/new"><Icon name="plus" />Добавить приложение</Link>
      </div>
    </div>
  )

  const all = apps.flatMap(a => a.targets)
  const counts = { ok: 0, bad: 0, busy: 0, idle: 0 } as Record<Tone, number>
  for (const t of all) counts[envState(t).tone]++
  const anyBusy = counts.busy > 0

  return (
    <div className="page">
      <section className="surface summary" aria-label="Сводка">
        <div className="summary-big">
          {counts.busy ? 'Идёт публикация' : counts.bad ? `${counts.bad} ${counts.bad === 1 ? 'окружение лежит' : 'окружения лежат'}` : 'Всё живо'}
          <small>{apps.length} прил., {all.length} окружений</small>
        </div>
        <div>
          <div className="bar" role="img" aria-label={`Живо ${counts.ok}, не отвечает ${counts.bad}, публикуется ${counts.busy}, без проверки ${counts.idle}`}>
            {(['ok', 'busy', 'bad', 'idle'] as Tone[]).filter(k => counts[k]).map(k =>
              <span key={k} className={`t-${k}`} style={{ flexGrow: counts[k] }} />)}
          </div>
          <div className="legend">
            <span><Dot tone="ok" />живо {counts.ok}</span>
            <span><Dot tone="bad" />не отвечает {counts.bad}</span>
            {counts.busy > 0 && <span><Dot tone="busy" />публикуется {counts.busy}</span>}
            {counts.idle > 0 && <span><Dot tone="idle" />без проверки {counts.idle}</span>}
          </div>
        </div>
        <button className="btn" onClick={checkAll} disabled={checking !== null}>
          <Icon name="refresh" />{checking === 'all' ? 'Проверяю…' : 'Проверить все'}
        </button>
      </section>

      <div className="md">
        <nav className="applist" aria-label="Приложения">
          {apps.map(a => (
            <button key={a.id} className={`app-item${a.id === app?.id ? ' sel' : ''}`} onClick={() => select(a.id)} aria-current={a.id === app?.id}>
              <span className="app-item-name">{a.name}</span>
              <span className="app-item-envs">
                {a.targets.map(t => {
                  const s = envState(t)
                  return <span key={t.id} className="env-mini" title={`${t.name}: ${s.label}`}><Dot tone={s.tone} />{t.name}</span>
                })}
              </span>
            </button>
          ))}
          <Link to="/apps/new" className="app-item app-add" style={{ textDecoration: 'none' }}>
            <span className="row" style={{ gap: 6, fontSize: 14, fontWeight: 600 }}><Icon name="plus" />Добавить приложение</span>
          </Link>
        </nav>

        {app && (
          <section key={app.id} style={{ animation: 'page-in .3s var(--ease)' }} aria-label={app.name}>
            <div className="detail-head">
              <div style={{ minWidth: 0 }}>
                <h2>{app.name}</h2>
                <span className="mono">{app.projectPath}</span>
                <div className="detail-meta">
                  {app.hasTests ? <Chip tone="ok">тесты перед публикацией</Chip> : <Chip tone="warn">без тестов</Chip>}
                </div>
              </div>
              <Link className="btn" to={`/apps/${app.id}`}>Настроить</Link>
            </div>

            <div className="envs">
              {app.targets.map(t => {
                const s = envState(t)
                const run = t.lastRun
                return (
                  <article key={t.id} className={`surface env t-${s.tone}${t.busy ? ' is-busy' : ''}`}>
                    <div className="env-top">
                      <div className="env-name"><span>{t.name}</span>
                        {t.healthUrl && !t.busy && (
                          <button className="btn ghost sm" onClick={() => checkOne(t)} disabled={checking !== null} title="Проверить health сейчас">
                            <Icon name="pulse" />{checking === t.id ? 'Проверяю…' : 'Health'}
                          </button>
                        )}
                      </div>
                      <div className="env-state">{s.label}</div>
                      <div className="env-msg">{t.busy ? 'Смотри лог на экране запуска' : t.lastHealthMessage ?? (t.healthUrl ? 'Ещё не проверяли' : 'URL health не указан')}</div>
                    </div>
                    <dl className="env-body" style={{ margin: 0 }}>
                      <div className="kv"><dt>Папка</dt><dd className="mono">{t.targetPath}</dd></div>
                      <div className="kv"><dt>Проверено</dt><dd>{when(t.lastHealthAt)}</dd></div>
                      <div className="kv"><dt>Последний запуск</dt><dd>
                        {run ? (
                          <span className="row" style={{ gap: 8 }}>
                            <Link to={`/runs/${run.id}`} className={`chip t-${statusTone[run.status]}`}><span className="dot" />{run.kind === 'Rollback' ? 'откат: ' : ''}{statusText[run.status]}</Link>
                            <span className="muted">{when(run.startedAt)}</span>
                          </span>
                        ) : <span className="muted">не публиковали</span>}
                      </dd></div>
                      <div className="kv"><dt>Бэкапов</dt><dd>{t.backupCount || <span className="muted">нет</span>}</dd></div>
                    </dl>
                    <div className="env-actions">
                      {t.busy && run
                        ? <Link className="btn block" to={`/runs/${run.id}`}><Icon name="chev" />Смотреть запуск</Link>
                        : <>
                            <button className="btn go" disabled={anyBusy} onClick={() => setConfirm({ app, target: t })}><Icon name="play" />Опубликовать</button>
                            <button className="btn" disabled={t.backupCount === 0 || anyBusy}
                              title={t.backupCount === 0 ? 'Бэкапов пока нет' : undefined}
                              onClick={() => setRollback({ app, target: t })}><Icon name="undo" />Откатить</button>
                          </>}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )}
      </div>

      {confirm && (
        <Confirm
          title={`Опубликовать ${confirm.app.name}?`}
          text={<>Окружение <b>{confirm.target.name}</b>, папка <code>{confirm.target.targetPath}</code>.<br />
            {confirm.app.hasTests ? 'Сначала прогоню тесты: упадут — публикации не будет.' : 'Тесты не настроены, сразу публикую.'}</>}
          action="Опубликовать"
          onYes={() => deploy(confirm.target)}
          onNo={() => setConfirm(null)} />
      )}
      {rollback && (
        <RollbackDialog targetId={rollback.target.id} title={`${rollback.app.name} / ${rollback.target.name}`}
          onClose={() => setRollback(null)} />
      )}
    </div>
  )
}
