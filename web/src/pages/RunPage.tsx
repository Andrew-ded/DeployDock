import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { backupLabel, duration, statusText, statusTone, when } from '../format'
import { useLiveEvent } from '../live'
import type { Run } from '../types'
import { Chip, Dot, Icon, Segmented, useToast } from '../components/ui'
import { RollbackDialog } from '../components/RollbackDialog'

function lineClass(body: string) {
  if (body.startsWith('── ')) return 'l-stage'
  if (body.startsWith('> ')) return 'l-cmd'
  if (body.startsWith('✖') || /\[FAIL\]|Failed!|Error Message|^\s+Failed |: error /i.test(body)) return 'l-err'
  if (/\bwarning\b|^\s*!|нет —/i.test(body)) return 'l-warn'
  if (body.startsWith('✔') || /Passed!|health #\d+: OK|=== Итог: успешно/.test(body)) return 'l-ok'
  return ''
}

type Tab = 'tests' | 'config' | 'files'

export default function RunPage() {
  const { id } = useParams()
  const [run, setRun] = useState<Run | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [missing, setMissing] = useState(false)
  const [rollback, setRollback] = useState(false)
  const [tab, setTab] = useState<Tab | null>(null)
  const [follow, setFollow] = useState(true)
  const [, tick] = useState(0)
  const consoleRef = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const nav = useNavigate()

  useEffect(() => {
    setRun(null); setLog([]); setMissing(false); setFollow(true); setTab(null)
    api.run(id!).then(r => { setRun(r.run); setLog(r.log) }).catch(() => setMissing(true))
  }, [id])

  useLiveEvent('runLog', (runId: string, lines: string[]) => { if (runId === id) setLog(l => [...l, ...lines]) })
  useLiveEvent('runUpdated', (r: Run) => { if (r.id === id) setRun(r) })

  useEffect(() => {
    if (run?.status !== 'Running') return
    const t = setInterval(() => tick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [run?.status])

  useLayoutEffect(() => {
    const el = consoleRef.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [log, follow])

  if (missing) return (
    <div className="page"><Link to="/" className="crumb"><Icon name="back" />Приложения</Link>
      <div className="page-head"><div><h1>Запуск не найден</h1><p>Храню только 5 последних запусков на окружение.</p></div></div></div>
  )
  if (!run) return <div className="page"><p className="muted">Загружаю…</p></div>

  const running = run.status === 'Running'
  const tone = statusTone[run.status]
  const failedTests = run.tests?.tests.filter(t => t.outcome !== 'Passed' && t.outcome !== 'NotExecuted') ?? []
  const otherTests = run.tests?.tests.filter(t => !failedTests.includes(t)) ?? []

  // Сколько трека закрашено: до последнего завершённого этапа (или текущего)
  const n = run.stages.length
  let lastIdx = -1
  run.stages.forEach((s, i) => { if (s.status === 'ok' || s.status === 'failed' || s.status === 'running' || (s.status === 'skipped' && s.detail !== 'не дошли')) lastIdx = i })
  const progress = n > 1 ? Math.max(0, lastIdx) / (n - 1) * 100 : 0
  const trackBad = run.stages.some(s => s.status === 'failed')

  const tabs: { value: Tab; label: React.ReactNode }[] = []
  if (run.tests) tabs.push({ value: 'tests', label: <>Тесты <span className={`count${run.tests.failed ? ' bad' : ''}`}>{run.tests.failed ? `${run.tests.failed} упало` : run.tests.total}</span></> })
  if (run.changes.length) tabs.push({ value: 'config', label: <>Конфиги <span className="count">{run.changes.filter(c => c.action === 'replace' || c.action === 'add').length}</span></> })
  if (run.mirror) tabs.push({ value: 'files', label: 'Файлы' })
  const activeTab = tab && tabs.some(t => t.value === tab) ? tab : tabs[0]?.value

  const cancel = async () => { try { await api.cancelRun(run.id) } catch (e) { toast((e as Error).message, true) } }
  const redeploy = async () => {
    try { const r = await api.deploy(run.targetId); nav(`/runs/${r.id}`) }
    catch (e) { toast((e as Error).message, true) }
  }

  const verdict = (() => {
    switch (run.status) {
      case 'Succeeded': return { icon: 'check', title: run.kind === 'Rollback' ? 'Откат выполнен' : 'Опубликовано', text: run.health?.message ?? 'Health-check не настроен, файлы на месте.' }
      case 'TestsFailed': return { icon: 'x', title: 'Упали тесты, публикации не было', text: 'На сервере ничего не менялось. Упавшие тесты во вкладке «Тесты».' }
      case 'HealthFailed': return { icon: 'alert', title: 'Файлы на месте, но приложение не отвечает', text: run.error ?? '' }
      case 'Failed': return { icon: 'x', title: 'Ошибка', text: run.error ?? 'Смотри лог.' }
      case 'Cancelled': return { icon: 'stop', title: 'Отменено', text: 'Остановлено до копирования файлов, сервер не тронут.' }
      default: return null
    }
  })()

  return (
    <div className="page">
      <Link to="/" className="crumb"><Icon name="back" />Приложения</Link>
      <div className="run-head">
        <div>
          <h1>{run.appName} <span className="muted">/</span> {run.targetName}</h1>
          <div className="sub">
            <Chip tone={tone}>{run.kind === 'Rollback' ? 'откат: ' : ''}{statusText[run.status]}</Chip>
            <span>{run.kind === 'Rollback' ? `к бэкапу ${backupLabel(run.restoredFrom ?? '')}, ` : ''}начат {when(run.startedAt)}</span>
            <span className="muted">{running ? 'идёт' : 'занял'} {duration(run.startedAt, run.finishedAt)}</span>
          </div>
        </div>
        <div className="row">
          {running && <button className="btn" onClick={cancel} disabled={!run.canCancel}
            title={run.canCancel ? undefined : 'Файлы уже копируются, прерывать нельзя'}><Icon name="stop" />Отменить</button>}
          {!running && run.canRollback && <button className="btn" onClick={() => setRollback(true)}><Icon name="undo" />Откатить</button>}
          {!running && <button className="btn go" onClick={redeploy}><Icon name="play" />Опубликовать снова</button>}
        </div>
      </div>

      <div className="stack">
        {verdict && (
          <div className={`verdict t-${tone}`} role="status">
            <span className="verdict-icon"><Icon name={verdict.icon} /></span>
            <div className="msg"><strong>{verdict.title}</strong><div>{verdict.text}</div></div>
            {(run.status === 'HealthFailed' || run.status === 'Failed') && run.canRollback &&
              <button className="btn solid-bad" onClick={() => setRollback(true)}><Icon name="undo" />Откатить на прошлую версию</button>}
          </div>
        )}

        <section className="surface track" aria-label="Этапы">
          <div className="track-steps" style={{ ['--n' as any]: n }}>
            <div className="track-line" aria-hidden="true">
              <div className={`track-fill${trackBad ? ' bad' : ''}`} style={{ ['--p' as any]: `${progress}%` }} />
            </div>
            {run.stages.map((s, i) => (
              <div key={s.key} className={`step ${s.status}`}>
                <span className="step-node">
                  {s.status === 'ok' ? <Icon name="check" /> : s.status === 'failed' ? <Icon name="x" /> : i + 1}
                </span>
                <span className="step-title">{s.title}</span>
                <span className="step-detail">
                  {s.detail ?? (s.status === 'running' ? `идёт ${duration(s.startedAt, null)}` : s.status === 'pending' ? 'ждёт' : '')}
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="run-grid">
          <section className="surface pad" aria-label="Результаты">
            {tabs.length === 0 ? (
              <p className="hint" style={{ margin: 0 }}>{running ? 'Результаты появятся по мере прохождения этапов.' : 'Подробностей нет.'}</p>
            ) : (
              <>
                <div className="results-head">
                  <Segmented<Tab> small label="Результаты" options={tabs} value={activeTab!} onChange={setTab} />
                </div>

                {activeTab === 'tests' && run.tests && (
                  <div key="tests" style={{ animation: 'page-in .25s var(--ease)' }}>
                    <div className="tnum">
                      <div className="ok"><b>{run.tests.passed}</b><span>пройдено</span></div>
                      <div className={run.tests.failed ? 'bad' : ''}><b>{run.tests.failed}</b><span>упало</span></div>
                      {run.tests.skipped > 0 && <div><b>{run.tests.skipped}</b><span>пропущено</span></div>}
                      <div><b className="muted">{run.tests.total}</b><span>всего</span></div>
                    </div>
                    <div className="tests">
                      {failedTests.map((t, i) => (
                        <details key={`f${i}`} className="test failed" open={i < 2}>
                          <summary>
                            <Icon name="chev" /><Dot tone="bad" />
                            <span className="test-name">{t.name.split('.').slice(-2).join('.')}<div className="test-src">{t.source}</div></span>
                            <span className="muted" style={{ fontSize: 12 }}>{Math.round(t.durationMs)} мс</span>
                          </summary>
                          {t.message && <pre className="msg">{t.message}</pre>}
                          {t.stackTrace && <pre>{t.stackTrace}</pre>}
                        </details>
                      ))}
                      {otherTests.length > 0 && (
                        <details className="test" open={failedTests.length === 0}>
                          <summary><Icon name="chev" /><Dot tone="ok" /><span className="test-name">{failedTests.length ? 'Остальные' : 'Все'} тесты ({otherTests.length})</span></summary>
                          <div className="mini-list">
                            {otherTests.map((t, i) => (
                              <div key={i}>
                                <Dot tone={t.outcome === 'Passed' ? 'ok' : 'idle'} title={t.outcome === 'Passed' ? 'пройден' : 'пропущен'} />
                                <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{t.name.split('.').slice(-2).join('.')}</span>
                                <span className="muted">{Math.round(t.durationMs)} мс</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {run.tests.total === 0 && <p className="hint">Тестов не найдено.</p>}
                    </div>
                  </div>
                )}

                {activeTab === 'config' && (
                  <div key="config" style={{ animation: 'page-in .25s var(--ease)' }}>
                    <div className="changes">
                      {run.changes.map((c, i) => (
                        <div key={i} className={`change ${c.level}`}>
                          <Dot tone={c.level === 'error' ? 'bad' : c.level === 'warn' ? 'warn' : c.action === 'skip' ? 'idle' : 'ok'} />
                          <span className="p">{c.path || '—'}</span>
                          <span>{c.detail}<span className="f">{c.file}</span></span>
                        </div>
                      ))}
                    </div>
                    <p className="hint" style={{ marginBottom: 0 }}>Правки только в папке публикации, исходники не тронуты.</p>
                  </div>
                )}

                {activeTab === 'files' && run.mirror && (
                  <div key="files" style={{ animation: 'page-in .25s var(--ease)' }}>
                    <div className="statgrid">
                      <div className="stat"><b>{run.mirror.copied}</b><span>скопировано</span></div>
                      <div className="stat"><b>{run.mirror.unchanged}</b><span>без изменений</span></div>
                      <div className="stat"><b>{run.mirror.deleted}</b><span>удалено</span></div>
                      <div className="stat"><b>{run.mirror.excluded}</b><span>исключено</span></div>
                    </div>
                    {run.backupName && <p className="hint" style={{ marginBottom: 0 }}>Прошлая версия сохранена в бэкап {backupLabel(run.backupName)}.</p>}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="console-wrap" aria-label="Лог">
            <div className="console-bar">
              <b>Лог</b><span>{log.length} строк</span>
              <span className="spacer" />
              <button className="btn ghost sm" onClick={() => setFollow(!follow)} aria-pressed={follow}>
                <Icon name={follow ? 'check' : 'chev'} />{follow ? 'Слежу за концом' : 'Следить за концом'}
              </button>
            </div>
            <div className="console" ref={consoleRef} tabIndex={0}
              onWheel={e => { if (e.deltaY < 0 && follow) setFollow(false) }}>
              {log.map((l, i) => {
                const m = l.match(/^\[(\d\d:\d\d:\d\d)\] (.*)$/s)
                const body = m ? m[2] : l
                return <div key={i} className={lineClass(body)}>{m && <span className="ts">{m[1]} </span>}{body}</div>
              })}
              {running && <span className="cursor" aria-hidden="true" />}
            </div>
          </section>
        </div>
      </div>

      {rollback && <RollbackDialog targetId={run.targetId} title={`${run.appName} / ${run.targetName}`} onClose={() => setRollback(false)} />}
    </div>
  )
}
