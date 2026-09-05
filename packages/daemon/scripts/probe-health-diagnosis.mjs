// Run after building daemon and CLI. Uses compiled product code, a disposable
// database/home and an ephemeral listener; no managed seats or real connector.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const home = mkdtempSync(join(tmpdir(), "openrig-health-journey-"));
process.env.OPENRIG_HOME = home;
process.env.OPENRIG_DB = join(home, "openrig.sqlite");
const { createDb } = await import("../dist/db/connection.js");
const { migrate } = await import("../dist/db/migrate.js");
const { ALL_MIGRATIONS } = await import("../dist/db/all-migrations.js");
const { EventBus } = await import("../dist/domain/event-bus.js");
const { QueueRepository } = await import("../dist/domain/queue-repository.js");
const { HealthPolicyStore } = await import("../dist/domain/health-policy.js");
const { HealthCheckpointSource } = await import("../dist/domain/health-checkpoints.js");
const { HealthProjectionService } = await import("../dist/domain/health-detectors.js");
const { HealthDiagnosisService } = await import("../dist/domain/health-diagnosis.js");
const { healthAuthority } = await import("../dist/domain/health-context.js");
const { healthRoutes } = await import("../dist/routes/health.js");
const { healthDiagnosisRoutes } = await import("../dist/routes/health-diagnosis.js");
const db = createDb(process.env.OPENRIG_DB);
migrate(db, ALL_MIGRATIONS);
const queue = new QueueRepository(db, new EventBus(db));
const policy = new HealthPolicyStore(home, () => ({ warningPercent: 95, criticalPercent: 99 }));
const checkpoints = new HealthCheckpointSource(home, queue, policy);
const projection = new HealthProjectionService(checkpoints, () => policy.read());
let wakes = 0;
queue.attachTransport({ send: async () => { wakes++; return { ok: true, verified: true }; } });
const workspace = join(home, "workspace"); mkdirSync(workspace);
writeFileSync(join(workspace, "SPEC.md"), "# Intent\nBuild a useful outcome; reserve judgment for the agent.\n");
const diagnosis = new HealthDiagnosisService({ queue, projection, policy, authority: (finding) => healthAuthority(workspace, checkpoints, finding) });
const app = new Hono();
app.get("/healthz", (c) => c.json({ status: "ok" }));
app.use("*", async (c, next) => {
  c.set("healthProjection", projection); c.set("healthPolicy", policy);
  c.set("healthCheckpoints", checkpoints); c.set("healthDiagnosis", diagnosis); await next();
});
app.route("/api/health", healthRoutes()); app.route("/api/health-diagnosis", healthDiagnosisRoutes());
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
await new Promise((done) => server.once("listening", done));
const port = server.address().port;
writeFileSync(join(home, "daemon.json"), JSON.stringify({ pid: process.pid, port, db: process.env.OPENRIG_DB, startedAt: new Date().toISOString() }));
const env = { ...process.env, OPENRIG_SESSION_NAME: "author@fixture", OPENRIG_URL: `http://127.0.0.1:${port}` };
delete env.OPENRIG_NODE_ID; delete env.OPENRIG_RIG_NAME;
const disk = () => readdirSync(home, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => {
  const p = join(e.parentPath, e.name); return [p, createHash("sha256").update(readFileSync(p)).digest("hex")];
}).sort(([a], [b]) => a.localeCompare(b));
const run = async (...args) => {
  const { stdout } = await promisify(execFile)(process.execPath, [join(root, "packages/cli/dist/index.js"), "health", ...args], { env, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
};
try {
  const row = await queue.create({ sourceSession: "author@fixture", destinationSession: "owner@fixture", body: "Product work used by the isolated journey", nudge: false });
  for (let i = 0; i < 24; i++) queue.update({ qitemId: row.qitemId, actorSession: "author@fixture", transitionNote: `bounded journey coordination ${i}` });
  const transitions = queue.listTransitions(row.qitemId); const at = new Date().toISOString();
  writeFileSync(join(home, "outcome.md"), "No delivered product change in this isolated example. Synthetic scenario, not historical evidence.\n");
  const checkpoint = { schema: "openrig.health-checkpoint/v0alpha1", lineageQitemId: row.qitemId,
    scope: { type: "rig", rigId: "fixture" }, startedAt: transitions[0].ts, observedAt: at,
    transitionIds: transitions.map((t) => t.transitionId), productOutcomes: [], productCensusRef: join(home, "outcome.md"),
    boundedAuthority: { applies: false, evidenceRef: join(home, "outcome.md") }, authorityPaths: { project: [join(workspace, "SPEC.md")], mission: [], slice: [] } };
  writeFileSync(join(home, "checkpoint.json"), JSON.stringify(checkpoint));
  await run("checkpoint", "--file", join(home, "checkpoint.json"), "--json");
  const effective = JSON.parse(await run("policy", "--json"));
  effective.policy.diagnosis.enabled = true; effective.policy.diagnosis.owner = "owner@fixture";
  writeFileSync(join(home, "policy-input.json"), JSON.stringify(effective.policy));
  await run("policy", "--file", join(home, "policy-input.json"), "--json");
  const before = db.prepare("SELECT total_changes() AS n").get().n;
  const diskBefore = disk();
  const findings = JSON.parse(await run("--instance", "--json"));
  const preview = JSON.parse(await run("diagnose", "--json"));
  assert.equal(preview.actions[0].action, "create");
  assert.equal(db.prepare("SELECT total_changes() AS n").get().n, before);
  assert.deepEqual(disk(), diskBefore);
  const created = JSON.parse(await run("diagnose", "--apply", "--json"));
  const id = created.actions[0].qitemId;
  await run("diagnose", "--apply", "--json");
  assert.equal(wakes, 1);
  assert.equal(diagnosis.list().length, 1);
  assert.equal(findings.records[0].policyVersion, policy.read().version);
  const detail = JSON.parse(await run("diagnosis", "show", id, "--json"));
  assert.match(detail.packet.instructions, /not the whole story/);
  assert.equal(detail.authority.find((r) => r.path.endsWith("SPEC.md")).state, "available");
  writeFileSync(join(home, "disposition.json"), JSON.stringify({ verdict: "insufficient evidence", causalStart: null, steering: "Inspect outcome evidence before correcting work", uncertainty: "This is an isolated synthetic journey", evidenceRefs: [join(home, "outcome.md")] }));
  await run("diagnosis", "record", id, "--file", join(home, "disposition.json"), "--json");
  const humanView = await run("diagnosis", "show", id);
  assert.match(humanView, /Disposition: insufficient evidence/);
  assert.equal(queue.getById(row.qitemId).state, "pending");
  console.log(JSON.stringify({ verdict: "PASS", compiledCli: true, realHttp: true, readonlyPreview: true, diskBytesUnchangedByReads: true, diagnosticRows: 1, wakes,
    policyVersion: policy.read().version, dispositionVisible: true, sourceWorkUnchanged: true, humanNotifications: 0 }));
} finally {
  await diagnosis.stop(); await new Promise((done) => server.close(done)); db.close();
  rmSync(home, { recursive: true, force: true });
}
