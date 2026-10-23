import { useEffect, useState } from 'react'
import { api } from '../api'
import { when } from '../format'
import type { SigningKey } from '../types'
import { Chip, Confirm, CopyButton, Icon, useToast } from './ui'

/**
 * Сохранённые ключи подписи окружения. Ключ создаётся один раз (при первой публикации
 * или кнопкой) и дальше подставляется тот же самый.
 */
export function TargetKeys({ targetId, keyPaths }: { targetId: number; keyPaths: string[] }) {
  const [keys, setKeys] = useState<SigningKey[] | null>(null)
  const [shown, setShown] = useState<Record<number, string>>({})
  const [ask, setAsk] = useState<{ path: string; existing: boolean } | null>(null)
  const toast = useToast()

  const load = () => api.targetKeys(targetId).then(setKeys).catch(e => toast(e.message, true))
  useEffect(() => { load() }, [targetId])

  const paths = Array.from(new Set([...keyPaths, ...(keys?.map(k => k.jsonPath) ?? [])]))
  if (paths.length === 0) return <div className="hint">Пути ключей не заданы, подменять нечего.</div>

  const regenerate = async (path: string) => {
    setAsk(null)
    try {
      await api.regenerateKey(targetId, path)
      setShown({})
      await load()
      toast(`Ключ ${path} сгенерирован`)
    } catch (e) { toast((e as Error).message, true) }
  }

  const reveal = async (k: SigningKey) => {
    if (shown[k.id]) { const s = { ...shown }; delete s[k.id]; setShown(s); return }
    const { value } = await api.keyValue(k.id)
    setShown({ ...shown, [k.id]: value })
  }

  return (
    <div>
      {paths.map(p => {
        const k = keys?.find(x => x.jsonPath.toLowerCase() === p.toLowerCase())
        const orphan = !keyPaths.some(x => x.toLowerCase() === p.toLowerCase())
        return (
          <div key={p} className="key-row">
            <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="key-path">{p}</span>
                {k ? <Chip tone="ok">создан {when(k.createdAt)}</Chip> : <Chip tone="idle">ещё нет</Chip>}
                {orphan && <Chip tone="warn">путь убран из настроек</Chip>}
              </div>
              <div className="key-val">
                {k ? (shown[k.id] ?? k.masked) : 'Появится при первой публикации, если в appsettings стоит dev-значение.'}
              </div>
            </div>
            <div className="key-actions">
              {k && <button className="btn ghost sm" onClick={() => reveal(k)} title={shown[k.id] ? 'Скрыть' : 'Показать'} aria-label={shown[k.id] ? 'Скрыть' : 'Показать'}>
                <Icon name={shown[k.id] ? 'eyeOff' : 'eye'} /></button>}
              {k && <CopyButton get={async () => (await api.keyValue(k.id)).value} />}
              <button className="btn sm" onClick={() => setAsk({ path: p, existing: !!k })}>
                <Icon name="refresh" />{k ? 'Перегенерировать' : 'Сгенерировать'}
              </button>
            </div>
          </div>
        )
      })}
      {ask && (
        <Confirm
          title={ask.existing ? 'Перегенерировать ключ?' : 'Сгенерировать ключ?'}
          text={ask.existing
            ? <>Старый ключ <code>{ask.path}</code> пропадёт. После следующей публикации все выданные им токены станут невалидными.</>
            : <>Ключ <code>{ask.path}</code> создастся сейчас и будет подставляться при каждой публикации.</>}
          action={ask.existing ? 'Перегенерировать' : 'Сгенерировать'}
          danger={ask.existing}
          onYes={() => regenerate(ask.path)} onNo={() => setAsk(null)} />
      )}
    </div>
  )
}
