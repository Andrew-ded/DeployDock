type Handler = (...args: any[]) => void

/** Шина событий вместо SignalR: те же имена — runLog, runUpdated, healthUpdated. */
const handlers = new Map<string, Set<Handler>>()

export const bus = {
  on(event: string, h: Handler) {
    if (!handlers.has(event)) handlers.set(event, new Set())
    handlers.get(event)!.add(h)
    return () => { handlers.get(event)?.delete(h) }
  },
  emit(event: string, ...args: any[]) {
    handlers.get(event)?.forEach(h => {
      try { h(...args) } catch (e) { console.error(e) }
    })
  },
}

/** Чем закончится следующая публикация в демо. */
export type Scenario = 'ok' | 'tests' | 'health' | 'copy'
let scenario: Scenario = 'ok'
export const demo = {
  get: () => scenario,
  set: (s: Scenario) => { scenario = s; bus.emit('demoScenario', s) },
}
