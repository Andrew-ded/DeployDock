// DeployDock desktop: окно + скрытый .NET-бэкенд, без консоли.
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, screen } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const isWin = process.platform === 'win32'
const TITLEBAR_H = 60

// ───────────── пути ─────────────

/** Папка data рядом с DeployDock.exe — всё переносимое лежит там. */
function resolveDataDir() {
  const base = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..')
  const preferred = path.join(base, 'data')
  try {
    fs.mkdirSync(preferred, { recursive: true })
    fs.accessSync(preferred, fs.constants.W_OK)
    return { dir: preferred, fallback: false }
  } catch {
    // Например, распаковали в Program Files без прав на запись
    const alt = path.join(app.getPath('userData'), 'data')
    fs.mkdirSync(alt, { recursive: true })
    return { dir: alt, fallback: true }
  }
}

function backendCommand() {
  if (app.isPackaged) {
    const dir = path.join(process.resourcesPath, 'backend')
    const exe = path.join(dir, isWin ? 'DeployDock.Server.exe' : 'DeployDock.Server')
    if (fs.existsSync(exe)) return { cmd: exe, args: [], cwd: dir }
    return { cmd: 'dotnet', args: [path.join(dir, 'DeployDock.Server.dll')], cwd: dir }
  }
  // Режим разработки: бэкенд из server/bin
  const dll = process.env.DEPLOYDOCK_BACKEND_DLL ||
    path.join(__dirname, '..', '..', 'server', 'bin', 'Release', 'net9.0', 'DeployDock.dll')
  return { cmd: 'dotnet', args: [dll], cwd: path.dirname(dll) }
}

/**
 * Single-file бэкенд ищет .NET в стандартных местах. Если dotnet стоит нестандартно
 * (портативно, в профиле пользователя), подсказываем ему DOTNET_ROOT по PATH.
 */
function dotnetRoot() {
  if (process.env.DOTNET_ROOT) return process.env.DOTNET_ROOT
  const name = isWin ? 'dotnet.exe' : 'dotnet'
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    try {
      const real = fs.realpathSync(path.join(dir, name))
      if (fs.existsSync(path.join(path.dirname(real), 'host', 'fxr'))) return path.dirname(real)
    } catch { /* нет в этой папке */ }
  }
  return null
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

// ───────────── состояние ─────────────

let win = null
let backend = null
let backendUrl = null
let quitting = false
let data = null
let logStream = null
const recentLines = []

function log(line) {
  const l = `[${new Date().toISOString()}] ${line}`
  recentLines.push(l)
  if (recentLines.length > 80) recentLines.shift()
  try { logStream?.write(l + '\n') } catch { /* лог — не критично */ }
}

function openLog() {
  const dir = path.join(data.dir, 'logs')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'app.log')
  try { if (fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.old') } catch { /* нет файла */ }
  logStream = fs.createWriteStream(file, { flags: 'a' })
}

// ───────────── окно ─────────────

const stateFile = () => path.join(data.dir, 'window.json')

function loadBounds() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    // Не открываться за пределами экранов, если монитор отключили
    const visible = screen.getAllDisplays().some(d => {
      const a = d.workArea
      return s.x < a.x + a.width - 100 && s.x + s.width > a.x + 100 && s.y >= a.y - 20 && s.y < a.y + a.height - 100
    })
    return visible ? s : { width: s.width, height: s.height, maximized: s.maximized }
  } catch {
    return { width: 1320, height: 860 }
  }
}

function saveBounds() {
  if (!win || win.isDestroyed()) return
  try {
    const b = win.getNormalBounds()
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }))
  } catch (e) { log(`window state not saved: ${e.message}`) }
}

function overlayColors() {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#0c0f13', symbolColor: '#e8ecf0' }
    : { color: '#edeff2', symbolColor: '#11151b' }
}

function createWindow() {
  const b = loadBounds()
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    minWidth: 900, minHeight: 600,
    title: 'DeployDock',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: overlayColors().color,
    show: false,
    // Своя верхняя панель вместо системной рамки; кнопки окна рисует Windows поверх
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...overlayColors(), height: TITLEBAR_H },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  if (b.maximized) win.maximize()

  win.once('ready-to-show', () => win.show())
  win.on('close', () => { log('window close'); saveBounds() })
  win.on('closed', () => { win = null })

  // Ссылки наружу — в системный браузер, а не в окно приложения
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const ownApp = backendUrl && url.startsWith(backendUrl)
    const ownFile = url.startsWith('file:')
    if (!ownApp && !ownFile) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url) }
  })

  // Пара привычных клавиш при отключённом меню
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta
    if (input.key === 'F12' || (mod && input.shift && input.key.toLowerCase() === 'i')) { win.webContents.toggleDevTools(); e.preventDefault() }
    else if (input.key === 'F5' || (mod && input.key.toLowerCase() === 'r')) { win.webContents.reload(); e.preventDefault() }
    else if (mod && (input.key === '=' || input.key === '+')) { win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5); e.preventDefault() }
    else if (mod && input.key === '-') { win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5); e.preventDefault() }
    else if (mod && input.key === '0') { win.webContents.setZoomLevel(0); e.preventDefault() }
  })

  win.loadFile(path.join(__dirname, 'loading.html'))
}

function showError(title, details) {
  if (!win) return
  const q = new URLSearchParams({ title, details }).toString()
  win.loadFile(path.join(__dirname, 'loading.html'), { search: q })
}

// ───────────── бэкенд ─────────────

async function startBackend() {
  const port = await freePort()
  const { cmd, args, cwd } = backendCommand()
  const full = [...args, '--urls', `http://127.0.0.1:${port}`, '--data-dir', data.dir,
    '--parent-pid', String(process.pid), '--no-browser']

  log(`start backend: ${cmd} ${full.join(' ')}`)
  backendUrl = null

  // Node отдаёт ENOENT и когда нет dotnet, и когда нет папки/файла бэкенда — разводим заранее
  const target = cmd === 'dotnet' ? args[0] : cmd
  if (!fs.existsSync(cwd) || !fs.existsSync(target)) {
    return onBackendDead(`Не найдены файлы сервера: ${target}\nПохоже, архив распакован не целиком. Распакуй папку DeployDock заново.`)
  }

  try {
    backend = spawn(cmd, full, {
      cwd,
      windowsHide: true, // главное: никакой консоли
      env: {
        ...process.env,
        ...(dotnetRoot() ? { DOTNET_ROOT: dotnetRoot() } : {}),
        DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', ASPNETCORE_ENVIRONMENT: 'Production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    return onBackendDead(`Не удалось запустить бэкенд: ${e.message}`)
  }

  const onData = chunk => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      log(line)
      const m = line.match(/DEPLOYDOCK_READY (\S+)/)
      if (m && !backendUrl) {
        backendUrl = m[1].replace('localhost', '127.0.0.1')
        win?.loadURL(backendUrl)
      }
    }
  }
  backend.stdout.on('data', onData)
  backend.stderr.on('data', onData)
  backend.on('error', e => onBackendDead(
    e.code === 'ENOENT'
      ? 'Не найден .NET. Нужен .NET 9 (Runtime или SDK): https://dotnet.microsoft.com/download/dotnet/9.0'
      : `Бэкенд не запустился: ${e.message}`))
  backend.on('exit', code => {
    log(`backend exited with ${code}`)
    backend = null
    if (quitting) return
    const tail = recentLines.slice(-30).join('\n')
    if (/You must install|install or update \.NET|Framework: 'Microsoft\.(AspNetCore|NETCore)\.App'/i.test(tail))
      onBackendDead('Не найден .NET 9. Поставь ASP.NET Core Runtime 9 или .NET 9 SDK: https://dotnet.microsoft.com/download/dotnet/9.0')
    else if (/address already in use|failed to bind/i.test(tail))
      onBackendDead('Порт оказался занят. Нажми «Запустить ещё раз», возьму другой.')
    else
      onBackendDead(`Сервер завершился с кодом ${code}.`)
  })
}

let deadShown = false
function onBackendDead(reason) {
  if (quitting || deadShown) return
  deadShown = true
  log(reason)
  showError('DeployDock не запустился', `${reason}\n\nЛог: ${path.join(data.dir, 'logs', 'app.log')}\n\n${recentLines.slice(-25).join('\n')}`)
}

function stopBackend() {
  if (!backend) return
  const pid = backend.pid
  try {
    if (isWin) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    else backend.kill('SIGTERM')
  } catch { /* уже нет */ }
}

// ───────────── IPC для страницы ─────────────

function registerIpc() {
  ipcMain.handle('dd:pickFolder', async (_e, defaultPath) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Выбери папку', defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dd:pickProject', async (_e, defaultPath) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Выбери проект или решение', defaultPath: defaultPath || undefined,
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'Проекты .NET', extensions: ['csproj', 'sln', 'slnx'] }, { name: 'Все файлы', extensions: ['*'] }],
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dd:openPath', async (_e, p) => {
    if (typeof p !== 'string' || !p) return 'пустой путь'
    return shell.openPath(p)
  })
  ipcMain.handle('dd:info', () => ({
    version: app.getVersion(), dataDir: data.dir, dataFallback: data.fallback, platform: process.platform,
  }))
  ipcMain.handle('dd:titlebar', () => ({ height: TITLEBAR_H, overlay: true, platform: process.platform }))
  ipcMain.handle('dd:retry', async () => {
    deadShown = false
    stopBackend()
    win?.loadFile(path.join(__dirname, 'loading.html'))
    await startBackend()
  })
  ipcMain.handle('dd:openLogs', () => shell.openPath(path.join(data.dir, 'logs')))
}

// ───────────── жизненный цикл ─────────────

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.setAppUserModelId('DeployDock')

  app.whenReady().then(async () => {
    data = resolveDataDir()
    openLog()
    log(`DeployDock ${app.getVersion()}, data: ${data.dir}${data.fallback ? ' (запасная папка, рядом с exe нет прав на запись)' : ''}`)

    nativeTheme.on('updated', () => { try { win?.setTitleBarOverlay(overlayColors()) } catch { /* не везде есть */ } })
    registerIpc()
    createWindow()
    await startBackend()
  })

  app.on('before-quit', () => { quitting = true; stopBackend() })
  app.on('window-all-closed', () => app.quit())
}
