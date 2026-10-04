export type Weather = {
  percent: number | null
  tokens: number | null
  window: number
  usd: number | null
  fiveHour: number | null
  sevenDay: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'context-weather': { weather: Weather | null; isHidden: boolean }
  }
}
