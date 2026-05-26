// MCP server for bridge. v0.2.0 exposes: spawn, handoff, pane_near, close,
// compose_brief, health.
//
// Not yet:
//   - dispatch (composite — landing in bridge-tools v0.4)
//   - personai_init (composite — landing soon)
//   - Consolidated MCP surface (crew/wire/wire-ipc/knowledge/knowledge-indexer
//     replace/wrap/pass-through curation)
//   - Hook discovery for bridge-X integration plugins (empty registry shipped)

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  Orchestrator,
  createBackend,
  detectTerminal,
} from "@agiterra/crew-tools";
import { importKeyPair } from "@agiterra/wire-tools";

import {
  spawn,
  handoff,
  paneNear,
  close as closeComposite,
  composeBrief,
  health,
  type SpawnDeps,
} from "@agiterra/bridge-tools";
import type {
  SpawnOptions,
  BridgeHook,
} from "@agiterra/bridge-tools/types";

const PKG_VERSION = "0.2.0";

const mcp = new Server(
  { name: "bridge", version: PKG_VERSION },
  {
    capabilities: { tools: {} },
    instructions:
      "Bridge — the orchestrator's plugin. Single-call composite tools that collapse the orchestrator's N-step dances (spawn, handoff, close, etc.) into one call each. Use spawn to bring up a new agent with a finished task brief; bridge handles wire identity registration, crew launch, pane placement, and IPC kickoff in one shot. pane_near resolves 'right of babka'-style placement intent without spawning. compose_brief is the dry-run inspector. health is the cross-leg diagnostic.",
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "spawn",
      description:
        "Spawn a new agent end-to-end. Collapses the 6-step dance (wire register → env-map → crew launch → pane create → attach → IPC kickoff) into one call. `roles` are opaque tags forwarded as AGENT_ROLES. `task` is the finished brief. `placement.near + direction` puts the new pane next to a known agent/pane; add `detached: true` for headless. `env` overrides per-spawn vars. `badge` (optional) is multi-line text shown in the pane's top-right when attached — typical format: 'Name — Role\\nTicket #ID'. `branch` (optional) is the git branch the agent works on — when set, bridge creates an isolated worktree under `<project_dir>/worktrees/<branch>` to prevent concurrent agents in the same repo from clobbering each other's uncommitted work via git checkout. Set `worktree: false` to opt out of isolation. Returns {agent_id, wire_identity, applied_capabilities, brief_sent}.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          display_name: { type: "string" },
          roles: { type: "array", items: { type: "string" } },
          task: { type: "string" },
          capabilities: { type: "array", items: { type: "string" } },
          placement: { type: "object" },
          env: { type: "object" },
          runtime: { type: "string" },
          project_dir: { type: "string" },
          badge: { type: "string" },
          branch: { type: "string" },
          worktree: { type: "boolean" },
        },
        required: ["agent_id", "roles", "task"],
      },
    },
    {
      name: "handoff",
      description:
        "Coordinated graceful exit of a worker agent. Publishes a bridge.handoff ack on Wire (so monitors know it's a graceful exit, not a reap), then calls crew.closeAgent (sends /exit, runs SessionEnd hooks, waits for clean shutdown), then optionally closes the pane. The closing agent is responsible for running /knowledge:save itself BEFORE signaling ready-to-close; bridge does not invoke that.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          close_pane: { type: "string" },
          timeout_ms: { type: "number" },
        },
        required: ["agent_id"],
      },
    },
    {
      name: "pane_near",
      description:
        "Resolve 'near X, direction Y' placement intent into a concrete pane spec. Walks the crew tree to find the anchor (by pane name OR agent name → attached pane), then returns {tab, anchor_pane, direction, split_direction, via_agent}. Useful when the orchestrator wants to plan placement before spawning.",
      inputSchema: {
        type: "object",
        properties: {
          near: { type: "string" },
          direction: { type: "string", enum: ["right", "below", "left", "above"] },
        },
        required: ["near", "direction"],
      },
    },
    {
      name: "close",
      description:
        "Collapsed wrap-up dance: snapshot the agent's screen via crew.readAgent (so you can audit/journal it BEFORE the session is gone), then crew.closeAgent (graceful /exit), then optionally pane_close. No precondition enforcement — bridge collapses the mechanical dance; the orchestrator owns whatever discipline checks (Linear status, audit checklist) upstream.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          close_pane: { type: "string" },
          skip_snapshot: { type: "boolean" },
          timeout_ms: { type: "number" },
        },
        required: ["agent_id"],
      },
    },
    {
      name: "compose_brief",
      description:
        "Dry-run preview of what spawn WOULD do without spawning. Returns assembled env (with AGENT_PRIVATE_KEY placeholder), resolved placement, hooks that would run, capabilities with no registered hook, and notes for orchestrator review. Hooks are NOT invoked (avoids side effects in dry-run). Takes the same arguments as spawn.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          display_name: { type: "string" },
          roles: { type: "array", items: { type: "string" } },
          task: { type: "string" },
          capabilities: { type: "array", items: { type: "string" } },
          placement: { type: "object" },
          env: { type: "object" },
          runtime: { type: "string" },
          project_dir: { type: "string" },
          badge: { type: "string" },
          branch: { type: "string" },
          worktree: { type: "boolean" },
        },
        required: ["agent_id", "roles", "task"],
      },
    },
    {
      name: "health",
      description:
        "Cross-leg diagnostic. Pings the wire server, counts crew agents/panes/tabs, checks the knowledge vault path and journal.db presence. Read-only. Useful at session start or before a complex orchestration push.",
      inputSchema: {
        type: "object",
        properties: {
          vault_path: { type: "string" },
        },
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (!deps) {
    return {
      content: [{ type: "text" as const, text: "bridge: not initialized (missing AGENT_ID, AGENT_PRIVATE_KEY, or WIRE_URL env)" }],
      isError: true,
    };
  }

  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  try {
    let result: unknown;
    switch (req.params.name) {
      case "spawn":
        result = await spawn(args as unknown as SpawnOptions, deps, EMPTY_REGISTRY);
        break;
      case "handoff":
        result = await handoff(args as any, deps);
        break;
      case "pane_near":
        result = paneNear(args as any, { orchestrator: deps.orchestrator });
        break;
      case "close":
        result = await closeComposite(args as any, { orchestrator: deps.orchestrator });
        break;
      case "compose_brief":
        result = composeBrief(
          args as unknown as SpawnOptions,
          { orchestrator: deps.orchestrator, wire_url: deps.wire_url, parent_agent_id: deps.parent_agent_id },
          EMPTY_REGISTRY,
        );
        break;
      case "health":
        result = await health(args as any, { orchestrator: deps.orchestrator, wire_url: deps.wire_url });
        break;
      default:
        throw new Error(`unknown tool: ${req.params.name}`);
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (e: unknown) {
    const err = e as Error;
    return {
      content: [{ type: "text" as const, text: `${req.params.name} failed: ${err.message}\n${err.stack ?? ""}` }],
      isError: true,
    };
  }
});

let deps: SpawnDeps | undefined;
const EMPTY_REGISTRY: ReadonlyMap<string, BridgeHook> = new Map();

export async function startServer(): Promise<void> {
  const AGENT_ID = process.env.AGENT_ID;
  const rawKey = process.env.AGENT_PRIVATE_KEY;
  const WIRE_URL = process.env.WIRE_URL;

  if (!AGENT_ID || !rawKey || !WIRE_URL) {
    console.error(
      `[bridge] missing required env: AGENT_ID=${!!AGENT_ID} AGENT_PRIVATE_KEY=${!!rawKey} WIRE_URL=${!!WIRE_URL} — tools will return errors until set`,
    );
  } else {
    const keypair = await importKeyPair(rawKey);
    const terminalType = detectTerminal();
    const terminal = await createBackend(terminalType);
    const orchestrator = new Orchestrator(terminal);
    deps = {
      orchestrator,
      wire_url: WIRE_URL,
      parent_agent_id: AGENT_ID,
      parent_signing_key: keypair.privateKey,
    };
    console.error(`[bridge] ready (agent=${AGENT_ID}, backend=${terminalType})`);
  }

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}
