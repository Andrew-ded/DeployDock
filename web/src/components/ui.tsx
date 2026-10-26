import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { desktop, dirOf } from '../desktop'
import type { Tone } from '../format'

// ───── плоские статусы ─────
export function Dot({ tone, lg, title }: { tone: Tone; lg?: boolean; title?: string }) {
  return <span className={`dot t-${tone}${lg ? ' lg' : ''}`} title={title} role={title ? 'img' : undefined} aria-label={title} aria-hidden={!title} />
}

export function Chip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span className={`chip t-${tone}`} title={title}><span className="dot" />{children}</span>
}

// ───── иконки (штрих, 1.8) ─────
const paths: Record<string, ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chev: <path d="M9 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  play: <path d="M7 5l12 7-12 7V5z" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  pulse: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  shuffle: <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />,
  alert: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  minus: <path d="M5 12h14" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
}
export function Icon({ name, size }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size ?? 16} height={size ?? 16} fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
  )
}

// ───── сегменты со скользящей подложкой ─────
export function Segmented<T extends string | number>({ options, value, onChange, small, label }: {
  options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; small?: boolean; label?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)

  useLayoutEffect(() => {
    const root = ref.current
    const el = root?.querySelector<HTMLElement>('[data-on="true"]')
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth })
  }, [value, options.length, ...options.map(o => String(o.label))])

  return (
    <div ref={ref} className={`seg${small ? ' sm' : ''}`} role="tablist" aria-label={label}>
      {pill && <span className="seg-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />}
      {options.map(o => (
        <button key={String(o.value)} type="button" role="tab" aria-selected={o.value === value}
          data-on={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ───── тосты ─────
type ToastItem = { id: number; text: string; bad?: boolean }
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, bad?: boolean) => {
    const id = Date.now() + Math.random()
    setItems(x => [...x.slice(-3), { id, text, bad }])
    setTimeout(() => setItems(x => x.filter(i => i.id !== id)), bad ? 6500 : 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(t => <div key={t.id} className={`toast${t.bad ? ' bad' : ''}`}><span className="dot" />{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
}

// ───── модалка ─────
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEscape(onClose)
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal-wrap">
        <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
          <h2>{title}</h2>
          {children}
        </div>
      </div>
    </>, document.body)
}

export function Confirm({ title, text, action, danger, onYes, onNo }: {
  title: string; text: ReactNode; action: string; danger?: boolean; onYes: () => void; onNo: () => void
}) {
  return (
    <Modal title={title} onClose={onNo}>
      <div className="hint" style={{ fontSize: 14.5 }}>{text}</div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onNo}>Отмена</button>
        <button className={`btn ${danger ? 'solid-bad' : 'go'}`} onClick={onYes} autoFocus>{action}</button>
      </div>
    </Modal>
  )
}

// ───── выезжающая панель ─────
export function Drawer({ title, children, footer, onClose }: { title: string; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  useEscape(onClose)
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Закрыть"><Icon name="x" /></button>
        </div>
        <div className="drawer-body">{children}</div>
        <div className="drawer-foot">{footer}</div>
      </aside>
    </>, document.body)
}

// ───── поле пути с проверкой существования ─────
export function PathInput({ value, onChange, placeholder, expect, id }: {
  value: string; onChange: (v: string) => void; placeholder?: string; expect?: 'file' | 'dir' | 'any'; id?: string
}) {
  const [kind, setKind] = useState<string | null>(null)
  const timer = useRef<number>(undefined)

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (!value.trim()) { setKind(null); return }
    timer.current = window.setTimeout(async () => {
      try {
        const [r] = await api.checkPaths([value.trim()])
        setKind(r.kind)
      } catch { setKind(null) }
    }, 350)
    return () => window.clearTimeout(timer.current)
  }, [value])

  let tag: ReactNode = null
  if (kind === 'missing') tag = <Chip tone="bad">не найден</Chip>
  else if (kind === 'file') tag = <Chip tone={expect === 'dir' ? 'bad' : 'ok'}>файл</Chip>
  else if (kind === 'dir') tag = <Chip tone="ok">папка</Chip>

  const browse = async () => {
    if (!desktop) return
    const start = dirOf(value)
    const picked = expect === 'dir' ? await desktop.pickFolder(start) : await desktop.pickProject(start)
    if (picked) onChange(picked)
  }

  return (
    <div className={`path-row${desktop ? ' has-browse' : ''}`}>
      <div className="path-wrap">
        <input id={id} className="input mono" value={value} placeholder={placeholder} spellCheck={false}
          onChange={e => onChange(e.target.value)} />
        {tag && <span className="path-tag" key={kind}>{tag}</span>}
      </div>
      {desktop && (
        <button type="button" className="btn" onClick={browse} title={expect === 'dir' ? 'Выбрать папку' : 'Выбрать .csproj или .sln'}>
          <Icon name="folder" />Обзор
        </button>
      )}
    </div>
  )
}

export function CopyButton({ get, label = 'Копировать', small = true }: { get: () => Promise<string> | string; label?: string; small?: boolean }) {
  const toast = useToast()
  const [done, setDone] = useState(false)
  return (
    <button className={`btn ${small ? 'sm' : ''}`} onClick={async () => {
      try {
        const v = await get()
        await copyText(v)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      } catch (e) { toast((e as Error).message, true) }
    }}><Icon name={done ? 'check' : 'copy'} />{done ? 'Скопировано' : label}</button>
  )
}

/** navigator.clipboard работает только на https/localhost — на всякий случай есть запасной путь. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}
