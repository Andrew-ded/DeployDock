import type { AppProject, Backup, Connection, DashboardApp, Run, Settings, SigningKey } from './types'
import { mockApi } from './mock/api'

export class ApiError extends Error {}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
      else if (j?.title) msg = j.title
    } catch { /* тело не JSON */ }
    throw new ApiError(msg)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const realApi = {
  dashboard: () => req<DashboardApp[]>('GET', '/api/dashboard'),

  apps: () => req<AppProject[]>('GET', '/api/apps'),
  app: (id: number) => req<AppProject>('GET', `/api/apps/${id}`),
  createApp: (a: AppProject) => req<AppProject>('POST', '/api/apps', a),
  updateApp: (id: number, a: AppProject) => req<AppProject>('PUT', `/api/apps/${id}`, a),
  deleteApp: (id: number) => req<void>('DELETE', `/api/apps/${id}`),

  connections: () => req<Connection[]>('GET', '/api/connections'),
  connectionValue: (id: number) => req<{ value: string }>('GET', `/api/connections/${id}/value`),
  createConnection: (c: { name: string; description: string | null; value: string }) =>
    req<{ id: number }>('POST', '/api/connections', c),
  updateConnection: (id: number, c: { name: string; description: string | null; value: string | null }) =>
    req<{ id: number }>('PUT', `/api/connections/${id}`, c),
  deleteConnection: (id: number) => req<void>('DELETE', `/api/connections/${id}`),

  generateKey: (bytes: number, format: string) =>
    req<{ value: string }>('GET', `/api/keys/generate?bytes=${bytes}&format=${format}`),
  targetKeys: (targetId: number) => req<SigningKey[]>('GET', `/api/targets/${targetId}/keys`),
  keyValue: (id: number) => req<{ value: string }>('GET', `/api/keys/${id}/value`),
  regenerateKey: (targetId: number, jsonPath: string) =>
    req<{ id: number }>('POST', `/api/targets/${targetId}/keys/regenerate`, { jsonPath }),
  deleteKey: (id: number) => req<void>('DELETE', `/api/keys/${id}`),

  deploy: (targetId: number) => req<{ id: string }>('POST', `/api/targets/${targetId}/deploy`),
  rollback: (targetId: number, backup?: string) =>
    req<{ id: string }>('POST', `/api/targets/${targetId}/rollback`, { backup: backup ?? null }),
  backups: (targetId: number) => req<Backup[]>('GET', `/api/targets/${targetId}/backups`),
  checkHealth: (targetId: number) => req<{ ok: boolean; message: string }>('POST', `/api/targets/${targetId}/health`),
  checkAllHealth: () => req<void>('POST', '/api/health/check-all'),

  run: (id: string) => req<{ run: Run; log: string[] }>('GET', `/api/runs/${id}`),
  cancelRun: (id: string) => req<void>('POST', `/api/runs/${id}/cancel`),

  settings: () => req<Settings>('GET', '/api/settings'),
  saveSettings: (s: Settings) => req<Settings>('PUT', '/api/settings', s),
  info: () => req<{ dataDir: string; version: string; portable: boolean }>('GET', '/api/info'),

  checkPaths: (paths: string[]) => req<{ path: string; kind: string }[]>('POST', '/api/fs/check', { paths }),
}

export type Api = typeof realApi

/** В демо-сборке (vite --mode mock) вместо сервера работают моки в памяти браузера. */
export const isMock = import.meta.env.VITE_MOCK === '1'
export const api: Api = isMock ? mockApi : realApi
