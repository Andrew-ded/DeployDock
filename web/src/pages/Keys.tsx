import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { AppProject } from '../types'
import { Icon, Segmented, copyText, useToast } from '../components/ui'
import { TargetKeys } from '../components/TargetKeys'

const alphabet: Record<string, string> = {
  base64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  base64url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  hex: '0123456789ABCDEF',
}

/** Новый ключ «проявляется» слева направо из случайных символов. */
function useScramble(target: string, format: string) {
  const [shown, setShown] = useState(target)
  const [settled, setSettled] = useState(target.length)
  const raf = useRef(0)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!target || reduce) { setShown(target); setSettled(target.length); return }
    const chars = alphabet[format] ?? alphabet.base64
    const start = performance.now()
    const dur = 520
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur)
      const fixed = Math.floor(k * target.length)
      let s = target.slice(0, fixed)
      for (let i = fixed; i < target.length; i++) s += chars[(Math.random() * chars.length) | 0]
      setShown(s); setSettled(fixed)
      if (k < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [target])
  return { shown, settled }
}

export default function Keys() {
  const [bytes, setBytes] = useState(64)
  const [format, setFormat] = useState('base64')
  const [value, setValue] = useState('')
  const [apps, setApps] = useState<AppProject[] | null>(null)
  const toast = useToast()
  const { shown, settled } = useScramble(value, format)

  const generate = async () => {
    try { setValue((await api.generateKey(bytes, format)).value) }
    catch (e) { toast((e as Error).message, true) }
  }
  const copy = async () => { if (!value) return; await copyText(value); toast('Ключ скопирован') }

  useEffect(() => { generate() }, [bytes, format])
  useEffect(() => { api.apps().then(setApps).catch(e => toast(e.message, true)) }, [])

  const withKeys = apps?.filter(a => a.keyPaths.length > 0) ?? []

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Ключи подписи</h1>
          <p>Генератор случайных ключей и ключи окружений, которые подставляются вместо dev-значений.</p>
        </div>
      </div>

      <div className="stack">
        <section className="surface pad gen" aria-label="Генератор">
          <div className="gen-controls">
            <div className="field">
              <span className="label">Длина</span>
              <Segmented<number> small label="Длина" value={bytes} onChange={setBytes}
                options={[32, 48, 64, 128].map(b => ({ value: b, label: `${b} байт` }))} />
            </div>
            <div className="field">
              <span className="label">Формат</span>
              <Segmented<string> small label="Формат" value={format} onChange={setFormat}
                options={[{ value: 'base64', label: 'Base64' }, { value: 'base64url', label: 'Base64 URL' }, { value: 'hex', label: 'Hex' }]} />
            </div>
            <span className="spacer" />
            <span className="hint">{bytes * 8} бит. Для HMAC-SHA256 нужно от 32 байт.</span>
          </div>
          <div className="keyface" onClick={copy} title="Нажми, чтобы скопировать" role="button" tabIndex={0}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && copy()} aria-live="polite">
            {shown.slice(0, settled)}<span className="scr">{shown.slice(settled)}</span>
          </div>
          <div className="row">
            <button className="btn go" onClick={copy} disabled={!value}><Icon name="copy" />Копировать</button>
            <button className="btn" onClick={generate}><Icon name="shuffle" />Другой ключ</button>
            <span className="hint">Нигде не сохраняется. Скопировал и вставил сам.</span>
          </div>
        </section>

        <section className="surface pad" aria-label="Ключи окружений">
          <h2>Ключи окружений</h2>
          <p className="hint" style={{ marginTop: -6 }}>
            Создаются один раз на окружение и путь, дальше при каждой публикации подставляется тот же ключ. Пути задаются в настройках приложения.
          </p>
          {apps === null ? <p className="muted">Загружаю…</p> : withKeys.length === 0 ? (
            <p className="hint">Ни у одного приложения не указаны пути ключей.</p>
          ) : (
            <div className="stack" style={{ marginTop: 14 }}>
              {withKeys.map(a => (
                <div key={a.id} style={{ display: 'grid', gap: 10 }}>
                  <Link to={`/apps/${a.id}`} style={{ textDecoration: 'none', fontWeight: 650, fontSize: 15 }}>{a.name}</Link>
                  <div className="stack" style={{ gap: 10 }}>
                    {a.targets.map(t => (
                      <div key={t.id} className="env-group">
                        <b>{t.name}</b>
                        <TargetKeys targetId={t.id!} keyPaths={a.keyPaths} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
