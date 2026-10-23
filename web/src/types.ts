export type Binding = { jsonPath: string; connectionStringId: number }

export type Target = {
  id: number | null
  name: string
  targetPath: string
  healthUrl: string | null
  ignoreTlsErrors: boolean
  bindings: Binding[]
  lastHealthOk?: boolean | null
  lastHealthAt?: string | null
  lastHealthMessage?: string | null
}

export type AppProject = {
  id: number | null
  name: string
  projectPath: string
  testPath: string | null
  publishArgs: string | null
  exclusions: string[]
  keyPaths: string[]
  targets: Target[]
}

export type Connection = {
  id: number
  name: string
  description: string | null
  maskedValue: string
  usedBy: string[]
}

export type SigningKey = { id: number; jsonPath: string; masked: string; createdAt: string }

export type RunStatus = 'Running' | 'Succeeded' | 'TestsFailed' | 'Failed' | 'HealthFailed' | 'Cancelled'

export type RunBrief = {
  id: string
  kind: 'Deploy' | 'Rollback'
  status: RunStatus
  startedAt: string
  finishedAt: string | null
  error: string | null
}

export type DashboardTarget = {
  id: number
  name: string
  targetPath: string
  healthUrl: string | null
  lastHealthOk: boolean | null
  lastHealthAt: string | null
  lastHealthMessage: string | null
  lastRun: RunBrief | null
  backupCount: number
  busy: boolean
}

export type DashboardApp = {
  id: number
  name: string
  projectPath: string
  hasTests: boolean
  targets: DashboardTarget[]
}

export type StageStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'
export type Stage = {
  key: string
  title: string
  status: StageStatus
  detail: string | null
  startedAt: string | null
  finishedAt: string | null
}

export type TestCase = {
  name: string
  outcome: string
  durationMs: number
  message: string | null
  stackTrace: string | null
  source: string
}
export type TestSummary = { total: number; passed: number; failed: number; skipped: number; tests: TestCase[] }

export type ConfigChange = { file: string; path: string; action: string; detail: string; level: 'info' | 'warn' | 'error' }

export type Run = {
  id: string
  targetId: number
  appId: number
  appName: string
  targetName: string
  kind: 'Deploy' | 'Rollback'
  status: RunStatus
  startedAt: string
  finishedAt: string | null
  error: string | null
  canCancel: boolean
  canRollback: boolean
  stages: Stage[]
  tests: TestSummary | null
  changes: ConfigChange[]
  mirror: { copied: number; unchanged: number; deleted: number; excluded: number } | null
  backupName: string | null
  restoredFrom: string | null
  health: { ok: boolean; message: string } | null
}

export type Backup = { name: string; createdAt: string }
export type Settings = { backupsToKeep: number; healthTimeoutSec: number; offlineDelaySec: number; keyBytes: number }
