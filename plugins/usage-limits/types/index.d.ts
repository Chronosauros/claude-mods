export type UsageLimitsWindow = { kind: string; percentUsed: number; resetsAt: number | null }

export type UsageLimits = { windows: UsageLimitsWindow[]; measuredAt: number } | null

declare module 'claude-code' {
  interface PluginState {
    'usage-limits': { limits: UsageLimits; isHidden: boolean }
  }
}
