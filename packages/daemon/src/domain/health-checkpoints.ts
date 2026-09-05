import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { QueueRepository } from "./queue-repository.js";
import { healthHash, object, type HealthPolicyStore } from "./health-policy.js";
import { adaptQueueTransitionEvidence, adaptLifecycleReceiptEvidence, boundHealthEvidence, deriveHealthSourceFreshness, type HealthScope } from "./health-projection.js";
import type { HealthDetectorObservation, HealthObservationSource } from "./health-detectors.js";

/** Authored outcome-boundary census, not a per-edit event feed. Queue references
 * are verified locally; product/authority meaning remains attributed testimony. */
export interface HealthCheckpoint {
  schema: "openrig.health-checkpoint/v0alpha1";
  lineageQitemId: string;
  scope: HealthScope;
  startedAt: string;
  observedAt: string;
  transitionIds: number[];
  productOutcomes: Array<{ id: string; observedAt: string; evidenceRef: string }>;
  productCensusRef: string;
  boundedAuthority: { applies: boolean | null; evidenceRef: string };
  authorityPaths: { project: string[]; mission: string[]; slice: string[] };
}
interface StoredCheckpoint { actor: string; checkpoint: HealthCheckpoint; episodeStartedAt: string; active: boolean; qualifying: HealthCheckpoint | null; }
function text(value: unknown): asserts value is string { if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new Error("Expected a nonempty bounded string"); }
function timestamp(value: unknown): number { text(value); const time = Date.parse(value); if (!Number.isFinite(time)) throw new Error("Invalid checkpoint timestamp"); return time; }
function scope(value: unknown): asserts value is HealthScope {
  const type = (value as HealthScope)?.type;
  const fields = { instance: ["instanceId"], rig: ["rigId"], seat: ["rigId", "seatId"], mission: ["projectId", "missionId"], slice: ["projectId", "missionId", "sliceId"] }[type];
  if (!fields) throw new Error("Unknown health scope");
  const s = object(value, ["type", ...fields]); fields.forEach((f) => text(s[f]));
}
export class HealthCheckpointSource implements HealthObservationSource {
  private readonly dir: string;
  constructor(home: string, private readonly queue: QueueRepository, private readonly policy: HealthPolicyStore, private readonly now = () => new Date().toISOString()) {
    this.dir = join(home, "health", "checkpoints");
  }
  private validate(value: unknown): HealthCheckpoint {
    const c = object(value, ["schema", "lineageQitemId", "scope", "startedAt", "observedAt", "transitionIds", "productOutcomes", "productCensusRef", "boundedAuthority", "authorityPaths"]);
    if (c.schema !== "openrig.health-checkpoint/v0alpha1") throw new Error("Unsupported checkpoint schema");
    text(c.lineageQitemId); text(c.productCensusRef); scope(c.scope);
    const start = timestamp(c.startedAt); const end = timestamp(c.observedAt);
    if (end < start || end > Date.parse(this.now())) throw new Error("Checkpoint window is reversed or future");
    if (!Array.isArray(c.transitionIds) || c.transitionIds.length > 10000 || c.transitionIds.some((x) => !Number.isInteger(x) || x < 1) || new Set(c.transitionIds).size !== c.transitionIds.length) throw new Error("Invalid, duplicate, or excessive transition IDs");
    if (!Array.isArray(c.productOutcomes) || c.productOutcomes.length > 1000) throw new Error("Invalid product outcomes");
    const ids = new Set();
    for (const outcome of c.productOutcomes) {
      const o = object(outcome, ["id", "observedAt", "evidenceRef"]); text(o.id); text(o.evidenceRef);
      const at = timestamp(o.observedAt); if (at < start || at > end || ids.has(o.id)) throw new Error("Product outcome is duplicate or outside the lineage window"); ids.add(o.id);
    }
    const authority = object(c.boundedAuthority, ["applies", "evidenceRef"]); text(authority.evidenceRef);
    if (authority.applies !== null && typeof authority.applies !== "boolean") throw new Error("Authority must be true, false or unknown");
    const paths = object(c.authorityPaths, ["project", "mission", "slice"]);
    for (const list of Object.values(paths)) {
      if (!Array.isArray(list) || list.length > 10) throw new Error("Invalid authority path list"); list.forEach(text);
    }
    const row = this.queue.getById(c.lineageQitemId);
    if (!row || row.tags?.some((t) => t === "health-diagnosis" || t === "health-human")) throw new Error("Checkpoint must name existing product work, not health traffic");
    const transitions = this.queue.transitionLog.listForQitemWindow(c.lineageQitemId, c.startedAt as string, c.observedAt as string, 10001);
    const actual = new Set(transitions.map((t) => t.transitionId));
    if (actual.size !== c.transitionIds.length || c.transitionIds.some((id) => !actual.has(id))) throw new Error("Checkpoint transition census does not match this exact lineage/window");
    return structuredClone(value as HealthCheckpoint);
  }
  private file(lineage: string): string { return join(this.dir, `${healthHash(lineage)}.json`); }
  submit(value: unknown, actor: string) {
    const checkpoint = this.validate(value);
    text(actor);
    const file = this.file(checkpoint.lineageQitemId);
    if (!existsSync(file) && existsSync(this.dir) && readdirSync(this.dir).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).length >= 200) throw new Error("health_checkpoint_source_limit");
    const previous = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as StoredCheckpoint : null;
    if (previous && healthHash(previous.checkpoint) === healthHash(checkpoint)) return previous;
    if (previous && Date.parse(checkpoint.observedAt) <= Date.parse(previous.checkpoint.observedAt)) throw new Error("Checkpoint must advance observation time");
    const p = this.policy.read().policy.thresholds;
    const active = checkpoint.boundedAuthority.applies !== true && checkpoint.transitionIds.length >= p.ceremonyTransitions
      && checkpoint.transitionIds.length / Math.max(checkpoint.productOutcomes.length, 1) >= p.ceremonyRatio;
    const stored: StoredCheckpoint = { actor, checkpoint, active,
      episodeStartedAt: previous?.active ? previous.episodeStartedAt : checkpoint.startedAt,
      qualifying: active ? checkpoint : previous?.active ? previous.qualifying : null };
    // Recurrence starts at the first new qualifying checkpoint, not the previous episode's window.
    if (active && previous && !previous.active) stored.episodeStartedAt = checkpoint.observedAt;
    if (Buffer.byteLength(JSON.stringify(stored)) > 1048576) throw new Error("health_checkpoint_too_large");
    mkdirSync(join(this.dir, "history"), { recursive: true });
    const id = randomUUID();
    writeFileSync(join(this.dir, "history", `${id}.json`), JSON.stringify({ previous, current: stored }, null, 2), { flag: "wx" });
    const tmp = join(this.dir, `${id}.tmp`); writeFileSync(tmp, JSON.stringify(stored, null, 2)); renameSync(tmp, file);
    return stored;
  }
  entries(): StoredCheckpoint[] {
    if (!existsSync(this.dir)) return [];
    const names = readdirSync(this.dir).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
    if (names.length > 200) throw new Error("health_checkpoint_source_limit");
    return names.map((name) => {
      const bytes = readFileSync(join(this.dir, name), "utf8");
      if (Buffer.byteLength(bytes) > 1048576) throw new Error("health_checkpoint_too_large");
      const stored = JSON.parse(bytes) as StoredCheckpoint;
      this.validate(stored.checkpoint);
      text(stored.actor); timestamp(stored.episodeStartedAt);
      if (stored.qualifying) this.validate(stored.qualifying);
      return stored;
    });
  }
  read(): HealthDetectorObservation[] {
    const policy = this.policy.read().policy; const now = this.now();
    return this.entries().flatMap((stored) => {
      const current = stored.checkpoint;
      const thresholds = policy.thresholds;
      const active = current.boundedAuthority.applies !== true && current.transitionIds.length >= thresholds.ceremonyTransitions
        && current.transitionIds.length / Math.max(current.productOutcomes.length, 1) >= thresholds.ceremonyRatio;
      const c = active ? current : stored.qualifying;
      if (!c) return [];
      const ids = new Set(c.transitionIds);
      const transitions = this.queue.transitionLog.listForQitemWindow(c.lineageQitemId, c.startedAt, c.observedAt, 10001).filter((t) => ids.has(t.transitionId));
      const evidence = transitions.map(adaptQueueTransitionEvidence);
      const refs = [...c.productOutcomes.map((p) => ({ id: p.evidenceRef, at: p.observedAt, outcome: p.id })),
        { id: current.productCensusRef, at: current.observedAt, outcome: `product census by ${stored.actor}: ${current.productOutcomes.length} outcomes` },
        { id: current.boundedAuthority.evidenceRef, at: current.observedAt, outcome: `bounded authority: ${String(current.boundedAuthority.applies)}` }];
      const receipts = refs.map((r, i) => adaptLifecycleReceiptEvidence({ receiptId: r.id, operation: "health-outcome-checkpoint", outcome: r.outcome, observedAt: r.at, sourceOrder: evidence.length + i }));
      const available = transitions.length === ids.size && current.boundedAuthority.applies !== null;
      return [{ kind: "coordination-lineage" as const, scope: current.scope, episodeStartedAt: stored.episodeStartedAt,
        lastObservedAt: current.observedAt, conditionCleared: !active, confidence: "medium" as const, sourceDescription: `Outcome census attributed to ${stored.actor}; latest census: ${current.transitionIds.length} transitions, ${current.productOutcomes.length} product outcomes, bounded authority ${String(current.boundedAuthority.applies)}. Product and authority meaning are authored evidence, not inferred by the daemon.`, lineageId: c.lineageQitemId,
        coordinationTransitions: c.transitionIds.length, productStateChanges: c.productOutcomes.length, boundedAuthority: false,
        reviewReturns: 0, candidateChanges: 0, newRiskClasses: 0,
        source: boundHealthEvidence([...evidence, ...receipts], { source: "mixed", startedAt: new Date(Math.max(Date.parse(c.startedAt), Date.parse(now) - policy.observationWindowSeconds * 1000)).toISOString(), endedAt: now, limit: 11002, retentionSeconds: policy.observationWindowSeconds }, deriveHealthSourceFreshness({ evaluatedAt: now, newestSourceAt: current.observedAt, maxAgeSeconds: policy.freshnessSeconds, available })) }];
    });
  }
}
