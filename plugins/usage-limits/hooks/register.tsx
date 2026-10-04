import type { EngineInterface, Register } from 'claude-code'

import type { UsageLimits } from '../types'

const limits = { plugin: 'usage-limits', key: 'limits' } as const
const isHidden = { plugin: 'usage-limits', key: 'isHidden' } as const

const BAR = 10
const REFRESH_MS = 60_000

const TEXT = {
  en: {
    names: { five_hour: '5h', seven_day: 'Week', spend_limit: 'Budget' } as Record<string, string>,
    waiting: 'Limits: will show after the first reply ',
    hide: 'Hide',
    left: 'left',
    reset: 'resets in',
  },
  pl: {
    names: { five_hour: '5h', seven_day: 'Tydzień', spend_limit: 'Budżet' } as Record<string, string>,
    waiting: 'Limity: pokażą się po pierwszej odpowiedzi ',
    hide: 'Ukryj',
    left: 'zostało',
    reset: 'reset za',
  },
} as const

const colorOf = (left: number) => (left <= 15 ? 'red' : left <= 35 ? 'yellow' : 'green')

const bar = (left: number) => {
  const full = Math.max(0, Math.min(BAR, Math.round((left / 100) * BAR)))

  return '█'.repeat(full) + '░'.repeat(BAR - full)
}

// Relative time, so the module never depends on the sandbox's time zone.
const countdown = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60

  if (days > 0) return `${days} d ${hours} h`
  if (hours > 0) return `${hours} h ${rest} min`
  return `${rest} min`
}

async function measure($: EngineInterface): Promise<UsageLimits> {
  const usage = await $.session.usage()
  const measuredAt = await $.clock.now()
  const windows = usage.rateLimits.map(one => ({
    kind: one.kind,
    percentUsed: one.percentUsed,
    resetsAt: one.resetsAt ? Date.parse(one.resetsAt) : null,
  }))

  return { windows, measuredAt }
}

export const register: Register = (on, options) => {
  const T = TEXT[options.language === 'pl' ? 'pl' : 'en']
  let stop: (() => void) | null = null

  on('session.start', async ($, e, next) => {
    await $.state.set(limits, await measure($))
    stop?.()
    stop = $.clock.every(REFRESH_MS, () => {
      void measure($).then(now => $.state.set(limits, now))
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await $.state.set(limits, await measure($))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const { value: now = null } = await $.state.get(limits)
    const { value: hidden = false } = await $.state.get(isHidden)

    if (e.props.hasSurvey || hidden || now === null) {
      return below
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    const row =
      now.windows.length === 0 ? (
        <Box key="usage">
          <Text dimColor>{T.waiting}</Text>
          <Button key="hide" label={T.hide} onPress={() => $.state.set(isHidden, true)} />
        </Box>
      ) : (
        <Box key="usage">
          {now.windows.map(one => {
            const left = Math.max(0, Math.round(100 - one.percentUsed))
            const reset =
              one.resetsAt === null ? '' : ` · ${T.reset} ${countdown(one.resetsAt - now.measuredAt)}`

            return (
              <Text key={one.kind}>
                <Text dimColor>{T.names[one.kind] ?? one.kind} </Text>
                <Text color={colorOf(left)}>
                  {bar(left)} {T.left} {left}%
                </Text>
                <Text dimColor>
                  {reset}
                  {'   '}
                </Text>
              </Text>
            )
          })}
          <Button key="hide" label={T.hide} onPress={() => $.state.set(isHidden, true)} />
        </Box>
      )

    if (!below) {
      return row
    }

    return (
      <Box flexDirection="column">
        {below}
        {row}
      </Box>
    )
  })
}
