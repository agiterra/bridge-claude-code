# bridge — Claude Code adapter

The orchestrator's plugin within the Agiterra Multi-Agent Toolkit. A permanent
agent (a **personai**) installs one plugin — `bridge@agiterra` — and gets the
full orchestration surface: a curated **crew + wire** MCP surface re-exposed
through bridge, plus bridge's own composite tools that collapse the
orchestrator's multi-step dances into single calls.

bridge is the runtime adapter; the runtime-agnostic logic lives in
`@agiterra/bridge-tools` and is shared with the Codex adapter.

## Install

```
/plugin install bridge@agiterra
```

An orchestrator installs ONLY `bridge` and gets crew + wire without installing
those plugins separately (see "Re-exposed crew + wire surface" below). The
worker agents an orchestrator spawns install crew / wire / knowledge as they
need them.

Workers spawned by bridge are **ephemeral** agents — short-lived, soft-reaped
when done. bridge runs as a **permanent** agent (a personai) whose own Wire
identity sponsors those ephemerals: `spawn` and `register_agent` are signed with
the orchestrator's key, which is what lets them register a new ephemeral on the
Wire.

## Requires

The bridge MCP server reads three env vars (set by the agent's launch
environment); without all three, every tool returns a "not initialized" error:

- `AGENT_ID` — the orchestrator's Wire id
- `AGENT_PRIVATE_KEY` — the orchestrator's Ed25519 signing key (base64)
- `WIRE_URL` — the Wire broker (default `http://localhost:9800`)

`WIRE_EXTERNAL_URL` is optional; when set, bridge forwards it into spawned
agents so plugins that advertise webhook URLs (e.g. github, slack) hand out a
publicly reachable URL instead of localhost.

## Composite tools

Each collapses an N-step orchestration dance into one call.

| Tool | Purpose |
|---|---|
| `spawn` | Collapse the 6-step dance (wire register → env-map assembly → crew launch → pane create → attach → IPC kickoff) into one call. Pass a finished `task` brief; bridge handles wire identity, crew launch, pane placement, and IPC kickoff. Supports cross-machine spawns via a registered crew machine (`machine` + `run_as_uid`). |
| `handoff` | Coordinated graceful exit: publish a `bridge.handoff` ack on Wire, then `crew.closeAgent` (clean `/exit` + SessionEnd hooks), then optionally close the pane. |
| `close` | Wrap-up dance: snapshot the agent's screen (audit/journal it before it's gone), graceful `/exit`, then optionally `pane_close`. |
| `pane_near` | Resolve "near X, direction Y" placement intent into a concrete pane spec without spawning. |
| `compose_brief` | Dry-run preview of what `spawn` would do — assembled env, resolved placement, hooks that would run — with no side effects. |
| `health` | Cross-leg diagnostic: pings the wire server, counts crew agents/panes/tabs, checks the knowledge vault. Read-only. |

## Re-exposed crew + wire surface

So an orchestrator can install bridge alone, bridge re-exposes a curated subset
of crew and wire tools. Each proxied tool's input schema is copied verbatim from
its source plugin and proxies straight through to the same `crew-tools` /
`wire-tools` code — wire tools are signed with the orchestrator's own identity.

- **crew**: `agent_send`, `agent_read`, `agent_list`, `agent_interrupt`,
  `agent_resume`, `agent_attach`, `agent_detach`, `agent_move`, `agent_swap`,
  `agent_badge`, `agent_stop`, `pane_create`, `pane_close`, `pane_list`,
  `pane_badge`, `pane_notify`, `pane_register`, `tab_create`, `tab_destroy`,
  `tab_list`, `tab_register`, `machine_list`, `machine_probe`,
  `machine_register`, `machine_remove`, `theme_list`, `theme_update`,
  `tombstone_list`, `reconcile`, `url_open`
- **wire**: `set_plan`, `heartbeat_create`, `heartbeat_list`,
  `heartbeat_delete`, `register_agent`

Excluded from the crew subset because bridge's composites cover them:
`agent_launch`, `agent_register`, `agent_close`. `wire-ipc`, `knowledge`, and
`knowledge-indexer` remain separate plugins — they are not consolidated into
bridge.

## Integration plugins

bridge stays domain-naive. Capability-specific behavior (GitHub minting, Linear
sync, etc.) ships as separate **integration plugins** following the `bridge-X`
naming pattern (`bridge-github`, `bridge-linear`, …). bridge scans
`installed_plugins.json` at boot, finds matching `bridge_integration`
declarations, and registers each `BridgeHook`. See the `@agiterra/bridge-tools`
README for the `BridgeHook` contract.

## License

MIT
