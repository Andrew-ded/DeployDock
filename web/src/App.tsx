import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { isMock } from './api'
import { desktop } from './desktop'
import { useLive } from './live'
import Dashboard from './pages/Dashboard'
import AppEditor from './pages/AppEditor'
import Connections from './pages/Connections'
import Keys from './pages/Keys'
import RunPage from './pages/RunPage'
import SettingsPage from './pages/SettingsPage'
import { Chip, Segmented } from './components/ui'
import { DemoPanel } from './components/DemoPanel'

const sections = [
  { value: '/', label: 'Приложения' },
  { value: '/connections', label: 'Строки подключения' },
  { value: '/keys', label: 'Ключи подписи' },
  { value: '/settings', label: 'Настройки' },
]

export default function App() {
  const { connected } = useLive()
  const loc = useLocation()
  const nav = useNavigate()
  const active = sections.find(s => s.value !== '/' && loc.pathname.startsWith(s.value))?.value ?? '/'

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="brand"><span className="brand-mark"><i /></span>DeployDock</Link>
          <Segmented label="Разделы" options={sections} value={active} onChange={v => nav(v)} />
          <span className="spacer" />
          {isMock
            ? <Chip tone="warn" title="Данные выдуманы и живут только в этой вкладке">демо на моках</Chip>
            : desktop
              ? (!connected && <Chip tone="warn">переподключаюсь</Chip>)
              : <Chip tone={connected ? 'ok' : 'warn'}>{connected ? 'на связи' : 'переподключаюсь'}</Chip>}
        </div>
      </header>
      <main className="main">
        <Routes location={loc} key={loc.pathname}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/apps/new" element={<AppEditor />} />
          <Route path="/apps/:id" element={<AppEditor />} />
          <Route path="/runs/:id" element={<RunPage />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/keys" element={<Keys />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<div className="page"><div className="page-head"><h1>Такой страницы нет</h1></div></div>} />
        </Routes>
      </main>
      {isMock && <DemoPanel />}
    </>
  )
}
