/** То, что даёт десктоп-оболочка через preload. В браузере и в демо — undefined. */
export type DesktopBridge = {
  desktop: true
  pickFolder: (defaultPath?: string | null) => Promise<string | null>
  pickProject: (defaultPath?: string | null) => Promise<string | null>
  openPath: (p: string) => Promise<string>
  openLogs: () => Promise<string>
  info: () => Promise<{ version: string; dataDir: string; dataFallback: boolean; platform: string }>
  titlebar: () => Promise<{ height: number; overlay: boolean; platform: string }>
}

export const desktop: DesktopBridge | undefined = (window as unknown as { deploydock?: DesktopBridge }).deploydock

if (desktop) document.documentElement.classList.add('is-desktop')

/**
 * Планшет — терминал: плитки сайтов и кнопка публикации, без настроек и строк подключения.
 * Это любой не-десктопный клиент на Android/iPad; для проверки в обычном браузере есть ?view=tablet и ?view=full.
 */
function detectTablet() {
  if (desktop) return false
  const v = new URLSearchParams(location.search).get('view')
  if (v === 'tablet') return true
  if (v === 'full') return false
  return /Android|iPad/i.test(navigator.userAgent)
}
export const isTablet = detectTablet()
if (isTablet) document.documentElement.classList.add('is-tablet')

/** Стартовая папка для диалога: сам путь, если это папка, или папка файла. */
export function dirOf(p: string) {
  const t = p.trim()
  if (!t) return null
  return /\.[a-z0-9]{2,6}$/i.test(t) ? t.replace(/[\\/][^\\/]*$/, '') : t
}
