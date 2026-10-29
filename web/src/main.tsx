import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import './styles.css'
import App from './App'
import Tablet from './pages/Tablet'
import { isTablet } from './desktop'
import { isMock } from './api'
import { LiveProvider } from './live'
import { ToastProvider } from './components/ui'

// В демо адресная строка не наша (страница живёт внутри просмотрщика), поэтому роутинг в памяти.
const Router = isMock ? MemoryRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <LiveProvider>
        <ToastProvider>
          {isTablet ? <Tablet /> : <App />}
        </ToastProvider>
      </LiveProvider>
    </Router>
  </StrictMode>,
)
