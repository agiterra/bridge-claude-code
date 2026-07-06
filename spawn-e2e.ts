/**
 * spawn-e2e.ts — full-path spawn test: bridge spawn() → crew.agent_spawn RPC →
 * crew-service sudo -u _ephemeral → _ephemeral CC boots wire-connected.
 * Exactly what Brioche's bridge will do at 21:00Z, run here against the laptop
 * crew-service to verify the laptop _ephemeral provisioning + #9 together.
 *
 *   AGENT_ID=fondant AGENT_PRIVATE_KEY=... WIRE_URL=http://localhost:9800 \
 *     bun run spawn-e2e.ts
 */
import { spawn } from "@agiterra/bridge-tools";
import { RpcClient, WireConnection, importPrivateKey, derivePublicKeyB64 } from "@agiterra/wire-tools";

const me = process.env.AGENT_ID!;
const key = await importPrivateKey(process.env.AGENT_PRIVATE_KEY!);
const pub = await derivePublicKeyB64(key);
const url = process.env.WIRE_URL ?? "http://localhost:9800";

const client = new RpcClient({ url, agentId: me, signingKey: key });
const conn = new WireConnection({
  url, agentId: me, agentName: me, keyPair: { publicKey: pub, privateKey: key },
  ccSessionId: `spawn-e2e-${me}`,
  deliver: async ({ raw }) => { client.handleEvent(raw); },
});
await conn.start();

// Minimal orchestrator stub — spawn() only touches it for placement, and we
// pass detached, so it's never called.
const orchestrator = { store: {}, } as any;

try {
  const r = await spawn(
    {
      agent_id: "laptop-smoke-eng",
      display_name: "Laptop Smoke Eng",
      roles: ["eng"],
      task: "Laptop _ephemeral provisioning smoke test. Boot, confirm your Wire plugin connected (you should be able to receive IPC), then idle and await instructions. Do no real work.",
      project_dir: "/Users/_ephemeral/work",
      placement: { detached: true },
      force_rotate: true, // re-runnable: mint a fresh key even if the id lingers
      env: { CLAUDE_MODEL: "claude-opus-4-8" },
    },
    {
      orchestrator,
      wire_url: url,
      wire_ssh_host: "macbook-air.tail3ef8a5.ts.net",
      parent_agent_id: me,
      parent_signing_key: key,
      rpc_request: (dest, method, params, timeoutMs) => client.request(dest, method, params, timeoutMs),
      crew_svc_dest: "crew-svc@the-wire",
    },
    new Map(),
  );
  console.log("SPAWN RESULT:", JSON.stringify(r, null, 2));
} catch (e) {
  console.error("SPAWN FAILED:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await conn.stop();
}
