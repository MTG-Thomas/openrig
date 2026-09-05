import type { QueueRepository } from "./queue-repository.js";
import type { HealthProjectionService } from "./health-detectors.js";
import { healthHash, object, type HealthPolicyStore } from "./health-policy.js";
import type { HealthRecord } from "./health-projection.js";

export const DIAGNOSIS_VERDICTS = ["false positive", "early real condition", "established pathology", "insufficient evidence", "resolved"] as const;
export interface HealthDisposition {
  verdict: typeof DIAGNOSIS_VERDICTS[number]; causalStart: string | null;
  steering: string; uncertainty: string; evidenceRefs: string[];
}
export interface AuthorityReference { path: string; state: "available" | "unavailable"; sha256?: string; content?: string; }
interface Packet { schema: "openrig.health-diagnosis/v0alpha1"; finding: HealthRecord; policyVersion: string; authority: AuthorityReference[]; presentedAt: string; instructions: string; }
interface Receipt { kind: "health-diagnosis"; at: string; action: "presented" | "observed" | "disposition"; finding?: HealthRecord; disposition?: HealthDisposition; authority?: AuthorityReference[]; }
interface DiagnosisAction { qitemId: string; findingId: string; action: "create" | "represent" | "observe" | "retained" | "deferred"; reason?: string; }
const instructions = "This packet is a shortcut, not the whole story. Start with the exact evidence and current project/mission/slice authority below; read those sources again before acting. You may extend the investigation. The deterministic signal is not a psychological or epistemic diagnosis. Self-scout is supported: trace the earliest causal point, examine your own contribution, distinguish another seat or stale control-plane source, and request a second agent only when useful. Record one bounded disposition with causal start (or unknown), smallest corrective steering, evidence and remaining uncertainty. Advice is not authorization to cancel work, change scope/rigor/ownership/lifecycle, restart agents, or relax safety. Human escalation requires explicit policy and verified delivery readiness.";

export class HealthDiagnosisService {
  private pending: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastEvaluation: { at: string; error: string | null } | null = null;
  status() { return { scheduled: this.timer !== undefined, lastEvaluation: this.lastEvaluation }; }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.evaluate("system:health", true).then(() => { this.lastEvaluation = { at: this.now(), error: null }; }, (error: unknown) => { this.lastEvaluation = { at: this.now(), error: String(error) }; });
    }, 60000);
    this.timer.unref();
  }
  async stop(): Promise<void> { clearInterval(this.timer); this.timer = undefined; await this.pending; }
  constructor(private readonly deps: {
    queue: QueueRepository; projection: HealthProjectionService; policy: HealthPolicyStore;
    now?: () => string; authority: (record: HealthRecord) => AuthorityReference[];
    humanReadiness?: (address: string) => Promise<{ ready: boolean; reason: string }>;
  }) {}
  private now(): string { return this.deps.now?.() ?? new Date().toISOString(); }
  private id(findingId: string): string { return `qitem-health-diagnosis-${findingId}`; }
  private receipt(qitemId: string, actor: string, value: Omit<Receipt, "kind" | "at">): void {
    this.deps.queue.update({ qitemId, actorSession: actor, transitionNote: JSON.stringify({ kind: "health-diagnosis", at: this.now(), ...value }) });
  }
  show(qitemId: string) {
    const row = this.deps.queue.getById(qitemId);
    if (!row || !row.tags?.includes("health-diagnosis")) throw new Error("health_diagnosis_not_found");
    const packet = JSON.parse(row.body) as Packet;
    const human = this.deps.queue.getById(`qitem-health-human-${packet.finding.id}`);
    const receipts: Receipt[] = this.deps.queue.listTransitions(qitemId).flatMap((t) => {
      try { const value = JSON.parse(t.transitionNote ?? "null") as Receipt | null; return value?.kind === "health-diagnosis" ? [value] : []; } catch { return []; }
    });
    return { row, packet, receipts, humanDelivery: human ? { qitemId: human.qitemId, outcome: human.deliveryOutcome ?? "pending" } : null,
      finding: receipts.filter((r) => r.finding).at(-1)?.finding ?? packet.finding,
      authority: receipts.filter((r) => r.authority).at(-1)?.authority ?? packet.authority,
      disposition: receipts.filter((r) => r.disposition).at(-1)?.disposition ?? null };
  }
  list() {
    // Refuse a truncated ownership census rather than treating a hidden occurrence as absent.
    const rows = this.deps.queue.list({ tag: "health-diagnosis", limit: 10000 });
    if (rows.length === 10000) throw new Error("health_diagnosis_census_truncated");
    return rows.filter((r) => r.tags?.includes("health-diagnosis")).map((r) => this.show(r.qitemId));
  }
  evaluate(actor: string, apply: boolean): Promise<{ policyVersion: string; enabled: boolean; actions: DiagnosisAction[] }> {
    const work = this.pending.then(() => this.evaluateOnce(actor, apply));
    this.pending = work.catch(() => undefined);
    return work;
  }
  private async evaluateOnce(actor: string, apply: boolean) {
    const effective = this.deps.policy.read();
    const policy = effective.policy.diagnosis;
    const actions: DiagnosisAction[] = [];
    if (!policy.enabled || !policy.owner) return { policyVersion: effective.version, enabled: false, actions };
    const now = Date.parse(this.now());
    const occurrences = this.list();
    let latestOwnerPresentation = Math.max(0, ...occurrences.filter((x) => x.row.destinationSession === policy.owner).flatMap((x) => [Date.parse(x.packet.presentedAt), ...x.receipts.filter((r) => r.action === "presented").map((r) => Date.parse(r.at))]));
    const records = this.deps.projection.records().sort((a, b) => Number(b.detector === "process.ceremony-amplification") - Number(a.detector === "process.ceremony-amplification") || a.id.localeCompare(b.id));
    for (const finding of records) {
      const qitemId = this.id(finding.id);
      const old = occurrences.find((o) => o.row.qitemId === qitemId);
      const base = { qitemId, findingId: finding.id };
      if (old && finding.status !== "active") {
        if (old.finding.status !== finding.status) {
          actions.push({ ...base, action: "observe" });
          if (apply) this.receipt(qitemId, actor, { action: "observed", finding });
        }
        continue;
      }
      if (finding.status !== "active" || !policy.detectors.includes(finding.detector)) continue;
      const age = now - Date.parse(finding.lastObservedAt ?? "");
      if (!Number.isFinite(age) || age < 0 || age > effective.policy.freshnessSeconds * 1000) {
        actions.push({ ...base, action: "deferred", reason: "source is stale or contradictory" }); continue;
      }
      if (old && (old.disposition || old.row.destinationSession !== policy.owner || !["pending", "in-progress"].includes(old.row.state)
        || old.receipts.filter((r) => r.action === "presented").length >= policy.maxRepresentations)) {
        actions.push({ ...base, action: "retained", reason: "existing disposition, custody, or recurrence bound" }); continue;
      }
      if (now - latestOwnerPresentation < policy.cooldownSeconds * 1000) {
        actions.push({ ...base, action: "deferred", reason: "owner cooldown" }); continue;
      }
      actions.push({ ...base, action: old ? "represent" : "create" });
      latestOwnerPresentation = now;
      if (!apply) continue;
      if (old) {
        // Reserve before awaiting transport: restart or another evaluation cannot re-send blindly.
        this.receipt(qitemId, actor, { action: "presented", finding, authority: this.deps.authority(finding) });
        await this.deps.queue.maybeNudge(qitemId, old.row.destinationSession, true, actor);
      } else {
        const packet: Packet = { schema: "openrig.health-diagnosis/v0alpha1", finding, policyVersion: effective.version,
          authority: this.deps.authority(finding), presentedAt: this.now(), instructions: `${instructions} Read current context and disposition with rig health diagnosis show ${qitemId}.` };
        await this.deps.queue.create({ qitemId, sourceSession: actor, destinationSession: policy.owner, body: JSON.stringify(packet, null, 2),
          tags: ["health-diagnosis", finding.id, `policy:${effective.version}`], summary: `System Health: inspect ${finding.detector}`, evidenceRef: finding.id });
      }
    }
    return { policyVersion: effective.version, enabled: true, actions };
  }
  dispose(qitemId: string, actor: string, value: unknown) {
    this.show(qitemId);
    const d = object(value, ["verdict", "causalStart", "steering", "uncertainty", "evidenceRefs"]);
    if (!DIAGNOSIS_VERDICTS.includes(d.verdict as HealthDisposition["verdict"]) || (d.causalStart !== null && typeof d.causalStart !== "string")
      || typeof d.steering !== "string" || !d.steering.trim() || typeof d.uncertainty !== "string" || !d.uncertainty.trim()
      || !Array.isArray(d.evidenceRefs) || !d.evidenceRefs.length || d.evidenceRefs.some((r) => typeof r !== "string" || !r.trim())) throw new Error("Invalid or incomplete health disposition");
    if (healthHash(this.show(qitemId).disposition) === healthHash(d)) return this.show(qitemId);
    this.receipt(qitemId, actor, { action: "disposition", disposition: d as unknown as HealthDisposition });
    return this.show(qitemId);
  }
  async notify(qitemId: string, actor: string) {
    const diagnosis = this.show(qitemId);
    const { human } = this.deps.policy.read().policy;
    const allowed = (human.conditions.includes("critical") && diagnosis.finding.severity === "critical" && diagnosis.finding.status === "active")
      || (human.conditions.includes("established pathology") && diagnosis.disposition?.verdict === "established pathology");
    if (!human.address || !allowed) throw new Error("health_human_policy_does_not_admit");
    const ready = await this.deps.humanReadiness?.(human.address);
    if (!ready?.ready) throw new Error(`health_human_readiness_unavailable: ${ready?.reason ?? "no verified delivery readiness"}`);
    const id = `qitem-health-human-${diagnosis.packet.finding.id}`;
    const row = this.deps.queue.getById(id) ?? await this.deps.queue.create({ qitemId: id, sourceSession: actor, destinationSession: human.address,
      body: JSON.stringify({ diagnosis: qitemId, finding: diagnosis.finding, disposition: diagnosis.disposition }, null, 2),
      summary: `System Health: ${diagnosis.finding.summary}`, evidenceRef: qitemId, tags: ["health-human", diagnosis.finding.id] });
    return { qitemId: row.qitemId, deliveryOutcome: row.deliveryOutcome ?? "pending", nextInspection: `rig queue transitions ${row.qitemId}` };
  }
}
