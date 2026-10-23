import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import type { AppProject, Connection, Target } from '../types'
import { Confirm, Icon, PathInput, Segmented, useToast } from '../components/ui'
import { TargetKeys } from '../components/TargetKeys'

const newTarget = (name: string, firstConn?: number): Target => ({
  id: null, name, targetPath: '', healthUrl: '', ignoreTlsErrors: false,
  bindings: firstConn ? [{ jsonPath: 'ConnectionStrings:DefaultConnection', connectionStringId: firstConn }] : [],
})

const blank = (): AppProject => ({
  id: null, name: '', projectPath: '', testPath: '', publishArgs: '',
  exclusions: ['logs'], keyPaths: [], targets: [],
})

type Form = { app: AppProject; excl: string; keys: string }
const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean)
const toForm = (a: AppProject): Form => ({ app: a, excl: a.exclusions.join('\n'), keys: a.keyPaths.join('\n') })
const snapshot = (f: Form) => JSON.stringify({ ...f.app, exclusions: lines(f.excl), keyPaths: lines(f.keys), targets: f.app.targets.map(t => ({ ...t, lastHealthAt: undefined, lastHealthOk: undefined, lastHealthMessage: undefined })) })

const sections = [
  { id: 's-project', label: 'Проект' },
  { id: 's-envs', label: 'Окружения' },
  { id: 's-keys', label: 'Ключи подписи' },
  { id: 's-excl', label: 'Исключения' },
]

export default function AppEditor() {
  const { id } = useParams()
  const isNew = !id
  const nav = useNavigate()
  const toast = useToast()
  const [form, setForm] = useState<Form | null>(null)
  const [saved, setSaved] = useState<string>('')
  const [conns, setConns] = useState<Connection[]>([])
  const [envIdx, setEnvIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [spy, setSpy] = useState(sections[0].id)

  useEffect(() => {
    api.connections().then(c => {
      setConns(c)
      if (isNew) {
        const a = blank(); a.targets = [newTarget('Prod', c[0]?.id)]
        const f = toForm(a); setForm(f); setSaved(snapshot(f))
      }
    }).catch(e => toast(e.message, true))
    if (!isNew) api.app(Number(id)).then(a => { const f = toForm(a); setForm(f); setSaved(snapshot(f)) }).catch(e => toast(e.message, true))
  }, [id])

  // Подсветка раздела в оглавлении по прокрутке
  useEffect(() => {
    const obs = new IntersectionObserver(es => {
      const vis = es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (vis) setSpy(vis.target.id)
    }, { rootMargin: '-90px 0px -55% 0px' })
    sections.forEach(s => { const el = document.getElementById(s.id); if (el) obs.observe(el) })
    return () => obs.disconnect()
  }, [form !== null])

  const dirty = useMemo(() => form !== null && snapshot(form) !== saved, [form, saved])

  if (!form) return <div className="page"><p className="muted">Загружаю…</p></div>
  const app = form.app

  const set = (patch: Partial<AppProject>) => setForm({ ...form, app: { ...app, ...patch } })
  const setTarget = (i: number, patch: Partial<Target>) =>
    set({ targets: app.targets.map((t, j) => (j === i ? { ...t, ...patch } : t)) })
  const env = app.targets[Math.min(envIdx, app.targets.length - 1)]
  const ei = app.targets.indexOf(env)

  const save = async () => {
    setSaving(true)
    const payload: AppProject = { ...app, exclusions: lines(form.excl), keyPaths: lines(form.keys) }
    try {
      const res = isNew ? await api.createApp(payload) : await api.updateApp(app.id!, payload)
      const f = toForm(res); setForm(f); setSaved(snapshot(f))
      toast('Сохранено')
      if (isNew) nav(`/apps/${res.id}`, { replace: true })
    } catch (e) { toast((e as Error).message, true) }
    finally { setSaving(false) }
  }
  const reset = () => setForm(toForm(JSON.parse(saved)))
  const remove = async () => {
    try { await api.deleteApp(app.id!); toast('Приложение удалено'); nav('/') }
    catch (e) { toast((e as Error).message, true) }
  }
  const addEnv = () => {
    const names = app.targets.map(t => t.name.toLowerCase())
    const name = !names.includes('test') ? 'Test' : !names.includes('prod') ? 'Prod' : `Env ${app.targets.length + 1}`
    set({ targets: [...app.targets, newTarget(name, conns[0]?.id)] })
    setEnvIdx(app.targets.length)
  }

  return (
    <div className="page">
      <Link to="/" className="crumb"><Icon name="back" />Приложения</Link>
      <div className="page-head">
        <div>
          <h1>{isNew ? 'Новое приложение' : app.name || 'Без названия'}</h1>
          <p>Откуда собирать, куда класть и что подставить в appsettings.</p>
        </div>
        {!isNew && <button className="btn ghost danger" onClick={() => setAskDelete(true)}>Удалить приложение</button>}
      </div>

      <div className="editor">
        <nav className="toc" aria-label="Разделы формы">
          {sections.map(s => (
            <a key={s.id} href={`#${s.id}`} className={spy === s.id ? 'on' : ''}
              onClick={e => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{s.label}</a>
          ))}
        </nav>

        <div className="stack">
          <section id="s-project" className="surface pad section">
            <h2>Проект</h2>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="name">Название</label>
                <input id="name" className="input" value={app.name} onChange={e => set({ name: e.target.value })} placeholder="Сервис авторизации" />
              </div>
              <div className="field">
                <label htmlFor="args">Доп. аргументы dotnet publish</label>
                <input id="args" className="input mono" value={app.publishArgs ?? ''} spellCheck={false}
                  onChange={e => set({ publishArgs: e.target.value })} placeholder="-r win-x64 --self-contained false" />
                <span className="hint">-c Release и -o подставляются сами.</span>
              </div>
              <div className="field">
                <label htmlFor="proj">Проект для публикации</label>
                <PathInput id="proj" value={app.projectPath} onChange={v => set({ projectPath: v })} expect="any"
                  placeholder="D:\src\AuthService\AuthService.Api\AuthService.Api.csproj" />
                <span className="hint">.csproj или папка, где он лежит.</span>
              </div>
              <div className="field">
                <label htmlFor="tests">Тесты</label>
                <PathInput id="tests" value={app.testPath ?? ''} onChange={v => set({ testPath: v })} expect="any"
                  placeholder="D:\src\AuthService\AuthService.sln" />
                <span className="hint">.sln или тестовый .csproj. Пусто — публикую без тестов.</span>
              </div>
            </div>
          </section>

          <section id="s-envs" className="surface pad section">
            <h2>Окружения</h2>
            <div className="env-tabs">
              <Segmented<number> label="Окружения" value={ei} onChange={setEnvIdx}
                options={app.targets.map((t, i) => ({ value: i, label: t.name || 'Без имени' }))} />
              <button className="btn sm ghost" onClick={addEnv}><Icon name="plus" />Окружение</button>
            </div>

            {env && (
              <div key={ei} className="stack" style={{ animation: 'page-in .25s var(--ease)' }}>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="ename">Название окружения</label>
                    <input id="ename" className="input" value={env.name} onChange={e => setTarget(ei, { name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="epath">Папка на сервере</label>
                    <PathInput id="epath" value={env.targetPath} onChange={v => setTarget(ei, { targetPath: v })} expect="dir"
                      placeholder="\\srv-iis01\c$\inetpub\auth" />
                  </div>
                  <div className="field">
                    <label htmlFor="ehealth">URL health</label>
                    <input id="ehealth" className="input mono" value={env.healthUrl ?? ''} spellCheck={false}
                      onChange={e => setTarget(ei, { healthUrl: e.target.value })} placeholder="http://srv-iis01/auth/api/health" />
                  </div>
                  <div className="field" style={{ alignContent: 'end' }}>
                    <label className="check" style={{ fontWeight: 500, paddingBottom: 10 }}>
                      <input type="checkbox" checked={env.ignoreTlsErrors} onChange={e => setTarget(ei, { ignoreTlsErrors: e.target.checked })} />
                      Не проверять сертификат (самоподписанный HTTPS)
                    </label>
                  </div>
                </div>

                <div className="divider" />
                <div>
                  <p className="subhead">Строки подключения</p>
                  {conns.length === 0 && <p className="hint">Справочник пуст. <Link to="/connections">Заполни его</Link>, чтобы привязать строки.</p>}
                  <div style={{ display: 'grid', gap: 8 }}>
                    {env.bindings.map((b, bi) => (
                      <div key={bi} className="binding">
                        <input className="input mono" aria-label="Путь в appsettings" value={b.jsonPath} spellCheck={false}
                          onChange={e => setTarget(ei, { bindings: env.bindings.map((x, k) => k === bi ? { ...x, jsonPath: e.target.value } : x) })}
                          placeholder="ConnectionStrings:DefaultConnection" />
                        <select className="select" aria-label="Строка из справочника" value={b.connectionStringId}
                          onChange={e => setTarget(ei, { bindings: env.bindings.map((x, k) => k === bi ? { ...x, connectionStringId: Number(e.target.value) } : x) })}>
                          {conns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <button className="btn ghost sm" aria-label="Убрать привязку" onClick={() => setTarget(ei, { bindings: env.bindings.filter((_, k) => k !== bi) })}><Icon name="x" /></button>
                      </div>
                    ))}
                    <div>
                      <button className="btn sm" disabled={conns.length === 0}
                        onClick={() => setTarget(ei, { bindings: [...env.bindings, { jsonPath: 'ConnectionStrings:', connectionStringId: conns[0].id }] })}>
                        <Icon name="plus" />Привязать строку
                      </button>
                    </div>
                  </div>
                </div>

                <div className="divider" />
                <div>
                  <p className="subhead">Ключи подписи окружения</p>
                  {env.id ? <TargetKeys targetId={env.id} keyPaths={app.keyPaths} />
                    : <div className="hint">Сохрани приложение, тогда здесь появятся ключи.</div>}
                </div>

                <div className="row">
                  <span className="spacer" />
                  <button className="btn ghost danger sm" disabled={app.targets.length === 1}
                    title={app.targets.length === 1 ? 'Нужно хотя бы одно окружение' : 'Удалится вместе с ключами и бэкапами после сохранения'}
                    onClick={() => { set({ targets: app.targets.filter((_, j) => j !== ei) }); setEnvIdx(Math.max(0, ei - 1)) }}>
                    Убрать окружение «{env.name}»
                  </button>
                </div>
              </div>
            )}
          </section>

          <section id="s-keys" className="surface pad section">
            <h2>Ключи подписи</h2>
            <div className="field">
              <label htmlFor="keys">Пути в appsettings, по одному на строку</label>
              <textarea id="keys" className="textarea mono" value={form.keys} spellCheck={false}
                onChange={e => setForm({ ...form, keys: e.target.value })} placeholder={'Jwt:Key\nJwt:RefreshKey'} />
              <span className="hint">
                Если значение начинается на «dev» в любом регистре, при публикации подставлю ключ окружения.
                Ключ создаётся один раз и дальше не меняется. Не dev-значения не трогаю.
              </span>
            </div>
          </section>

          <section id="s-excl" className="surface pad section">
            <h2>Исключения</h2>
            <div className="field">
              <label htmlFor="excl">Что не трогать в папке на сервере</label>
              <textarea id="excl" className="textarea mono" value={form.excl} spellCheck={false}
                onChange={e => setForm({ ...form, excl: e.target.value })} placeholder={'logs\nuploads\n*.log'} />
              <span className="hint">
                Пути относительно папки на сервере. Папка исключается целиком, можно маски вроде *.log.
                Исключённое не удаляется и не перезаписывается.
              </span>
            </div>
          </section>
        </div>
      </div>

      {(dirty || isNew) && (
        <div className="savebar" role="region" aria-label="Несохранённые изменения">
          <span style={{ fontSize: 14 }}>{isNew ? 'Новое приложение' : 'Есть несохранённые изменения'}</span>
          {!isNew && <button className="btn ghost sm" onClick={reset}>Отменить</button>}
          <button className="btn go sm" onClick={save} disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      )}

      {askDelete && (
        <Confirm title={`Удалить «${app.name}»?`}
          text="Удалятся настройки, ключи подписи окружений и бэкапы. Файлы на сервере останутся как есть."
          action="Удалить" danger onYes={remove} onNo={() => setAskDelete(false)} />
      )}
    </div>
  )
}
