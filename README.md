# claude-mods

Function-hook mods for Claude Code (terminal and desktop). Each one adds a small piece of UI or a command to your session.

| Mod | What it does |
| --- | --- |
| `usage-limits` | A bar above the prompt: plan limit left (5 hours, week) and time to reset. |
| `proc-registry` | `/procs` command and a Processes panel: background shells and subagents with ID, port and start time, plus a counter in the status line. |
| `context-weather` | A bar above the prompt: context fill, session cost and plan limits, with a warning before compaction. |

## Install

```
claude plugin marketplace add Chronosauros/claude-mods
claude plugin install usage-limits@chronosaur-mods
claude plugin install proc-registry@chronosaur-mods
claude plugin install context-weather@chronosaur-mods
```

## Language

English by default. For Polish, set the `language` option per mod (`/config`, or in `settings.json`):

```json
{
  "pluginConfigs": {
    "usage-limits@chronosaur-mods": { "options": { "language": "pl" } },
    "proc-registry@chronosaur-mods": { "options": { "language": "pl" } },
    "context-weather@chronosaur-mods": { "options": { "language": "pl" } }
  }
}
```

## License

MIT
