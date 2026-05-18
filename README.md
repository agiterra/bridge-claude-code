# bridge — Claude Code adapter

The orchestrator's plugin within the Agiterra Multi-Agent Toolkit (AMAT). Install one plugin (`bridge@agiterra`) and get the full orchestration surface — crew + wire + wire-ipc + knowledge + knowledge-indexer MCP tools consolidated into one server, plus bridge's composite tools layered on top.

## Install

```
/plugin install bridge@agiterra
```

Orchestrators install ONLY `bridge`. Workers/engineers install crew/wire/knowledge separately. See the [plan](https://github.com/agiterra/Fondant/blob/main/.knowledge/plan-bridge.md) (private) for the full design.

## Tools shipped in v0.1.0

| Tool | Purpose |
|---|---|
| `spawn` | Collapse the 6-step orchestration dance (wire register → env-map assembly → crew launch → pane create → attach → IPC kickoff) into a single call |

Composite tools landing incrementally: `paneNear`, `personaiInit`, `health`, `handoff`, `dispatch`, `close`, `composeBrief`.

Consolidated MCP surface (crew + wire + wire-ipc + knowledge + knowledge-indexer) landing as bridge stabilizes — for now, the underlying plugins are still installed alongside.

## Integration plugins

bridge stays domain-naive. Capability-specific behavior (GitHub minting, Linear sync, etc.) ships as separate **integration plugins** following the `bridge-X` pattern. See `@agiterra/bridge-tools` README for the `BridgeHook` contract.

## License

MIT
