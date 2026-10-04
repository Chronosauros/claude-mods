import type { EngineInterface, Register } from 'claude-code'

import type { ProcRow } from '../types'

const PANE = 'procs'
const rows = { plugin: 'proc-registry', key: 'rows' } as const

const TEXT = {
  en: {
    background: 'in background',
    commandDescription: 'Background processes and subagents of this session (ID, port, start time)',
    paneTitle: 'Processes',
    nothing: 'Nothing running in the background.',
    toClose: 'To close',
    recent: 'Finished (recent)',
    clear: 'Clear finished',
    statuses: {
      running: 'running',
      done: 'done',
      background: 'background',
      stopped: 'stopped',
      finished: 'finished',
    } as Record<string, string>,
  },
  pl: {
    background: 'w tle',
    commandDescription: 'Procesy w tle i subagenci tej sesji (ID, port, czas startu)',
    paneTitle: 'Procesy',
    nothing: 'Nic nie działa w tle.',
    toClose: 'Do zamknięcia',
    recent: 'Zakończone (ostatnie)',
    clear: 'Wyczyść zakończone',
    statuses: {
      running: 'działa',
      done: 'koniec',
      background: 'w tle',
      stopped: 'zatrzymany',
      finished: 'zakończony',
    } as Record<string, string>,
  },
} as const

type Text = (typeof TEXT)[keyof typeof TEXT]

const getRows = async ($: EngineInterface): Promise<ProcRow[]> =>
  ((await $.state.get(rows)).value as ProcRow[] | undefined) ?? []

const setRows = async ($: EngineInterface, change: (list: ProcRow[]) => ProcRow[]) => {
  await $.state.set(rows, change(await getRows($)))
}

const PORT = /(?:--port[ =]|-p[ =]|PORT=|localhost:|127\.0\.0\.1:|0\.0\.0\.0:)(\d{2,5})\b/
const ENDED = /completed|failed|killed|stopped|exited/i
const DONE = new Set(['completed', 'failed', 'killed', 'stopped', 'exited', 'cancelled'])

const portOf = (command: string) => {
  const hit = PORT.exec(command)

  return hit === null ? null : Number(hit[1])
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const age = (ms: number) => {
  const min = Math.max(0, Math.round(ms / 60000))

  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}

const upsert = (list: ProcRow[], row: ProcRow) =>
  list.some(one => one.id === row.id)
    ? list.map(one => (one.id === row.id ? { ...one, ...row, startedAt: one.startedAt } : one))
    : [...list, row].slice(-100)

let last = ''

async function refresh($: EngineInterface, T: Text) {
  const agents = await $.agent.list()
  const now = await $.clock.now()
  await setRows($, (list: ProcRow[]) => {
    let out = list
    for (const one of agents) {
      const prev = out.find(row => row.id === one.id)
      out = upsert(out, {
        id: one.id,
        kind: 'agent',
        label: clip(`${one.type}: ${one.description}`, 70),
        port: null,
        startedAt: prev?.startedAt ?? now,
        status: one.status,
        isOpen: !DONE.has(one.status),
      })
    }

    return out
  })

  const all = await getRows($)
  const open = all.filter((one: ProcRow) => one.isOpen).length
  const key = JSON.stringify(all.map((one: ProcRow) => [one.id, one.status]))
  if (key !== last) {
    last = key
    $.ui.status(open > 0 ? `${T.background}: ${open} (/procs)` : undefined)
  }
}

async function track($: EngineInterface, T: Text, e: any, next: any) {
  const now = await $.clock.now()
  const command: string = e.command ?? ''
  const id: string = e.tool_use_id ?? `${e.tool}-${now}`
  const base = { kind: 'shell' as const, label: clip(command.replace(/\s+/g, ' '), 70), port: portOf(command) }
  await setRows($, (list: ProcRow[]) =>
    upsert(list, { ...base, id, startedAt: now, status: 'running', isOpen: true }),
  )
  const ran = await next(e)
  const taskId: string | undefined = ran.result?.backgroundTaskId
  await setRows($, (list: ProcRow[]) =>
    taskId === undefined
      ? upsert(list, { ...base, id, startedAt: now, status: 'done', isOpen: false })
      : upsert(
          list.filter(one => one.id !== id),
          { ...base, id: taskId, startedAt: now, status: 'background', isOpen: true },
        ),
  )
  await refresh($, T)

  return ran
}

export const register: Register = (on, options) => {
  const T = TEXT[options.language === 'pl' ? 'pl' : 'en']
  const shown = (status: string) => T.statuses[status] ?? status

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'procs',
      description: T.commandDescription,
    })
    $.clock.every(5000, () => refresh($, T))

    return next(e)
  })

  on('command.run', { command: 'procs' }, async $ => {
    await refresh($, T)
    const now = await $.clock.now()
    const open = (await getRows($)).filter((one: ProcRow) => one.isOpen)
    await $.ui.open({ id: PANE, title: T.paneTitle })

    return {
      text:
        open.length === 0
          ? T.nothing
          : `${T.toClose} (${open.length}):\n${open
              .map(
                (one: ProcRow) =>
                  `- ${one.kind} ${one.id}${one.port === null ? '' : ` :${one.port}`} - ${one.label} (${age(now - one.startedAt)})`,
              )
              .join('\n')}`,
    }
  })

  on('tool.call', { tool: 'Bash' }, ($, e, next) => track($, T, e, next))
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) => track($, T, e, next))

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const id: string | undefined = (e as any).task_id ?? (e as any).shell_id
    if (id !== undefined) {
      await setRows($, (list: ProcRow[]) =>
        list.map(one => (one.id === id ? { ...one, status: 'stopped', isOpen: false } : one)),
      )
      await refresh($, T)
    }

    return ran
  })

  // Background task completions arrive as deliveries that name the task id;
  // this is a text heuristic, so the "background" status may linger if the
  // format changes.
  on('session.receive', async ($, e, next) => {
    const text = e.text
    if (ENDED.test(text)) {
      const open = (await getRows($)).filter((one: ProcRow) => one.isOpen && text.includes(one.id))
      if (open.length > 0) {
        await setRows($, (list: ProcRow[]) =>
          list.map(one =>
            open.some((o: ProcRow) => o.id === one.id)
              ? { ...one, status: 'finished', isOpen: false }
              : one,
          ),
        )
        await refresh($, T)
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await getRows($)
    const now = await $.clock.now()
    const open = list.filter((one: ProcRow) => one.isOpen)
    const closed = list.filter((one: ProcRow) => !one.isOpen).slice(-10)
    const room = Math.max(3, (e.viewport?.rows ?? 24) - 8)

    return (
      <Box flexDirection="column">
        <Text bold>{T.toClose}: {open.length}</Text>
        {open.length === 0 && <Text dimColor>{T.nothing}</Text>}
        {open.slice(-room).map((one: ProcRow) => (
          <Text color="yellow">
            {one.kind} {one.id}
            {one.port === null ? '' : ` :${one.port}`} · {shown(one.status)} · {age(now - one.startedAt)} ·{' '}
            {one.label}
          </Text>
        ))}
        {closed.length > 0 && <Text bold>{T.recent}</Text>}
        {closed.map((one: ProcRow) => (
          <Text dimColor>
            {one.kind} {one.id} · {shown(one.status)} · {one.label}
          </Text>
        ))}
        <Button
          key="clear"
          label={T.clear}
          onPress={() => setRows($, (all: ProcRow[]) => all.filter(one => one.isOpen))}
        />
      </Box>
    )
  })
}
