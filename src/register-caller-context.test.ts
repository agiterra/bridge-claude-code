import { expect, test } from "bun:test";
import { registerCallerContext } from "./mcp-server.ts";

test("registration sends the caller's screen name and PID to crew-service", () => {
  expect(JSON.parse(registerCallerContext("terminal-1", "98426.baguette")!)).toEqual({
    terminal_session_id: "terminal-1",
    screen_name: "baguette",
    screen_pid: 98426,
    sty: "98426.baguette",
  });
});

test("registration keeps a terminal session ID when no screen exists", () => {
  expect(registerCallerContext("terminal-1", undefined)).toBe("terminal-1");
  expect(registerCallerContext("terminal-1", "bad-sty")).toBe("terminal-1");
});
