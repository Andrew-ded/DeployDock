// Сборка DeployDock под Windows x64 (работает и на Linux, без Wine):
//   1) backend собран заранее в build/backend (см. README → «Сборка»)
//   2) @electron/packager кладёт Electron + наш main/preload и backend в resources
//   3) resedit вшивает иконку и версию в DeployDock.exe
const path = require('node:path')
const fs = require('node:fs')
const { packager } = require('@electron/packager')
const ResEdit = require('resedit')

const root = path.join(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const backend = path.join(__dirname, 'backend')
const out = path.join(__dirname, 'out')

async function main() {
  if (!fs.existsSync(path.join(backend, 'DeployDock.Server.exe')))
    throw new Error(`Нет собранного бэкенда в ${backend}`)

  const [appDir] = await packager({
    dir: root,
    name: 'DeployDock',
    executableName: 'DeployDock',
    platform: 'win32',
    arch: 'x64',
    out,
    overwrite: true,
    asar: true,
    prune: true,
    appVersion: pkg.version,
    extraResource: [backend],
    ignore: [/^\/node_modules($|\/)/, /^\/build($|\/)/, /^\/data($|\/)/, /^\/out($|\/)/, /\.map$/],
  })

  patchExe(path.join(appDir, 'DeployDock.exe'), pkg.version)
  fs.writeFileSync(path.join(appDir, 'README.txt'), readme(pkg.version))
  // служебный файл с версией Electron пользователю не нужен; LICENSES.chromium.html оставляем — её положено распространять
  fs.rmSync(path.join(appDir, 'version'), { force: true })
  console.log(appDir)
}

function patchExe(exePath, version) {
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath))
  const res = ResEdit.NtExecutableResource.from(exe)

  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')))
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, 1, 1033, ico.icons.map(i => i.data))

  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries)
  const [a, b, c] = version.split('.').map(Number)
  vi.setFileVersion(a, b, c, 0, 1033)
  vi.setProductVersion(a, b, c, 0, 1033)
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'DeployDock',
    ProductName: 'DeployDock',
    CompanyName: 'Andrew-ded',
    LegalCopyright: 'MIT License',
    OriginalFilename: 'DeployDock.exe',
    InternalName: 'DeployDock',
    FileVersion: version,
    ProductVersion: version,
  })
  vi.outputToResourceEntries(res.entries)

  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
}

function readme(version) {
  return `DeployDock ${version}

Запуск: DeployDock.exe. Нужен .NET 9 (Runtime или SDK).

Все данные лежат в папке data рядом с DeployDock.exe (создаётся при первом запуске):
  data\\deploydock.db   приложения, окружения, справочник строк, ключи подписи
  data\\deploydock.key  ключ, которым зашифрованы строки подключения и ключи подписи
  data\\backups         бэкапы для отката
  data\\logs            логи

Перенести на другой ПК или обновить версию: скопируй deploydock.db и deploydock.key
в папку data новой копии. Без .key строки подключения и ключи не расшифруются.

Переход с версии 1.x: при первом запуске база и бэкапы из %LOCALAPPDATA%\\DeployDock
подхватятся сами и перешифруются новым ключом.
`
}

main().catch(e => { console.error(e); process.exit(1) })
