// MCP server for bridge. v0.1.0 exposes a single tool: `spawn`.
//
// Future:
//   - Consolidate crew/wire/wire-ipc/knowledge/knowledge-indexer MCP surface
//     into this server (replace/wrap/pass-through curation per the plan).
//   - Discover bridge-X integration plugins via installed_plugins.json scan +
//     dynamic-import of their bridge_integration entry modules.
//   - Add remaining composite tools (paneNear, personaiInit, health, handoff,
//     dispatch, close, composeBrief).

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

import { spawn, type SpawnDeps } from "@agiterra/bridge-tools/spawn";
import type {
  SpawnOptions,
  BridgeHook,
} from "@agiterra/bridge-tools/types";

const PKG_VERSION = "0.1.0";

const mcp = new Server(
  { name: "bridge", version: PKG_VERSION },
  {
    capabilities: { tools: {} },
    instructions:
      "Bridge — the orchestrator's plugin. Single-call composite tools for the N-step orchestration dances (spawn, dispatch, handoff, etc.). Use `spawn` to bring up a new agent with a finished task brief; bridge handles wire identity registration, crew launch, pane placement, and IPC kickoff in one shot.",
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "spawn",
      description:
        "Spawn a new agent end-to-end. Collapses the 6-step dance (wire register → env-map assembly → crew launch → pane create → attach → IPC kickoff) into one call. `roles` are opaque tags forwarded to the worker as AGENT_ROLES. `task` is the finished brief (orchestrator pre-assembled). `placement.near + direction` puts the new pane next to a known agent/pane; add `detached: true` for headless. `env` overrides per-spawn vars (fresh GH tokens, task-specific URLs, etc.). Returns the new agent's id, wire identity, applied capabilities, and brief_sent flag.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "Unique identifier for the new agent on Wire.",
          },
          display_name: {
            type: "string",
            description: "Display name. Defaults to agent_id.",
          },
          roles: {
            type: "array",
            items: { type: "string" },
            description: "Opaque role tags forwarded to the worker as AGENT_ROLES (comma-joined). Bridge does not interpret these.",
          },
          task: {
            type: "string",
            description: "Finished task brief. Sent as the IPC kickoff payload.",
          },
          capabilities: {
            type: "array",
            items: { type: "string" },
            description: "Capabilities to dispatch pre_spawn BridgeHooks for. v0.1.0 ships no hook registry yet — leave empty.",
          },
          placement: {
            type: "object",
            description: "Where to place the new pane. v0.1.0 supports relative placement (near + direction). Omit for headless.",
          },
          env: {
            type: "object",
            description: "Per-spawn env overrides — fresh tokens, task-specific URLs, etc.",
          },
          runtime: {
            type: "string",
            description: "Runtime to launch (e.g., 'claude', 'codex').",
          },
          project_dir: {
            type: "string",
            description: "Working directory for the spawned process.",
          },
        },
        required: ["agent_id", "roles", "task"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "spawn") {
    throw new Error(`unknown tool: ${req.params.name}`);
  }

  if (!deps) {
    return {
      content: [{ type: "text" as const, text: "bridge: not initialized (missing AGENT_ID, AGENT_PRIVATE_KEY, or WIRE_URL env)" }],
      isError: true,
    };
  }

  const opts = req.params.arguments as unknown as SpawnOptions;
  try {
    const result = await spawn(opts, deps, EMPTY_REGISTRY);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (e: unknown) {
    const err = e as Error;
    return {
      content: [{ type: "text" as const, text: `spawn failed: ${err.message}\n${err.stack ?? ""}` }],
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
      `[bridge] missing required env: AGENT_ID=${!!AGENT_ID} AGENT_PRIVATE_KEY=${!!rawKey} WIRE_URL=${!!WIRE_URL} — spawn tool will return errors until set`,
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
