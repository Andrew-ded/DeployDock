import type { DashboardTarget, RunStatus } from './types'

export const statusText: Record<RunStatus, string> = {
  Running: 'идёт',
  Succeeded: 'опубликовано',
  TestsFailed: 'упали тесты',
  Failed: 'ошибка',
  HealthFailed: 'не поднялось',
  Cancelled: 'отменено',
}

export type Tone = 'ok' | 'bad' | 'warn' | 'idle' | 'busy'

export const statusTone: Record<RunStatus, Tone> = {
  Running: 'busy',
  Succeeded: 'ok',
  TestsFailed: 'bad',
  Failed: 'bad',
  HealthFailed: 'bad',
  Cancelled: 'warn',
}

/** Состояние окружения для плиток и дашборда. */
export function envState(t: DashboardTarget): { tone: Tone; label: string } {
  if (t.busy) return { tone: 'busy', label: t.lastRun?.kind === 'Rollback' ? 'Откатывается' : 'Публикуется' }
  if (!t.healthUrl) return { tone: 'idle', label: 'Без health' }
  if (t.lastHealthOk === true) return { tone: 'ok', label: 'Живо' }
  if (t.lastHealthOk === false) return { tone: 'bad', label: 'Не отвечает' }
  return { tone: 'idle', label: 'Не проверяли' }
}

export function when(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `сегодня в ${time}`
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `вчера в ${time}`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ` в ${time}`
}

export function duration(from: string | null, to: string | null) {
  if (!from) return ''
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`
}

export function backupLabel(name: string) {
  // 20261022-154501 → 22.10 15:45:01
  const m = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}:${m[6]}` : name
}
