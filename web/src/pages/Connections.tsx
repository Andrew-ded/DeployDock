import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Connection } from '../types'
import { Chip, Confirm, CopyButton, Drawer, Icon, useToast } from '../components/ui'

type Draft = { id: number | null; name: string; description: string; value: string }

export default function Connections() {
  const [list, setList] = useState<Connection[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [shown, setShown] = useState<Record<number, string>>({})
  const [del, setDel] = useState<Connection | null>(null)
  const toast = useToast()

  const load = () => api.connections().then(setList).catch(e => toast(e.message, true))
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!draft) return
    try {
      const body = { name: draft.name, description: draft.description || null }
      if (draft.id == null) await api.createConnection({ ...body, value: draft.value })
      else await api.updateConnection(draft.id, { ...body, value: draft.value || null })
      setDraft(null); setShown({})
      toast(draft.id == null ? 'Строка добавлена' : 'Строка сохранена')
      load()
    } catch (e) { toast((e as Error).message, true) }
  }

  const remove = async (c: Connection) => {
    setDel(null)
    try { await api.deleteConnection(c.id); toast('Строка удалена'); load() }
    catch (e) { toast((e as Error).message, true) }
  }

  const reveal = async (c: Connection) => {
    if (shown[c.id]) { const s = { ...shown }; delete s[c.id]; setShown(s); return }
    const { value } = await api.connectionValue(c.id)
    setShown({ ...shown, [c.id]: value })
  }

  const openNew = () => setDraft({ id: null, name: '', description: '', value: '' })

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Строки подключения</h1>
          <p>Хранятся зашифрованными под твоей учёткой Windows. В окружениях привязываются к путям в appsettings.</p>
        </div>
        <button className="btn go" onClick={openNew}><Icon name="plus" />Добавить строку</button>
      </div>

      {list === null ? <p className="muted">Загружаю…</p> : list.length === 0 ? (
        <div className="surface empty-state">
          <h2>Справочник пуст</h2>
          <p>Добавь строку, например «Prod MSSQL», и выбери её в окружении приложения.</p>
          <button className="btn go lg" onClick={openNew}><Icon name="plus" />Добавить строку</button>
        </div>
      ) : (
        <div className="surface list">
          {list.map(c => (
            <div key={c.id} className="list-row">
              <div style={{ minWidth: 0 }}>
                <div className="name">{c.name}</div>
                {c.description && <div className="hint">{c.description}</div>}
              </div>
              <div className={`val${shown[c.id] ? ' shown' : ''}`}>{shown[c.id] ?? c.maskedValue}</div>
              <div className="used">
                {c.usedBy.length ? c.usedBy.map(u => <Chip key={u} tone="ok">{u}</Chip>) : <span className="muted" style={{ fontSize: 13.5 }}>нигде не используется</span>}
              </div>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                <button className="btn ghost sm" onClick={() => reveal(c)} aria-label={shown[c.id] ? 'Скрыть' : 'Показать'} title={shown[c.id] ? 'Скрыть' : 'Показать'}>
                  <Icon name={shown[c.id] ? 'eyeOff' : 'eye'} />
                </button>
                <CopyButton label="Копировать" get={async () => (await api.connectionValue(c.id)).value} />
                <button className="btn sm" onClick={() => setDraft({ id: c.id, name: c.name, description: c.description ?? '', value: '' })}>Изменить</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <Drawer title={draft.id == null ? 'Новая строка' : 'Изменить строку'} onClose={() => setDraft(null)}
          footer={<>
            {draft.id != null && (() => {
              const c = list?.find(x => x.id === draft.id)
              const used = (c?.usedBy.length ?? 0) > 0
              return <button className="btn ghost danger" disabled={used} title={used ? 'Сначала отвяжи от окружений' : undefined}
                onClick={() => { setDel(c!); setDraft(null) }} style={{ marginRight: 'auto' }}>Удалить</button>
            })()}
            <button className="btn ghost" onClick={() => setDraft(null)}>Отмена</button>
            <button className="btn go" onClick={save} disabled={!draft.name.trim() || (draft.id == null && !draft.value.trim())}>Сохранить</button>
          </>}>
          <div className="field">
            <label htmlFor="cn">Название</label>
            <input id="cn" className="input" value={draft.name} autoFocus onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Prod MSSQL" />
          </div>
          <div className="field">
            <label htmlFor="cd">Описание</label>
            <input id="cd" className="input" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Боевая база, srv-sql02" />
          </div>
          <div className="field">
            <label htmlFor="cv">Строка подключения</label>
            <textarea id="cv" className="textarea mono" rows={5} value={draft.value} spellCheck={false}
              onChange={e => setDraft({ ...draft, value: e.target.value })}
              placeholder={draft.id == null ? 'Server=srv-sql02;Database=Auth;Trusted_Connection=True;TrustServerCertificate=True' : 'Оставь пустым, чтобы не менять'} />
            {draft.id != null && <span className="hint">Текущее значение не показываю здесь: пустое поле оставит его как есть.</span>}
          </div>
        </Drawer>
      )}
      {del && (
        <Confirm title={`Удалить «${del.name}»?`} text="Строка пропадёт из справочника." action="Удалить" danger
          onYes={() => remove(del)} onNo={() => setDel(null)} />
      )}
    </div>
  )
}
