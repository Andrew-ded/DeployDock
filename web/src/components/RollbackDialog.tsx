import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { backupLabel, when } from '../format'
import type { Backup } from '../types'
import { Icon, Modal, useToast } from './ui'

/** Выбор бэкапа и запуск отката. По умолчанию выбран самый свежий — это версия до последнего деплоя. */
export function RollbackDialog({ targetId, title, onClose }: { targetId: number; title: string; onClose: () => void }) {
  const [backups, setBackups] = useState<Backup[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const nav = useNavigate()

  useEffect(() => {
    api.backups(targetId).then(b => { setBackups(b); setSel(b[0]?.name ?? null) })
      .catch(e => toast(e.message, true))
  }, [targetId])

  const go = async () => {
    if (!sel) return
    setBusy(true)
    try {
      const { id } = await api.rollback(targetId, sel)
      onClose()
      nav(`/runs/${id}`)
    } catch (e) {
      toast((e as Error).message, true)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Откат: ${title}`} onClose={onClose}>
      <div className="hint">Файлы в папке на сервере заменятся содержимым бэкапа, исключения не тронутся. Верхний бэкап — версия перед последней публикацией.</div>
      {backups === null ? <p className="muted">Загружаю…</p>
        : backups.length === 0 ? <p>Бэкапов нет, откатываться не на что.</p>
        : (
          <div className="backup-list" role="radiogroup" aria-label="Бэкапы">
            {backups.map((b, i) => (
              <label key={b.name} className={`backup-item${sel === b.name ? ' sel' : ''}`}>
                <input type="radio" name="backup" checked={sel === b.name} onChange={() => setSel(b.name)} />
                <span style={{ flex: 1, fontWeight: 600 }}>{backupLabel(b.name)}</span>
                <span className="muted" style={{ fontSize: 13 }}>{i === 0 ? 'перед последним деплоем' : when(b.createdAt)}</span>
              </label>
            ))}
          </div>
        )}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn solid-bad" disabled={!sel || busy} onClick={go}><Icon name="undo" />Откатить</button>
      </div>
    </Modal>
  )
}
