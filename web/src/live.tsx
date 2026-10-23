import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import { isMock } from './api'
import { bus } from './mock/bus'

type Handler = (...args: any[]) => void
type Live = { on: (event: string, h: Handler) => () => void; connected: boolean }

const Ctx = createContext<Live>({ on: () => () => {}, connected: false })

/** Одно SignalR-подключение на всё приложение: лог деплоя, смена этапов, health. В демо — шина в памяти. */
export function LiveProvider({ children }: { children: ReactNode }) {
  if (isMock) return <Ctx.Provider value={{ on: bus.on, connected: true }}>{children}</Ctx.Provider>
  return <SignalRProvider>{children}</SignalRProvider>
}

function SignalRProvider({ children }: { children: ReactNode }) {
  const conn = useRef<HubConnection | null>(null)
  const [connected, setConnected] = useState(false)

  if (!conn.current) {
    conn.current = new HubConnectionBuilder()
      .withUrl('/hubs/deploy')
      .withAutomaticReconnect([0, 1000, 2000, 5000, 5000, 10000])
      .configureLogging(LogLevel.Warning)
      .build()
  }

  useEffect(() => {
    const c = conn.current!
    c.onreconnecting(() => setConnected(false))
    c.onreconnected(() => setConnected(true))
    c.onclose(() => setConnected(false))
    let stopped = false
    const start = async () => {
      if (stopped || c.state !== HubConnectionState.Disconnected) return
      try {
        await c.start()
        setConnected(true)
      } catch {
        setTimeout(start, 3000)
      }
    }
    start()
    return () => { stopped = true }
  }, [])

  const on = (event: string, h: Handler) => {
    conn.current!.on(event, h)
    return () => conn.current!.off(event, h)
  }

  return <Ctx.Provider value={{ on, connected }}>{children}</Ctx.Provider>
}

export function useLive() {
  return useContext(Ctx)
}

/** Подписка на событие хаба на время жизни компонента. */
export function useLiveEvent(event: string, handler: Handler) {
  const live = useLive()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => live.on(event, (...a) => ref.current(...a)), [event])
}
