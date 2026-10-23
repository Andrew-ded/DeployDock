import { useEffect, useState } from 'react'
import { bus, demo, type Scenario } from '../mock/bus'
import { Icon, Segmented } from './ui'

const labels: Record<Scenario, string> = { ok: 'Успех', tests: 'Упадут тесты', health: 'Не поднимется', copy: 'Файл залочен' }

/** Только в демо: выбрать, чем закончится следующая публикация. */
export function DemoPanel() {
  const [s, setS] = useState<Scenario>(demo.get())
  const [open, setOpen] = useState(false)
  useEffect(() => bus.on('demoScenario', setS), [])

  if (!open) return (
    <div className="demo min">
      <div className="demo-head"><span className="muted">Исход публикации:</span><span>{labels[s]}</span></div>
      <button className="btn sm" onClick={() => setOpen(true)}>Сменить</button>
    </div>
  )

  return (
    <div className="demo">
      <div className="demo-head">
        <span>Чем закончится следующая публикация</span>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={() => setOpen(false)} aria-label="Свернуть"><Icon name="minus" /></button>
      </div>
      <Segmented<Scenario> small label="Исход" value={s} onChange={v => { demo.set(v); setTimeout(() => setOpen(false), 450) }}
        options={(Object.keys(labels) as Scenario[]).map(k => ({ value: k, label: labels[k] }))} />
    </div>
  )
}
