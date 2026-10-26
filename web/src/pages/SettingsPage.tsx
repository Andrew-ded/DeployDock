import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Settings } from '../types'
import { Icon, useToast } from '../components/ui'
import { desktop } from '../desktop'

const fields: { key: keyof Settings; label: string; hint?: string; min: number; max: number; unit: string }[] = [
  { key: 'backupsToKeep', label: 'Бэкапов на окружение', min: 1, max: 50, unit: 'шт' },
  { key: 'healthTimeoutSec', label: 'Ждать health после копирования', hint: 'Первый запрос к IIS после деплоя бывает долгим из-за прогрева.', min: 5, max: 600, unit: 'с' },
  { key: 'offlineDelaySec', label: 'Пауза после app_offline.htm', hint: 'Время, чтобы IIS остановил приложение и отпустил dll.', min: 0, max: 60, unit: 'с' },
  { key: 'keyBytes', label: 'Длина ключей окружений', hint: 'Влияет только на новые ключи. Пишутся в Base64.', min: 32, max: 256, unit: 'байт' },
]

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null)
  const [orig, setOrig] = useState('')
  const [info, setInfo] = useState<{ dataDir: string; version: string; portable: boolean } | null>(null)
  const toast = useToast()

  useEffect(() => {
    api.settings().then(x => { setS(x); setOrig(JSON.stringify(x)) }).catch(e => toast(e.message, true))
    api.info().then(setInfo).catch(() => {})
  }, [])

  if (!s) return <div className="page"><p className="muted">Загружаю…</p></div>

  const save = async () => {
    try { const x = await api.saveSettings(s); setS(x); setOrig(JSON.stringify(x)); toast('Сохранено') }
    catch (e) { toast((e as Error).message, true) }
  }
  const dirty = JSON.stringify(s) !== orig

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head"><div><h1>Настройки</h1></div></div>
      <section className="surface pad">
        <div className="grid-2">
          {fields.map(f => (
            <div key={f.key} className="field">
              <label htmlFor={f.key}>{f.label}</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input id={f.key} type="number" min={f.min} max={f.max} className="input" value={s[f.key]}
                  onChange={e => setS({ ...s, [f.key]: Number(e.target.value) })} />
                <span className="muted" style={{ minWidth: 34 }}>{f.unit}</span>
              </div>
              {f.hint && <span className="hint">{f.hint}</span>}
            </div>
          ))}
        </div>
      </section>
      {info && (
        <section className="surface pad" style={{ marginTop: 16 }}>
          <h2>Данные</h2>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 6 }}>
              <code style={{ justifySelf: 'start' }}>{info.dataDir}</code>
              <span className="hint">
                {info.portable
                  ? <>Здесь лежат <code>deploydock.db</code> (приложения, справочник, ключи окружений) и <code>deploydock.key</code>, которым они зашифрованы.
                    Чтобы перенести всё на другой ПК, скопируй оба файла в папку <code>data</code> рядом с DeployDock.exe. Без <code>.key</code> строки подключения и ключи не расшифруются.</>
                  : <>Строки подключения и ключи зашифрованы ключом <code>deploydock.key</code> из этой же папки.</>}
              </span>
              <span className="hint">Бэкапы для отката и логи запусков тоже здесь, в папках <code>backups</code> и <code>logs</code>. Версия {info.version}.</span>
            </div>
            {desktop && <button className="btn" onClick={() => desktop!.openPath(info.dataDir)}><Icon name="folder" />Открыть папку</button>}
          </div>
        </section>
      )}
      {dirty && (
        <div className="savebar" role="region" aria-label="Несохранённые изменения">
          <span style={{ fontSize: 14 }}>Есть несохранённые изменения</span>
          <button className="btn ghost sm" onClick={() => setS(JSON.parse(orig))}>Отменить</button>
          <button className="btn go sm" onClick={save}>Сохранить</button>
        </div>
      )}
    </div>
  )
}
