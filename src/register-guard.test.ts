/**
 * Guard against a local fallback that CANNOT work.
 *
 * Several handlers in mcp-server.ts try crew-service first and fall back to the local
 * orchestrator. crews.db is writable only by crew-service's uid, so from a persona that
 * fallback always failed — and it replaced crew-service's diagnosis with sqlite's own
 * "attempt to write a readonly database", naming neither file, uid, nor writer.
 * Brioche lost a boot registration to exactly that (2026-09-21).
 *
 * Both branches are asserted on purpose: a guard that has never been shown able to PERMIT
 * is indistinguishable from one that refuses everything.
 */
import { expect, test, describe } from "bun:test";
import { assertLocalWritePossible } from "./mcp-server.ts";

const deps = (readonly: boolean) => ({ orchestrator: { store: { readonly } } }) as any;

describe("assertLocalWritePossible", () => {
  test("REFUSES the local fallback when the store is read-only", () => {
    expect(() => assertLocalWritePossible(deps(true), "agent_register", "broker timeout")).toThrow();
  });

  test("its refusal explains the real cause, not the driver's string", () => {
    let msg = "";
    try { assertLocalWritePossible(deps(true), "agent_register", "broker timeout"); }
    catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("agent_register");                        // which tool
    expect(msg).toContain("read-only");                             // the actual cause
    expect(msg).toContain("NOTHING WAS CHANGED");                   // the consequence
    expect(msg).toContain("broker timeout");                        // crew-service's own error, preserved
    expect(msg).not.toContain("attempt to write a readonly database");
  });

  test("PERMITS the local fallback when the store is writable", () => {
    expect(() => assertLocalWritePossible(deps(false), "agent_register", "broker timeout")).not.toThrow();
  });

  test("names whichever tool called it", () => {
    for (const tool of ["agent_send", "agent_badge", "agent_resume", "agent_register"]) {
      let msg = "";
      try { assertLocalWritePossible(deps(true), tool, "x"); } catch (e) { msg = (e as Error).message; }
      expect(msg).toContain(tool);
    }
  });
});
