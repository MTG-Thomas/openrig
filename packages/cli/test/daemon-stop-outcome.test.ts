import path from "node:path";
import { Command } from "commander";
import { afterEach, expect, it, vi } from "vitest";
import { daemonCommand } from "../src/commands/daemon.js";
import { STATE_FILE, type LifecycleDeps } from "../src/daemon-lifecycle.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); process.exitCode = undefined; });
function fixture(opts: { survives?: boolean; unknownProbe?: boolean; receipt?: string } = {}) {
  let killed = false;
  let removed = false;
  const state = { pid: 987, host: "127.0.0.1", port: 17433, db: "private.db", startedAt: "2026-01-01T00:00:00Z" };
  const deps = {
    exists: (p: string) => p === STATE_FILE && !removed,
    readFile: (p: string) => p === STATE_FILE ? (removed ? null : JSON.stringify(state))
      : p === path.join(path.dirname(STATE_FILE), "daemon-shutdown.json") ? opts.receipt ?? JSON.stringify({
        schema: "openrig.daemon-shutdown/v1", pid: 987, startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), outcome: "clean", phase: "complete", failures: [],
      }) : null,
    removeFile: () => { removed = true; },
    isProcessAlive: () => !killed || opts.survives === true,
    kill: vi.fn(() => { killed = true; return true; }),
    fetch: vi.fn(async (url: string) => {
      if (!url.includes(":17433/")) return { ok: true }; // unrelated default listener
      if (!killed) return { ok: true };
      if (opts.unknownProbe) throw new Error("probe unavailable");
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    }),
  } as unknown as LifecycleDeps;
  return deps;
}
async function stop(deps: LifecycleDeps) {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const p = new Command().addCommand(daemonCommand(deps)).parseAsync(["node", "rig", "daemon", "stop"]);
  await vi.runAllTimersAsync(); await p;
  return { out: out.mock.calls.flat().join(" "), err: err.mock.calls.flat().join(" "), code: process.exitCode };
}
it("verifies the captured target after state removal, without probing the default listener", async () => {
  vi.useFakeTimers(); const deps = fixture(); const result = await stop(deps);
  expect(result.err).toBe(""); expect(result.code).not.toBe(1);
  expect(result.out).toContain("Daemon stopped");
  expect(vi.mocked(deps.fetch).mock.calls.every(([url]) => url === "http://127.0.0.1:17433/healthz")).toBe(true);
});
it("reports a surviving PID and refused listener separately", async () => {
  vi.useFakeTimers(); const result = await stop(fixture({ survives: true }));
  expect(result.code).toBe(1); expect(result.err).toMatch(/process.*present|pid.*present/i);
  expect(result.err).toMatch(/listener.*refused/i); expect(result.err).not.toMatch(/still listening/i);
});
it("an unavailable final probe cannot certify shutdown", async () => {
  vi.useFakeTimers(); const result = await stop(fixture({ unknownProbe: true }));
  expect(result.code).toBe(1); expect(result.err).toMatch(/unavailable|unverified/i);
  expect(result.out).not.toContain("Daemon stopped");
});
it.each(["failed", "timed-out"])("a %s drain is not success even after process and listener exit", async (outcome) => {
  vi.useFakeTimers(); const now = new Date().toISOString();
  const result = await stop(fixture({ receipt: JSON.stringify({ schema: "openrig.daemon-shutdown/v1", pid: 987,
    startedAt: now, completedAt: now, outcome, phase: "watchdog", failures: [{ phase: "watchdog", error: "incomplete" }] }) }));
  expect(result.code).toBe(1); expect(result.err).toContain(outcome); expect(result.err).toContain("phase=watchdog");
});
it.each([null, { pid: 123 }, { pid: 987, startedAt: "2020-01-01T00:00:00Z" }])("rejects absent, mismatched or stale completion evidence: %s", async (override) => {
  vi.useFakeTimers(); const now = new Date().toISOString();
  const receipt = override === null ? null : { schema: "openrig.daemon-shutdown/v1", pid: 987,
    startedAt: now, completedAt: now, outcome: "clean", phase: "complete", failures: [], ...override };
  const result = await stop(fixture({ receipt: JSON.stringify(receipt) }));
  expect(result.code).toBe(1); expect(result.err).toMatch(/unverified.*receipt/i);
});
