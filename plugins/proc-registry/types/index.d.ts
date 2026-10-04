export type ProcKind = 'shell' | 'agent'

export type ProcRow = {
  id: string
  kind: ProcKind
  label: string
  port: number | null
  startedAt: number
  status: string
  isOpen: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'proc-registry': { rows: ProcRow[] }
  }
}
