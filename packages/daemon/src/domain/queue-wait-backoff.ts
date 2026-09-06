import type Database from "better-sqlite3";
import { isDeepStrictEqual } from "node:util";
import type { WatchdogJob, WatchdogJobsRepository } from "./watchdog-jobs-repository.js";

interface WaitState {
  qitemId: string;
  blocker: string | null;
  blockerTransition: number | null;
  evidence: Record<string, unknown> | null;
  initialSeconds: number;
  maxSeconds: number;
  eventPending: boolean;
}

// Owned by the queue's atomic park, persisted on its existing watchdog job.
// Ordinary YAML watchdogs and one-shot park timers have no such metadata.
function readWait(job: WatchdogJob): { message: string; context: { queue_wait: WaitState } } | null {
  try {
    const spec = JSON.parse(job.specYaml);
    return spec.context?.queue_wait?.qitemId ? spec : null;
  } catch { return null; }
}

export function isQueueWait(specYaml: string): boolean {
  try { return Boolean(JSON.parse(specYaml).context?.queue_wait?.qitemId); }
  catch { return false; }
}

/** The exact blocker owns progress signals. Ignore delivery receipts; do not
 * interpret its notes. Our own waiting acknowledgments are on a different row. */
function blockerTransition(db: Database.Database, blocker: string | null): number | null {
  if (!blocker?.startsWith("qitem-")) return null;
  const row = db.prepare(`
      SELECT t.transition_id FROM queue_transitions t
      WHERE t.qitem_id = ? AND NOT EXISTS (
        SELECT 1 FROM queue_transition_wakes w WHERE w.transition_id = t.transition_id AND w.phase = 'fired'
      )
      ORDER BY t.transition_id DESC LIMIT 1
  `).get(blocker) as { transition_id: number } | undefined;
  return row?.transition_id ?? null;
}

export function armQueueWait(db: Database.Database, jobs: WatchdogJobsRepository, input: {
  previousJobId?: string;
  qitemId: string;
  blocker: string | null;
  evidence?: Record<string, unknown>;
  initialSeconds: number;
  maxSeconds: number;
  message: string;
  owner: string;
  actor: string;
}): WatchdogJob {
  const prior = input.previousJobId ? jobs.getById(input.previousJobId) : null;
  const old = prior?.state === "active" ? readWait(prior) : null;
  const state: WaitState = {
    qitemId: input.qitemId, blocker: input.blocker,
    blockerTransition: blockerTransition(db, input.blocker),
    evidence: input.evidence ?? old?.context.queue_wait.evidence ?? null,
    initialSeconds: input.initialSeconds, maxSeconds: input.maxSeconds, eventPending: false,
  };
  const unchanged = old && isDeepStrictEqual({ ...old.context.queue_wait, eventPending: false }, state);
  const specYaml = JSON.stringify({
    policy: "periodic-reminder", target: { session: input.owner }, message: input.message,
    context: { queue_wait: unchanged ? old.context.queue_wait : state },
  });
  if (prior && old && prior.targetSession === input.owner) {
    jobs.updateSchedule(prior.jobId, specYaml, unchanged ? prior.intervalSeconds : input.initialSeconds,
      unchanged ? prior.lastEvaluationAt : new Date().toISOString());
    return jobs.getByIdOrThrow(prior.jobId);
  }
  const job = jobs.register({ policy: "periodic-reminder", specYaml,
    targetSession: input.owner, intervalSeconds: input.initialSeconds, registeredBySession: input.actor });
  jobs.recordEvaluation(job.jobId, job.registeredAt, false);
  return job;
}

/** Event-first schedule update; also run once on startup to bridge an interrupted
 * event delivery. Replays compare durable transition identity and write nothing. */
export function refreshQueueWaits(db: Database.Database, jobs: WatchdogJobsRepository, changedQitem?: string): void {
  // ponytail: one scan of active watchdogs per queue event; index this metadata
  // if measured job volume makes the scan material. No second scheduler/store.
  for (const job of jobs.listActive()) {
    const spec = readWait(job);
    if (!spec) continue;
    const state = spec.context.queue_wait;
    if (changedQitem && state.blocker !== changedQitem) continue;
    const row = db.prepare("SELECT state, blocked_on FROM queue_items WHERE qitem_id = ?").get(state.qitemId) as { state: string; blocked_on: string | null } | undefined;
    if (!row || row.state !== "blocked" || row.blocked_on !== state.blocker) {
      jobs.markTerminal(job.jobId, "park_wait_ended");
      continue;
    }
    const current = blockerTransition(db, state.blocker);
    if (current === state.blockerTransition) continue;
    state.blockerTransition = current;
    state.eventPending = true;
    jobs.updateSchedule(job.jobId, JSON.stringify(spec), state.initialSeconds, null);
  }
}

/** Called after the existing watchdog delivers. Event wakes restart the initial
 * interval; unchanged timer wakes double it. The queue packet never changes. */
export function backOffQueueWait(jobs: WatchdogJobsRepository, jobId: string): boolean {
  const job = jobs.getById(jobId);
  const spec = job ? readWait(job) : null;
  if (!job || !spec) return false;
  const state = spec.context.queue_wait;
  const delay = state.eventPending ? state.initialSeconds : Math.min(job.intervalSeconds * 2, state.maxSeconds);
  state.eventPending = false;
  jobs.updateSchedule(jobId, JSON.stringify(spec), delay, job.lastFireAt ?? new Date().toISOString());
  return true;
}
