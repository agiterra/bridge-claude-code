/**
 * Bridge write-surface ratchet.
 *
 * crew-tools has a test asserting that no tool case reaches a CrewStore write method.
 * bridge-claude-code had no equivalent — which is exactly how 18 of its handlers drifted
 * into local writes that CANNOT work from a persona uid (crews.db is writable only by
 * crew-service's uid). Brioche lost a boot registration and an agent_stop to that class
 * on 2026-09-21, and agent_stop was destructive: it kills before it writes.
 *
 * This does not demand the debt be paid at once. It RATCHETS: handlers that write locally
 * must either route/guard, or be named below. The named set may shrink, never grow.
 */
import { expect, test, describe } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const CT = join(ROOT, "node_modules/@agiterra/crew-tools/src");
const BRIDGE = readFileSync(join(import.meta.dir, "mcp-server.ts"), "utf8");

/**
 * Handlers that still write locally without routing or guarding.
 * ⚠️ This list may SHRINK, never grow. Do not add to it to make a new handler pass —
 * route through crew-service or call assertLocalWritePossible instead.
 * (Left unguarded deliberately on 2026-09-21: their writes may be CONDITIONAL, so a blind
 * precondition could refuse paths that work today. Each needs checking individually.)
 */
const KNOWN_UNGUARDED = new Set([
  "agent_attach", "agent_detach", "pane_create", "pane_close", "pane_register",
  "tab_create", "tab_destroy", "tab_register", "machine_probe", "machine_register",
  "machine_remove", "theme_update", "url_open",
]);

/** Split a TS class/module body into top-level 2-space-indented methods. */
function methods(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = src.split(/\n {2}(?:async )?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
  for (let i = 1; i < parts.length; i += 2) {
    let body = parts[i + 1];
    const nxt = body.search(/\n {2}(?:async )?[a-zA-Z_][a-zA-Z0-9_]*\s*\(/);
    if (nxt > -1) body = body.slice(0, nxt);
    out.set(parts[i], body);
  }
  return out;
}

/**
 * Strip comments before scanning for SQL.
 * ⚠️ The first version of this matched the bare words INSERT|UPDATE|DELETE and flagged
 * `listMachines` — a pure SELECT — because deleteMachine's JSDoc says "Refuses to delete
 * the local machine". A COMMENT describing the dangerous thing matched a pattern hunting
 * for the dangerous thing. Had that stood, the fix would have been to silence it by adding
 * machine_list to KNOWN_UNGUARDED, encoding a false positive as real debt.
 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
}

/**
 * CrewStore methods that execute SQL mutations — DERIVED from the SQL, not transcribed.
 * ⚠️ Matches STATEMENT SHAPE, not keywords. Narrowing it to `INSERT INTO` alone silently
 * dropped `tombstoneAgent` (it uses INSERT OR REPLACE INTO) — the single most important
 * writer here, since agent_stop kills before it tombstones. A fix for false positives is
 * not free: it bought a false negative on the destructive path.
 */
function storeWriters(): Set<string> {
  const src = stripComments(readFileSync(join(CT, "store.ts"), "utf8"));
  const SQL = /\b((?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;
  const w = new Set<string>();
  for (const [name, body] of methods(src)) {
    if (name === "constructor" || name === "if") continue;
    if (SQL.test(body)) w.add(name);
  }
  return w;
}

/**
 * crew-tools maintains its own hand-written list of mutating store methods. Ours is derived
 * from the SQL. Two independent instruments must agree — if they diverge, one of them is
 * wrong and this test says so rather than quietly trusting the derivation.
 */
const CREW_TOOLS_DECLARED = [
  "createTab", "setTabTheme", "deleteTab",
  "createPane", "setPaneItermId", "clearPaneItermId", "setPaneTheme", "renamePane",
  "clearTabSession", "deletePane",
  "createAgent", "tombstoneAgent", "setAgentTtl", "setAgentBadge",
  "updateAgentPid", "updateAgentPane", "updateAgentStatus", "touchAgent",
  "deleteAgent", "deleteAgentByScreen", "updateAgentCcSession",
  "createMachine", "deleteMachine", "updateMachineProbe",
];

/** Orchestrator methods that reach a store writer. */
function orchestratorWriters(writes: Set<string>): Set<string> {
  const src = readFileSync(join(CT, "orchestrator.ts"), "utf8");
  const w = new Set<string>();
  for (const [name, body] of methods(src)) {
    for (const s of writes) if (body.includes(`this.store.${s}`)) { w.add(name); break; }
  }
  return w;
}

/** Bridge tool handlers, by name, with their handler body. */
function bridgeHandlers(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /name:\s*"([a-z_]+)"/g;
  let m: RegExpExecArray | null;
  const starts: Array<[string, number]> = [];
  while ((m = re.exec(BRIDGE))) starts.push([m[1], m.index]);
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1][1] : BRIDGE.length;
    out.set(starts[i][0], BRIDGE.slice(starts[i][1], end));
  }
  return out;
}

describe("bridge write surface", () => {
  // ⚠️ An unreadable source must FAIL, never silently pass — a test that cannot measure
  // its subject and reports green is worse than no test at all.
  test("crew-tools sources are readable (otherwise this whole file is vacuous)", () => {
    expect(existsSync(join(CT, "store.ts"))).toBe(true);
    expect(existsSync(join(CT, "orchestrator.ts"))).toBe(true);
  });

  test("the derivation agrees EXACTLY with crew-tools' own declared write list", () => {
    const derived = [...storeWriters()].sort();
    expect(derived).toEqual([...CREW_TOOLS_DECLARED].sort());
  });

  test("tombstoneAgent is in the write set (agent_stop kills before it writes)", () => {
    expect(storeWriters().has("tombstoneAgent")).toBe(true);
  });

  test("every locally-writing handler is routed/guarded, or explicitly known", () => {
    const orch = orchestratorWriters(storeWriters());
    expect(orch.size).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const [name, body] of bridgeHandlers()) {
      const writesLocally = [...orch].some((o) => body.includes(`deps.orchestrator.${o}`));
      if (!writesLocally) continue;
      if (body.includes("assertLocalWritePossible")) continue;
      if (KNOWN_UNGUARDED.has(name)) continue;
      offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  test("the known-unguarded list has no stale entries (it may only shrink)", () => {
    const orch = orchestratorWriters(storeWriters());
    const handlers = bridgeHandlers();
    const stale: string[] = [];
    for (const name of KNOWN_UNGUARDED) {
      const body = handlers.get(name);
      if (!body) { stale.push(`${name} (handler gone)`); continue; }
      const writesLocally = [...orch].some((o) => body.includes(`deps.orchestrator.${o}`));
      if (!writesLocally || body.includes("assertLocalWritePossible")) stale.push(`${name} (now clean — remove it)`);
    }
    expect(stale).toEqual([]);
  });

  test("the handlers already fixed stay fixed", () => {
    const handlers = bridgeHandlers();
    for (const name of ["agent_send", "agent_badge", "agent_resume", "agent_register", "agent_stop"]) {
      expect(handlers.get(name)).toBeDefined();
      expect(handlers.get(name)!).toContain("assertLocalWritePossible");
    }
  });
});
