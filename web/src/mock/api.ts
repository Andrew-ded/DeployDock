import type {
  AppProject, Backup, ConfigChange, Connection, DashboardApp, Run, RunStatus, Settings, SigningKey, Stage, TestCase, TestSummary,
} from '../types'
import { bus, demo } from './bus'

/*
 * Демо-бэкенд в памяти браузера. Повторяет контракт настоящего API,
 * а деплой проигрывает по этапам с реалистичным логом dotnet.
 */

class MockError extends Error {}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const net = <T>(v: T, ms = 120): Promise<T> => wait(ms).then(() => structuredClone(v))
const fail = (msg: string, ms = 150): Promise<never> => wait(ms).then(() => { throw new MockError(msg) })

const now = () => new Date()
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const stamp = (d = now()) => d.toTimeString().slice(0, 8)
const backupName = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
const pad = (n: number) => String(n).padStart(2, '0')
const uuid = () => crypto.randomUUID()
const rand = (a: number, b: number) => Math.round(a + Math.random() * (b - a))

function randomKey(bytes: number, format = 'base64') {
  const raw = crypto.getRandomValues(new Uint8Array(Math.max(16, Math.min(256, bytes))))
  if (format === 'hex') return Array.from(raw, b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  const b64 = btoa(String.fromCharCode(...raw))
  return format === 'base64url' ? b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') : b64
}

function mask(v: string) {
  if (!v) return ''
  if (v.length <= 8) return '•'.repeat(v.length)
  return v.slice(0, 4) + '•'.repeat(8) + v.slice(-4)
}

// ───────────────────────── исходные данные ─────────────────────────

type ConnRow = { id: number; name: string; description: string | null; value: string }
type KeyRow = { id: number; targetId: number; jsonPath: string; value: string; createdAt: string }
type TargetState = { alive: boolean; deployed: boolean; healthAt: string | null; healthMsg: string | null; checked: boolean }

const db = {
  seq: 100,
  settings: { backupsToKeep: 5, healthTimeoutSec: 60, offlineDelaySec: 3, keyBytes: 64 } as Settings,
  connections: [
    { id: 1, name: 'Prod MSSQL', description: 'Боевая база, srv-sql02', value: 'Server=srv-sql02;Database=Plant;Trusted_Connection=True;TrustServerCertificate=True' },
    { id: 2, name: 'Test MSSQL', description: 'Тестовый контур', value: 'Server=srv-sql-test;Database=Plant_Test;Trusted_Connection=True;TrustServerCertificate=True' },
    { id: 3, name: 'Prod MSSQL — печать', description: 'Отдельная база очереди печати', value: 'Server=srv-sql02;Database=PrintQueue;User Id=svc_print;Password=Pr1nt!2026;TrustServerCertificate=True' },
    { id: 4, name: 'PostgreSQL метрики', description: null, value: 'Host=pg01;Port=5432;Database=metrics;Username=svc_metrics;Password=m3tr1cs' },
  ] as ConnRow[],
  apps: [] as AppProject[],
  keys: [] as KeyRow[],
  targets: new Map<number, TargetState>(),
  runs: new Map<string, { run: Run; log: string[] }>(),
  backups: new Map<number, Backup[]>(),
}

const apps: AppProject[] = [
  {
    id: 1, name: 'Сервис авторизации',
    projectPath: 'D:\\src\\AuthService\\AuthService.Api\\AuthService.Api.csproj',
    testPath: 'D:\\src\\AuthService\\AuthService.sln', publishArgs: '-r win-x64 --self-contained false',
    exclusions: ['logs'], keyPaths: ['Jwt:Key', 'Jwt:RefreshKey'],
    targets: [
      { id: 11, name: 'Test', targetPath: '\\\\srv-iis-test\\c$\\inetpub\\auth', healthUrl: 'http://srv-iis-test/auth/api/health', ignoreTlsErrors: false,
        bindings: [{ jsonPath: 'ConnectionStrings:DefaultConnection', connectionStringId: 2 }] },
      { id: 12, name: 'Prod', targetPath: '\\\\srv-iis01\\c$\\inetpub\\auth', healthUrl: 'https://srv-iis01/auth/api/health', ignoreTlsErrors: true,
        bindings: [{ jsonPath: 'ConnectionStrings:DefaultConnection', connectionStringId: 1 }] },
    ],
  },
  {
    id: 2, name: 'Каталог заказов',
    projectPath: 'D:\\src\\Orders\\Orders.Web\\Orders.Web.csproj',
    testPath: 'D:\\src\\Orders\\Orders.Tests\\Orders.Tests.csproj', publishArgs: null,
    exclusions: ['logs', 'wwwroot/uploads'], keyPaths: [],
    targets: [
      { id: 21, name: 'Prod', targetPath: '\\\\srv-iis01\\c$\\inetpub\\orders', healthUrl: 'http://srv-iis01/orders/api/health', ignoreTlsErrors: false,
        bindings: [{ jsonPath: 'ConnectionStrings:DefaultConnection', connectionStringId: 1 }, { jsonPath: 'ConnectionStrings:Metrics', connectionStringId: 4 }] },
    ],
  },
  {
    id: 3, name: 'Печать этикеток',
    projectPath: 'D:\\src\\LabelPrint\\LabelPrint.Api',
    testPath: null, publishArgs: null,
    exclusions: ['logs', 'templates', '*.log'], keyPaths: ['Api:Key'],
    targets: [
      { id: 31, name: 'Prod', targetPath: '\\\\srv-iis02\\c$\\inetpub\\label-print', healthUrl: 'http://srv-iis02/labels/api/health', ignoreTlsErrors: false,
        bindings: [{ jsonPath: 'ConnectionStrings:Queue', connectionStringId: 3 }] },
    ],
  },
  {
    id: 4, name: 'Учёт заявок',
    projectPath: 'D:\\src\\Requests\\Requests.Server\\Requests.Server.csproj',
    testPath: 'D:\\src\\Requests\\Requests.sln', publishArgs: null,
    exclusions: ['logs', 'attachments'], keyPaths: ['Jwt:Key'],
    targets: [
      { id: 41, name: 'Test', targetPath: '\\\\srv-iis-test\\c$\\inetpub\\requests', healthUrl: 'http://srv-iis-test/requests/api/health', ignoreTlsErrors: false,
        bindings: [{ jsonPath: 'ConnectionStrings:DefaultConnection', connectionStringId: 2 }] },
      { id: 42, name: 'Prod', targetPath: '\\\\srv-iis01\\c$\\inetpub\\requests', healthUrl: 'http://srv-iis01/requests/api/health', ignoreTlsErrors: false,
        bindings: [{ jsonPath: 'ConnectionStrings:DefaultConnection', connectionStringId: 1 }] },
    ],
  },
]
db.apps = apps

const testNames: Record<number, string[]> = {
  1: ['TokenServiceTests.Issue_ValidUser_ReturnsToken', 'TokenServiceTests.Issue_DisabledUser_Throws', 'TokenServiceTests.RefreshToken_Expired_Throws',
    'TokenServiceTests.RefreshToken_Valid_Rotates', 'AdLookupTests.FindUser_BySam_ReturnsUser', 'AdLookupTests.FindUser_Unknown_ReturnsNull',
    'AdLookupTests.Groups_NestedGroups_Flattened', 'CheckAccessTests.Allowed_WhenRoleMatches', 'CheckAccessTests.Denied_WhenNoRole',
    'CheckAccessTests.Denied_WhenResourceUnknown', 'CheckAccessTests.Cache_HitsSecondTime', 'GrpcContractTests.CheckAccess_MapsToRest',
    'GrpcContractTests.Errors_MapToStatusCodes', 'ConfigTests.JwtKey_TooShort_FailsOnStart'],
  2: ['OrderParserTests.Parse_ValidRow_ReturnsOrder', 'OrderParserTests.Parse_BadDate_Rejects', 'OrderLookupTests.ById_ReturnsOrder',
    'OrderLookupTests.ById_Unknown_ReturnsNull', 'PricingTests.Total_WithDiscount', 'PricingTests.Total_DbTimeout_Retries',
    'ExportTests.Csv_ContainsAllColumns', 'ExportTests.Csv_EmptyList_HeaderOnly',
    'HubTests.Broadcast_ToGroup', 'HubTests.Reconnect_RestoresGroup'],
  4: ['RequestTests.Create_Valid_Saves', 'RequestTests.Close_SetsClosedAt', 'RequestTests.Close_Twice_Throws',
    'AttachmentTests.Upload_TooLarge_Rejects', 'AttachmentTests.Upload_Duplicate_Ignored', 'SyncTests.Offline_QueueFlushedOnReconnect',
    'SyncTests.Conflict_ServerWins', 'ReportTests.Pdf_ContainsAttachments'],
}

for (const a of db.apps) for (const t of a.targets) {
  db.targets.set(t.id!, { alive: true, deployed: true, healthAt: ago(rand(1, 3)), healthMsg: `200 OK за ${rand(9, 60)} мс: Healthy`, checked: true })
}
db.targets.set(31, { alive: false, deployed: true, healthAt: ago(1), healthMsg: '503 Service Unavailable за 12 мс', checked: true })
db.targets.set(42, { alive: false, deployed: false, healthAt: ago(1), healthMsg: 'Подключение не установлено: целевой компьютер отверг запрос', checked: true })
db.targets.set(41, { alive: true, deployed: true, healthAt: ago(2), healthMsg: '200 OK за 31 мс: Healthy', checked: true })

db.keys.push(
  { id: 1, targetId: 11, jsonPath: 'Jwt:Key', value: randomKey(64), createdAt: ago(60 * 24 * 40) },
  { id: 2, targetId: 12, jsonPath: 'Jwt:Key', value: randomKey(64), createdAt: ago(60 * 24 * 38) },
  { id: 3, targetId: 12, jsonPath: 'Jwt:RefreshKey', value: randomKey(64), createdAt: ago(60 * 24 * 38) },
  { id: 4, targetId: 31, jsonPath: 'Api:Key', value: randomKey(64), createdAt: ago(60 * 24 * 12) },
  { id: 5, targetId: 41, jsonPath: 'Jwt:Key', value: randomKey(64), createdAt: ago(60 * 24 * 3) },
)

const mkBackups = (minsAgo: number[]) => minsAgo.map(m => { const d = new Date(Date.now() - m * 60_000); return { name: backupName(d), createdAt: d.toISOString() } })
db.backups.set(11, mkBackups([60 * 26, 60 * 24 * 3]))
db.backups.set(12, mkBackups([60 * 20, 60 * 24 * 2, 60 * 24 * 6, 60 * 24 * 9]))
db.backups.set(21, mkBackups([60 * 24 * 4, 60 * 24 * 11]))
db.backups.set(31, mkBackups([38, 60 * 24 * 5, 60 * 24 * 8]))
db.backups.set(41, mkBackups([60 * 50]))

// ───────────────────────── поиск ─────────────────────────

function findTarget(id: number) {
  for (const a of db.apps) for (const t of a.targets) if (t.id === id) return { app: a, target: t }
  return null
}

function lastRun(targetId: number) {
  let best: Run | null = null
  for (const { run } of db.runs.values())
    if (run.targetId === targetId && (!best || run.startedAt > best.startedAt)) best = run
  return best
}

let current: { run: Run; log: string[]; cancel: boolean } | null = null

// ───────────────────────── симуляция запуска ─────────────────────────

const stageDefs = {
  Deploy: [['tests', 'Тесты'], ['publish', 'Публикация'], ['config', 'Конфиги'], ['backup', 'Бэкап'], ['copy', 'Копирование'], ['health', 'Health-check']],
  Rollback: [['copy', 'Восстановление'], ['health', 'Health-check']],
} as const

function newRun(app: AppProject, targetId: number, targetName: string, kind: 'Deploy' | 'Rollback'): Run {
  return {
    id: uuid(), targetId, appId: app.id!, appName: app.name, targetName, kind,
    status: 'Running', startedAt: now().toISOString(), finishedAt: null, error: null,
    canCancel: kind === 'Deploy', canRollback: false,
    stages: stageDefs[kind].map(([key, title]) => ({ key, title, status: 'pending', detail: null, startedAt: null, finishedAt: null } as Stage)),
    tests: null, changes: [], mirror: null, backupName: null, restoredFrom: null, health: null,
  }
}

class Cancelled extends Error {}

function makeRunner(entry: { run: Run; log: string[]; cancel: boolean }) {
  const { run } = entry
  let pending: string[] = []
  const flush = () => { if (pending.length) { bus.emit('runLog', run.id, pending); pending = [] } }
  const timer = setInterval(flush, 120)

  const log = (line: string) => { const l = `[${stamp()}] ${line}`; entry.log.push(l); pending.push(l) }
  const update = () => bus.emit('runUpdated', structuredClone(run))
  const stage = (key: string) => run.stages.find(s => s.key === key)!
  const sleep = async (ms: number) => {
    await wait(ms)
    if (entry.cancel && run.canCancel) throw new Cancelled()
  }
  const begin = (key: string) => {
    const s = stage(key); s.status = 'running'; s.startedAt = now().toISOString(); log(`── ${s.title} ──`); update()
  }
  const end = (key: string, status: Stage['status'], detail: string | null) => {
    const s = stage(key); s.status = status; s.detail = detail; s.finishedAt = now().toISOString()
    const mark = status === 'ok' ? '✔' : status === 'failed' ? '✖' : '·'
    log(`${mark} ${s.title}${detail ? ': ' + detail : ''}`); update()
  }
  const lines = async (ls: string[], gap = [40, 140]) => { for (const l of ls) { log(l); await sleep(rand(gap[0], gap[1])) } }
  const finish = (status: RunStatus, error: string | null = null) => {
    run.status = status
    run.error = error
    run.finishedAt = now().toISOString()
    run.canCancel = false
    for (const s of run.stages) if (s.status === 'pending') { s.status = 'skipped'; s.detail = 'не дошли' }
    const copy = run.stages.find(s => s.key === 'copy')
    run.canRollback = !!copy && (copy.status === 'ok' || copy.status === 'failed') && (db.backups.get(run.targetId)?.length ?? 0) > 0
    const ru: Record<string, string> = { Succeeded: 'успешно', TestsFailed: 'упали тесты', HealthFailed: 'health не прошёл', Cancelled: 'отменено', Failed: 'ошибка' }
    const dur = (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
    log(`=== Итог: ${ru[status]} за ${dur.toFixed(1)} с ===`)
    flush(); clearInterval(timer); update()
    current = null
  }
  return { log, update, sleep, begin, end, lines, finish, flush }
}

function setHealth(targetId: number, alive: boolean, msg: string) {
  const st = db.targets.get(targetId)!
  st.alive = alive; st.healthMsg = msg; st.healthAt = now().toISOString(); st.checked = true
  bus.emit('healthUpdated', targetId, alive, msg, st.healthAt)
}

async function healthStage(r: ReturnType<typeof makeRunner>, run: Run, url: string | null, targetId: number, willFail: boolean) {
  if (!url) { r.end('health', 'skipped', 'URL не указан'); return r.finish('Succeeded') }
  r.begin('health')
  if (willFail) {
    const errs = ['503 Service Unavailable за 9 мс', '502.5 ANCM Out-Of-Process Startup Failure за 14 мс', '503 Service Unavailable за 7 мс', '500.30 ASP.NET Core app failed to start за 11 мс']
    for (let i = 0; i < 5; i++) { r.log(`  health #${i + 1}: нет — ${errs[i % errs.length]}`); await wait(650) }
    const msg = `не поднялось за ${db.settings.healthTimeoutSec} с. Последний ответ: 500.30 ASP.NET Core app failed to start`
    run.health = { ok: false, message: msg }
    setHealth(targetId, false, msg)
    r.end('health', 'failed', msg)
    return r.finish('HealthFailed', `Health-check не прошёл: ${msg}`)
  }
  r.log('  health #1: нет — 503 Service Unavailable за 6 мс')
  await wait(900)
  const msg = `200 OK за ${rand(140, 900)} мс: Healthy`
  r.log(`  health #2: OK — ${msg}`)
  run.health = { ok: true, message: msg }
  setHealth(targetId, true, msg)
  r.end('health', 'ok', msg)
  r.finish('Succeeded')
}

function shortName(app: AppProject) {
  const p = app.projectPath.split('\\').pop() ?? 'App'
  return p.replace(/\.csproj$/i, '')
}

function makeTests(appId: number, failing: boolean): TestSummary {
  const names = testNames[appId] ?? ['SmokeTests.Starts']
  const ns = appId === 1 ? 'AuthService.Tests' : appId === 2 ? 'Orders.Tests' : appId === 4 ? 'Requests.Tests' : 'App.Tests'
  const failIdx = failing ? new Set([Math.min(2, names.length - 1), ...(names.length > 8 ? [5] : [])]) : new Set<number>()
  const tests: TestCase[] = names.map((n, i) => {
    const failed = failIdx.has(i)
    return {
      name: `${ns}.${n}`, outcome: i === names.length - 1 && appId === 1 ? 'NotExecuted' : failed ? 'Failed' : 'Passed',
      durationMs: rand(1, 380), source: ns.toLowerCase(),
      message: failed ? (i === 2 && appId === 1
        ? 'Assert.Throws() Failure: No exception was thrown\nExpected: typeof(Microsoft.IdentityModel.Tokens.SecurityTokenExpiredException)'
        : 'Assert.Equal() Failure: Values differ\nExpected: 3\nActual:   2') : null,
      stackTrace: failed
        ? `   at ${ns}.${n.split('.')[0]}.${n.split('.')[1]}() in D:\\src\\${ns.split('.')[0]}\\${ns}\\${n.split('.')[0]}.cs:line ${rand(20, 140)}\n   at System.RuntimeMethodHandle.InvokeMethod(Object target, Void** arguments, Signature sig, Boolean isConstructor)\n   at System.Reflection.MethodBaseInvoker.InvokeWithNoArgs(Object obj, BindingFlags invokeAttr)`
        : null,
    }
  })
  const passed = tests.filter(t => t.outcome === 'Passed').length
  const failedN = tests.filter(t => t.outcome === 'Failed').length
  const ordered = [...tests].sort((a, b) => (a.outcome === 'Passed' ? 2 : a.outcome === 'NotExecuted' ? 1 : 0) - (b.outcome === 'Passed' ? 2 : b.outcome === 'NotExecuted' ? 1 : 0))
  return { total: tests.length, passed, failed: failedN, skipped: tests.length - passed - failedN, tests: ordered }
}

async function simulateDeploy(entry: { run: Run; log: string[]; cancel: boolean }, app: AppProject, targetId: number) {
  const { run } = entry
  const r = makeRunner(entry)
  const { target } = findTarget(targetId)!
  const scenario = demo.get()
  const work = `C:\\Users\\user\\AppData\\Local\\DeployDock\\work\\${run.id.replace(/-/g, '').slice(0, 32)}`
  const name = shortName(app)
  const solutionDir = app.projectPath.split('\\').slice(0, 3).join('\\')
  const state = db.targets.get(targetId)!

  try {
    r.log(`=== Деплой ${app.name} / ${target.name} — ${now().toLocaleString('ru-RU')} ===`)
    await r.sleep(200)

    // 1. Тесты
    if (!app.testPath) {
      r.end('tests', 'skipped', 'тестовый проект не указан')
    } else {
      r.begin('tests')
      const tests = makeTests(app.id!, scenario === 'tests')
      const ns = tests.tests[0]?.source ?? 'app.tests'
      await r.lines([
        `> dotnet test ${app.testPath} -c Release --logger trx --results-directory ${work}\\tests`,
        '  Determining projects to restore...',
        '  All projects are up-to-date for restore.',
      ])
      await r.sleep(500)
      await r.lines([
        `  ${name.split('.')[0]}.Core -> ${solutionDir}\\${name.split('.')[0]}.Core\\bin\\Release\\net9.0\\${name.split('.')[0]}.Core.dll`,
        `  ${name} -> ${solutionDir}\\${name}\\bin\\Release\\net9.0\\${name}.dll`,
        `  ${ns} -> ${solutionDir}\\${ns}\\bin\\Release\\net9.0\\${ns}.dll`,
        `Test run for ${solutionDir}\\${ns}\\bin\\Release\\net9.0\\${ns}.dll (.NETCoreApp,Version=v9.0)`,
        'VSTest version 17.14.1 (x64)',
        '',
        'Starting test execution, please wait...',
        'A total of 1 test files matched the specified pattern.',
      ], [80, 260])
      await r.sleep(900)
      for (const t of tests.tests.filter(x => x.outcome === 'Failed')) {
        await r.lines([
          `[xUnit.net 00:00:0${rand(1, 4)}.${rand(10, 99)}]     ${t.name} [FAIL]`,
          `  Failed ${t.name} [${Math.round(t.durationMs)} ms]`,
          '  Error Message:',
          ...(t.message ?? '').split('\n').map(l => '   ' + l),
          '  Stack Trace:',
          ...(t.stackTrace ?? '').split('\n').map(l => '  ' + l),
        ], [30, 90])
      }
      const skipped = tests.skipped
      r.log(`${tests.failed ? 'Failed!' : 'Passed!'}  - Failed: ${String(tests.failed).padStart(5)}, Passed: ${String(tests.passed).padStart(5)}, Skipped: ${String(skipped).padStart(5)}, Total: ${String(tests.total).padStart(5)}, Duration: ${rand(1, 4)} s - ${ns}.dll (net9.0)`)
      run.tests = tests
      if (tests.failed) {
        r.end('tests', 'failed', `упало ${tests.failed} из ${tests.total}`)
        return r.finish('TestsFailed', `Тесты: упало ${tests.failed} из ${tests.total}. Публикация отменена.`)
      }
      r.end('tests', 'ok', `${tests.passed} пройдено${skipped ? `, ${skipped} пропущено` : ''}`)
    }

    // 2. Публикация
    r.begin('publish')
    await r.lines([
      `> dotnet publish ${app.projectPath} -c Release -o ${work}\\publish${app.publishArgs ? ' ' + app.publishArgs : ''}`,
      '  Determining projects to restore...',
      '  All projects are up-to-date for restore.',
    ])
    await r.sleep(1100)
    await r.lines([
      `  ${name} -> ${solutionDir}\\${name}\\bin\\Release\\net9.0\\win-x64\\${name}.dll`,
      `  ${name} -> ${work}\\publish\\`,
    ], [200, 400])
    const files = rand(38, 96)
    r.end('publish', 'ok', `${files} файлов`)

    // 3. Конфиги — дальше отменять уже не дадим, но до копирования ещё можно
    r.begin('config')
    await r.sleep(400)
    const changes: ConfigChange[] = []
    for (const b of target.bindings) {
      const c = db.connections.find(x => x.id === b.connectionStringId)
      changes.push({ file: 'appsettings.json', path: b.jsonPath, action: 'replace', detail: `строка подключения «${c?.name ?? '?'}»`, level: 'info' })
      if (b.jsonPath.endsWith('DefaultConnection'))
        changes.push({ file: 'appsettings.Production.json', path: b.jsonPath, action: 'replace', detail: `строка подключения «${c?.name ?? '?'}»`, level: 'info' })
    }
    for (const p of app.keyPaths) {
      let k = db.keys.find(x => x.targetId === targetId && x.jsonPath.toLowerCase() === p.toLowerCase())
      if (!k) {
        k = { id: ++db.seq, targetId, jsonPath: p, value: randomKey(db.settings.keyBytes), createdAt: now().toISOString() }
        db.keys.push(k)
        r.log(`  сгенерирован новый ключ для ${p} (окружение ${target.name}) — дальше будет использоваться он же`)
      }
      changes.push({ file: 'appsettings.json', path: p, action: 'replace', detail: 'dev-ключ заменён на боевой', level: 'info' })
    }
    if (app.id === 1) changes.push({ file: 'appsettings.json', path: 'Ldap:BindPassword', action: 'skip', detail: 'не dev-значение — оставил как есть', level: 'info' })
    for (const c of changes) r.log(`  [${c.action}] ${c.file} → ${c.path}: ${c.detail}`)
    run.changes = changes
    const repl = changes.filter(c => c.action === 'replace').length
    r.end('config', 'ok', `${repl} замен`)

    // 4. Бэкап
    await r.sleep(300)
    if (state.deployed) {
      r.begin('backup')
      await r.sleep(900)
      const d = now()
      const b = { name: backupName(d), createdAt: d.toISOString() }
      const list = [b, ...(db.backups.get(targetId) ?? [])]
      const pruned = Math.max(0, list.length - db.settings.backupsToKeep)
      db.backups.set(targetId, list.slice(0, db.settings.backupsToKeep))
      run.backupName = b.name
      r.end('backup', 'ok', `${files - rand(0, 3)} файлов → ${b.name}${pruned ? `, старых удалено: ${pruned}` : ''}`)
    } else {
      r.end('backup', 'skipped', 'целевая папка пустая — первый деплой')
    }

    // 5. Копирование
    run.canCancel = false
    r.begin('copy')
    r.log(`app_offline.htm положен, жду ${db.settings.offlineDelaySec} с, пока IIS отпустит файлы`)
    await wait(1400)
    if (scenario === 'copy') {
      const f = `${target.targetPath}\\${name}.dll`
      for (let i = 1; i <= 9; i += 3) { r.log(`  ! копирование ${name}.dll: The process cannot access the file '${f}' because it is being used by another process. — жду и пробую ещё (${i}/10)`); await wait(500) }
      const err = `The process cannot access the file '${f}' because it is being used by another process.`
      run.mirror = { copied: rand(3, 12), unchanged: 0, deleted: 0, excluded: 0 }
      r.end('copy', 'failed', err)
      state.alive = false
      setHealth(targetId, false, 'Приложение в режиме app_offline')
      return r.finish('Failed', `Копирование упало: ${err} Сайт оставлен в режиме app_offline — жми «Откатить» или задеплой заново.`)
    }
    const copied = state.deployed ? rand(4, 14) : files
    const deleted = state.deployed ? rand(0, 3) : 0
    if (deleted) for (let i = 0; i < deleted; i++) r.log(`  - удалён ${['Newtonsoft.Json.dll', 'runtimes/win/lib/net8.0/System.Diagnostics.EventLog.dll', 'appsettings.Staging.json'][i]}`)
    run.mirror = { copied, unchanged: files - copied, deleted, excluded: app.exclusions.length ? rand(1, 4) : 0 }
    r.log('app_offline.htm убран')
    r.end('copy', 'ok', `скопировано ${copied}, без изменений ${files - copied}, удалено ${deleted}${run.mirror.excluded ? `, исключено ${run.mirror.excluded}` : ''}`)
    state.deployed = true

    // 6. Health
    await healthStage(r, run, target.healthUrl, targetId, scenario === 'health')
  } catch (e) {
    if (e instanceof Cancelled) {
      for (const s of run.stages) if (s.status === 'running') { s.status = 'skipped'; s.detail = 'отменено' }
      r.log('✖ Отменено')
      r.finish('Cancelled', 'Отменено вручную')
    } else {
      r.log(`✖ ${(e as Error).message}`)
      r.finish('Failed', (e as Error).message)
    }
  }
}

async function simulateRollback(entry: { run: Run; log: string[]; cancel: boolean }, app: AppProject, targetId: number, backup: string) {
  const { run } = entry
  const r = makeRunner(entry)
  const { target } = findTarget(targetId)!
  r.log(`=== Откат ${app.name} / ${target.name} — ${now().toLocaleString('ru-RU')} ===`)
  r.log(`Восстанавливаю версию из бэкапа ${backup}`)
  r.begin('copy')
  r.log(`app_offline.htm положен, жду ${db.settings.offlineDelaySec} с, пока IIS отпустит файлы`)
  await wait(1500)
  const copied = rand(4, 14)
  run.mirror = { copied, unchanged: rand(30, 70), deleted: rand(0, 2), excluded: rand(1, 3) }
  r.log('app_offline.htm убран')
  r.end('copy', 'ok', `скопировано ${copied}, без изменений ${run.mirror.unchanged}, удалено ${run.mirror.deleted}`)
  db.targets.get(targetId)!.deployed = true
  await healthStage(r, run, target.healthUrl, targetId, false)
}

// ───────────────────────── история для красоты ─────────────────────────

function seedRun(app: AppProject, targetId: number, status: RunStatus, minsAgo: number, opts: { tests?: boolean } = {}) {
  const t = findTarget(targetId)!.target
  const run = newRun(app, targetId, t.name, 'Deploy')
  const start = new Date(Date.now() - minsAgo * 60_000)
  run.startedAt = start.toISOString()
  run.finishedAt = new Date(start.getTime() + rand(40, 95) * 1000).toISOString()
  run.status = status
  run.canCancel = false
  const set = (key: string, s: Stage['status'], d: string | null) => { const x = run.stages.find(y => y.key === key)!; x.status = s; x.detail = d }
  const log: string[] = [`[${stamp(start)}] === Деплой ${app.name} / ${t.name} — ${start.toLocaleString('ru-RU')} ===`]
  if (status === 'TestsFailed') {
    run.tests = makeTests(app.id!, true)
    set('tests', 'failed', `упало ${run.tests.failed} из ${run.tests.total}`)
    for (const k of ['publish', 'config', 'backup', 'copy', 'health']) set(k, 'skipped', 'не дошли')
    run.error = `Тесты: упало ${run.tests.failed} из ${run.tests.total}. Публикация отменена.`
    log.push(`[${stamp(start)}] ── Тесты ──`, `[${stamp(start)}] ✖ Тесты: упало ${run.tests.failed} из ${run.tests.total}`, `[${stamp(start)}] === Итог: упали тесты ===`)
  } else {
    if (opts.tests && app.testPath) { run.tests = makeTests(app.id!, false); set('tests', 'ok', `${run.tests.passed} пройдено`) }
    else set('tests', 'skipped', 'тестовый проект не указан')
    set('publish', 'ok', '64 файла')
    set('config', 'ok', `${t.bindings.length + app.keyPaths.length} замен`)
    const b = db.backups.get(targetId)?.[0]
    set('backup', 'ok', `61 файл → ${b?.name ?? ''}`)
    run.backupName = b?.name ?? null
    set('copy', 'ok', 'скопировано 7, без изменений 57, удалено 1')
    run.mirror = { copied: 7, unchanged: 57, deleted: 1, excluded: 2 }
    if (status === 'HealthFailed') {
      const msg = `не поднялось за 60 с. Последний ответ: 503 Service Unavailable`
      set('health', 'failed', msg); run.health = { ok: false, message: msg }; run.error = `Health-check не прошёл: ${msg}`
    } else { set('health', 'ok', '200 OK за 412 мс: Healthy'); run.health = { ok: true, message: '200 OK за 412 мс: Healthy' } }
    run.canRollback = true
    log.push(`[${stamp(start)}] … (лог старого запуска сокращён в демо)`, `[${stamp(start)}] === Итог: ${status === 'HealthFailed' ? 'health не прошёл' : 'успешно'} ===`)
  }
  db.runs.set(run.id, { run, log })
}
seedRun(apps[0], 12, 'Succeeded', 60 * 20, { tests: true })
seedRun(apps[0], 11, 'Succeeded', 60 * 26, { tests: true })
seedRun(apps[1], 21, 'TestsFailed', 47)
seedRun(apps[2], 31, 'HealthFailed', 38)
seedRun(apps[3], 41, 'Succeeded', 60 * 50, { tests: true })

// ───────────────────────── сам API ─────────────────────────

const appDto = (a: AppProject): AppProject => ({
  ...a,
  targets: a.targets.map(t => {
    const st = db.targets.get(t.id!)
    return { ...t, lastHealthOk: st?.checked ? st.alive : null, lastHealthAt: st?.healthAt ?? null, lastHealthMessage: st?.healthMsg ?? null }
  }),
})

function startRun(app: AppProject, targetId: number, kind: 'Deploy' | 'Rollback', backup?: string) {
  if (current) throw new MockError(`Уже идёт ${current.run.kind === 'Rollback' ? 'откат' : 'деплой'} «${current.run.appName} / ${current.run.targetName}». Дождись окончания.`)
  const t = findTarget(targetId)!.target
  const run = newRun(app, targetId, t.name, kind)
  if (backup) run.restoredFrom = backup
  const entry = { run, log: [] as string[], cancel: false }
  db.runs.set(run.id, entry)
  current = entry
  setTimeout(() => {
    bus.emit('runUpdated', structuredClone(run))
    if (kind === 'Deploy') simulateDeploy(entry, app, targetId)
    else simulateRollback(entry, app, targetId, backup!)
  }, 50)
  return run.id
}

export const mockApi = {
  dashboard: (): Promise<DashboardApp[]> => net(
    [...db.apps].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(a => ({
      id: a.id!, name: a.name, projectPath: a.projectPath, hasTests: !!a.testPath,
      targets: a.targets.map(t => {
        const st = db.targets.get(t.id!)!
        const lr = lastRun(t.id!)
        return {
          id: t.id!, name: t.name, targetPath: t.targetPath, healthUrl: t.healthUrl,
          lastHealthOk: t.healthUrl && st.checked ? st.alive : null, lastHealthAt: st.healthAt, lastHealthMessage: st.healthMsg,
          lastRun: lr ? { id: lr.id, kind: lr.kind, status: lr.status, startedAt: lr.startedAt, finishedAt: lr.finishedAt, error: lr.error } : null,
          backupCount: db.backups.get(t.id!)?.length ?? 0,
          busy: current?.run.targetId === t.id,
        }
      }),
    })), 80),

  apps: () => net(db.apps.map(appDto)),
  app: (id: number) => {
    const a = db.apps.find(x => x.id === id)
    return a ? net(appDto(a)) : fail('Приложение не найдено')
  },
  createApp: (a: AppProject) => {
    const err = validate(a); if (err) return fail(err)
    const created: AppProject = { ...structuredClone(a), id: ++db.seq, targets: a.targets.map(t => ({ ...t, id: ++db.seq })) }
    for (const t of created.targets) db.targets.set(t.id!, { alive: false, deployed: false, healthAt: null, healthMsg: null, checked: false })
    db.apps.push(created)
    return net(appDto(created), 300)
  },
  updateApp: (id: number, a: AppProject) => {
    const err = validate(a); if (err) return fail(err)
    const i = db.apps.findIndex(x => x.id === id)
    if (i < 0) return fail('Приложение не найдено')
    if (current && db.apps[i].targets.some(t => t.id === current!.run.targetId)) return fail('Сейчас идёт деплой этого приложения — подожди.')
    const updated: AppProject = { ...structuredClone(a), id, targets: a.targets.map(t => ({ ...t, id: t.id ?? ++db.seq })) }
    for (const t of updated.targets) if (!db.targets.has(t.id!)) db.targets.set(t.id!, { alive: false, deployed: false, healthAt: null, healthMsg: null, checked: false })
    db.apps[i] = updated
    return net(appDto(updated), 300)
  },
  deleteApp: (id: number) => { db.apps = db.apps.filter(a => a.id !== id); return net(undefined as void, 200) },

  connections: (): Promise<Connection[]> => net([...db.connections].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(c => ({
    id: c.id, name: c.name, description: c.description, maskedValue: mask(c.value),
    usedBy: db.apps.flatMap(a => a.targets.filter(t => t.bindings.some(b => b.connectionStringId === c.id)).map(t => `${a.name} / ${t.name}`)),
  }))),
  connectionValue: (id: number) => { const c = db.connections.find(x => x.id === id); return c ? net({ value: c.value }, 60) : fail('Не найдено') },
  createConnection: (c: { name: string; description: string | null; value: string }) => {
    if (!c.name.trim() || !c.value.trim()) return fail('Нужны название и строка подключения.')
    const id = ++db.seq
    db.connections.push({ id, name: c.name.trim(), description: c.description, value: c.value.trim() })
    return net({ id }, 250)
  },
  updateConnection: (id: number, c: { name: string; description: string | null; value: string | null }) => {
    const row = db.connections.find(x => x.id === id)
    if (!row) return fail('Не найдено')
    row.name = c.name.trim(); row.description = c.description
    if (c.value?.trim()) row.value = c.value.trim()
    return net({ id }, 250)
  },
  deleteConnection: (id: number) => {
    if (db.apps.some(a => a.targets.some(t => t.bindings.some(b => b.connectionStringId === id))))
      return fail('Строка используется в окружениях — сначала отвяжи её.')
    db.connections = db.connections.filter(c => c.id !== id)
    return net(undefined as void, 200)
  },

  generateKey: (bytes: number, format: string) => net({ value: randomKey(bytes, format) }, 30),
  targetKeys: (targetId: number): Promise<SigningKey[]> => net(db.keys.filter(k => k.targetId === targetId)
    .sort((a, b) => a.jsonPath.localeCompare(b.jsonPath))
    .map(k => ({ id: k.id, jsonPath: k.jsonPath, masked: mask(k.value), createdAt: k.createdAt }))),
  keyValue: (id: number) => { const k = db.keys.find(x => x.id === id); return k ? net({ value: k.value }, 60) : fail('Не найдено') },
  regenerateKey: (targetId: number, jsonPath: string) => {
    let k = db.keys.find(x => x.targetId === targetId && x.jsonPath === jsonPath)
    if (!k) { k = { id: ++db.seq, targetId, jsonPath, value: '', createdAt: '' }; db.keys.push(k) }
    k.value = randomKey(db.settings.keyBytes); k.createdAt = now().toISOString()
    return net({ id: k.id }, 200)
  },
  deleteKey: (id: number) => { db.keys = db.keys.filter(k => k.id !== id); return net(undefined as void) },

  deploy: async (targetId: number) => {
    await wait(150)
    const f = findTarget(targetId)
    if (!f) throw new MockError('Окружение не найдено')
    return { id: startRun(f.app, targetId, 'Deploy') }
  },
  rollback: async (targetId: number, backup?: string) => {
    await wait(150)
    const f = findTarget(targetId)
    if (!f) throw new MockError('Окружение не найдено')
    const list = db.backups.get(targetId) ?? []
    const b = backup ? list.find(x => x.name === backup) : list[0]
    if (!b) throw new MockError('Бэкапов для отката нет.')
    return { id: startRun(f.app, targetId, 'Rollback', b.name) }
  },
  backups: (targetId: number) => net(db.backups.get(targetId) ?? []),
  checkHealth: async (targetId: number) => {
    await wait(rand(200, 600))
    const st = db.targets.get(targetId)!
    const msg = st.alive ? `200 OK за ${rand(8, 70)} мс: Healthy` : st.deployed ? '503 Service Unavailable за 11 мс' : 'Подключение не установлено: целевой компьютер отверг запрос'
    setHealth(targetId, st.alive, msg)
    return { ok: st.alive, message: msg }
  },
  checkAllHealth: async () => {
    await wait(700)
    for (const a of db.apps) for (const t of a.targets) {
      if (!t.healthUrl || current?.run.targetId === t.id) continue
      const st = db.targets.get(t.id!)!
      setHealth(t.id!, st.alive, st.alive ? `200 OK за ${rand(8, 70)} мс: Healthy` : st.healthMsg ?? 'нет ответа')
    }
  },

  run: (id: string) => {
    const e = db.runs.get(id)
    return e ? net({ run: e.run, log: [...e.log] }, 60) : fail('Запуск не найден')
  },
  cancelRun: async (id: string) => {
    await wait(80)
    if (current?.run.id !== id || !current.run.canCancel) throw new MockError('Этот запуск уже нельзя отменить.')
    current.cancel = true
  },

  settings: () => net(db.settings),
  saveSettings: (s: Settings) => {
    db.settings = {
      backupsToKeep: Math.min(50, Math.max(1, s.backupsToKeep)),
      healthTimeoutSec: Math.min(600, Math.max(5, s.healthTimeoutSec)),
      offlineDelaySec: Math.min(60, Math.max(0, s.offlineDelaySec)),
      keyBytes: Math.min(256, Math.max(32, s.keyBytes)),
    }
    return net(db.settings, 200)
  },
  info: () => net({ dataDir: 'C:\\Users\\user\\AppData\\Local\\DeployDock', version: '1.1.0-demo' }),

  checkPaths: (paths: string[]) => net(paths.map(p => ({
    path: p,
    kind: !p.trim() ? 'empty'
      : /\.(csproj|sln)$/i.test(p.trim()) ? 'file'
      : /^([A-Za-z]:\\|\\\\)/.test(p.trim()) && !/old|tmp/i.test(p) ? 'dir'
      : 'missing',
  })), 150),
}

function validate(a: AppProject): string | null {
  if (!a.name.trim()) return 'Нужно название приложения.'
  if (!a.projectPath.trim()) return 'Нужен путь к проекту (.csproj или папка).'
  if (!a.targets.length) return 'Добавь хотя бы одно окружение.'
  for (const t of a.targets) {
    if (!t.name.trim()) return 'У окружения нет названия.'
    if (!t.targetPath.trim()) return `У окружения «${t.name}» нет целевой папки.`
  }
  const names = a.targets.map(t => t.name.trim().toLowerCase())
  if (new Set(names).size !== names.length) return 'Названия окружений должны быть разными.'
  return null
}
