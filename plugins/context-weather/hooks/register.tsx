import type { EngineInterface, Register } from 'claude-code'

import type { Weather } from '../types'

const weather = { plugin: 'context-weather', key: 'weather' } as const
const isHidden = { plugin: 'context-weather', key: 'isHidden' } as const

const TEXT = {
  en: {
    context: 'Context',
    waiting: 'Context: waiting for the first reply ',
    hide: 'Hide',
    warn1: (percent: number | null) => `Context ${percent}% - consider wrapping up before compaction`,
    warn2: (percent: number | null) => `Context ${percent}% - compaction is near, save your work state`,
  },
  pl: {
    context: 'Kontekst',
    waiting: 'Kontekst: czeka na pierwszą odpowiedź ',
    hide: 'Ukryj',
    warn1: (percent: number | null) => `Kontekst ${percent}% - warto domknąć wątek przed kompakcją`,
    warn2: (percent: number | null) => `Kontekst ${percent}% - kompakcja blisko, zapisz stan pracy`,
  },
} as const

type Text = (typeof TEXT)[keyof typeof TEXT]

const STEPS = [70, 85, 95]
const BAR = 10

let warned = 0

const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

const colorOf = (percent: number) =>
  percent >= 85 ? 'red' : percent >= 70 ? 'yellow' : 'green'

const bar = (percent: number) => {
  const full = Math.min(BAR, Math.round((percent / 100) * BAR))

  return '█'.repeat(full) + '░'.repeat(BAR - full)
}

async function measure($: EngineInterface): Promise<Weather> {
  const usage = await $.session.usage()
  const limit = (kind: string) =>
    usage.rateLimits.find(one => one.kind === kind)?.percentUsed ?? null

  return {
    percent: usage.context.percent ?? null,
    tokens: usage.context.tokens ?? null,
    window: usage.context.window,
    usd: usage.cost?.usd ?? null,
    fiveHour: limit('five_hour'),
    sevenDay: limit('seven_day'),
  }
}

const stepOf = (percent: number | null) => STEPS.filter(one => (percent ?? 0) >= one).length

const warning = (T: Text, percent: number | null) =>
  stepOf(percent) === 1 ? T.warn1(percent) : T.warn2(percent)

const setWeather = async ($: EngineInterface) => {
  await $.state.set(weather, await measure($))
}

export const register: Register = (on, options) => {
  const T = TEXT[options.language === 'pl' ? 'pl' : 'en']

  on('session.start', async ($, e, next) => {
    await setWeather($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await measure($)
    await $.state.set(weather, now)
    if (stepOf(now.percent) > warned) $.ui.toast(warning(T, now.percent))
    warned = stepOf(now.percent)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    await setWeather($)

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = ((await $.state.get(weather)).value as Weather | null | undefined) ?? null
    const hidden = ((await $.state.get(isHidden)).value as boolean | undefined) ?? false
    if (e.props.hasSurvey || now === null || hidden) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    if (now.percent === null) {
      return (
        <Box>
          <Text dimColor>{T.waiting}</Text>
          <Button key="hide" label={T.hide} onPress={() => $.state.set(isHidden, true)} />
        </Box>
      )
    }

    const tokens = now.tokens === null ? '' : ` (${kilo(now.tokens)}/${kilo(now.window)})`
    const money = now.usd === null ? '' : ` · $${now.usd.toFixed(2)}`
    const five = now.fiveHour === null ? '' : ` · 5h ${Math.round(now.fiveHour)}%`
    const seven = now.sevenDay === null ? '' : ` · 7d ${Math.round(now.sevenDay)}%`

    return (
      <Box>
        <Text color={colorOf(now.percent)}>
          {T.context} {bar(now.percent)} {now.percent}%{tokens}
        </Text>
        <Text dimColor>
          {money}
          {five}
          {seven}{' '}
        </Text>
        <Button key="hide" label={T.hide} onPress={() => $.state.set(isHidden, true)} />
      </Box>
    )
  })
}
