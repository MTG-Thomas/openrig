import { Command, InvalidArgumentError, Option } from "commander";
import {
  HEALTH_SEVERITIES,
  HEALTH_STATUSES,
  type HealthRecord,
  type HealthScope,
} from "@openrig/daemon/health-projection";
import type { HealthListProjection } from "@openrig/daemon/health-detectors";
import {
  DaemonClient,
  DaemonConnectionError,
  DaemonResponseError,
  DaemonTimeoutError,
} from "../client.js";
import {
  getDaemonStatus,
  getDaemonUrl,
  statusGuardMessage,
} from "../daemon-lifecycle.js";
import { realDeps } from "./daemon.js";
import { resolveIdentitySource } from "./whoami.js";
import type { StatusDeps } from "./status.js";

const HEALTH_ERROR_SCHEMA = "openrig.health-error/v0alpha1" as const;

type IdentitySource = { nodeId?: string; sessionName?: string };

export interface HealthDeps extends StatusDeps {
  resolveIdentity: () => IdentitySource | null;
}

interface HealthListOptions {
  self?: boolean;
  seat?: string;
  rig?: string;
  instance?: string | boolean;
  severity?: string;
  status?: string;
  limit?: number;
  json?: boolean;
}

interface HealthCliError {
  schema: typeof HEALTH_ERROR_SCHEMA;
  error: string;
  message: string;
  nextInspection: string;
  details?: unknown;
}

function defaultDeps(): HealthDeps {
  return {
    lifecycleDeps: realDeps(),
    clientFactory: (baseUrl: string) => new DaemonClient(baseUrl),
    resolveIdentity: () => resolveIdentitySource({}),
  };
}

function parseLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new InvalidArgumentError("must be an integer from 1 to 200");
  }
  return parsed;
}

function emitError(error: HealthCliError, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(error));
  } else {
    console.error(`Error: ${error.message}`);
    console.error(`  Next inspection: ${error.nextInspection}`);
  }
  process.exitCode = 1;
}

function daemonError(details: unknown): HealthCliError {
  return {
    schema: HEALTH_ERROR_SCHEMA,
    error: "health_daemon_unavailable",
    message: "The health projection could not be read because the daemon did not respond.",
    nextInspection: "rig daemon status",
    details,
  };
}

function responseError(status: number, data: unknown): HealthCliError {
  const daemonCode = typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error
    : null;
  if (status === 503 && daemonCode === "health_projection_unavailable") {
    return {
      schema: HEALTH_ERROR_SCHEMA,
      error: daemonCode,
      message: "The daemon is reachable, but its health projection is unavailable.",
      nextInspection: "rig daemon status",
    };
  }
  if (status === 404 && daemonCode === "health_finding_not_found") {
    return {
      schema: HEALTH_ERROR_SCHEMA,
      error: daemonCode,
      message: "No health finding exists with that ID in the current projection.",
      nextInspection: "rig health --instance --json",
    };
  }
  if (status === 404 && daemonCode === "not_found") {
    return {
      schema: HEALTH_ERROR_SCHEMA,
      error: "health_projection_unavailable",
      message: "The daemon is reachable, but it does not expose the health projection.",
      nextInspection: "rig --version",
      details: data,
    };
  }
  return {
    schema: HEALTH_ERROR_SCHEMA,
    error: "health_query_failed",
    message: `The daemon rejected the health query (HTTP ${status}).`,
    nextInspection: "rig health --help",
    details: data,
  };
}

async function readyClient(deps: HealthDeps, json: boolean): Promise<DaemonClient | null> {
  const status = await getDaemonStatus(deps.lifecycleDeps);
  if (status.state !== "running" || status.healthy === false) {
    emitError(daemonError(statusGuardMessage(status)), json);
    return null;
  }
  return deps.clientFactory(getDaemonUrl(status));
}

async function readSelfSeatId(client: DaemonClient, deps: HealthDeps, json: boolean): Promise<string | null> {
  const source = deps.resolveIdentity();
  if (!source) {
    emitError({
      schema: HEALTH_ERROR_SCHEMA,
      error: "health_identity_unavailable",
      message: "The current seat identity is unavailable, so self health cannot be scoped safely.",
      nextInspection: "rig whoami --json",
    }, json);
    return null;
  }

  const params = new URLSearchParams();
  if (source.nodeId) params.set("nodeId", source.nodeId);
  else if (source.sessionName) params.set("sessionName", source.sessionName);
  params.set("compact", "1");
  const response = await client.get<Record<string, unknown>>(`/api/whoami?${params.toString()}`);
  if (response.status === 409) {
    emitError({
      schema: HEALTH_ERROR_SCHEMA,
      error: "health_identity_ambiguous",
      message: "More than one managed seat matches the current identity.",
      nextInspection: "rig ps --nodes -A",
      details: response.data,
    }, json);
    return null;
  }
  if (response.status >= 400) {
    emitError({
      schema: HEALTH_ERROR_SCHEMA,
      error: "health_identity_unavailable",
      message: "The daemon could not resolve the current seat identity.",
      nextInspection: "rig whoami --json",
      details: response.data,
    }, json);
    return null;
  }
  const identity = response.data["identity"];
  const nodeId = typeof identity === "object" && identity !== null
    ? (identity as Record<string, unknown>)["nodeId"]
    : null;
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    emitError({
      schema: HEALTH_ERROR_SCHEMA,
      error: "health_identity_indeterminate",
      message: "The identity response did not carry a stable node ID, so self health is indeterminate.",
      nextInspection: "rig whoami --full --json",
      details: response.data,
    }, json);
    return null;
  }
  return nodeId;
}

function scopeLabel(scope: HealthScope): string {
  switch (scope.type) {
    case "instance": return `instance:${scope.instanceId}`;
    case "rig": return `rig:${scope.rigId}`;
    case "seat": return `seat:${scope.seatId}`;
    case "mission": return `mission:${scope.missionId}`;
    case "slice": return `slice:${scope.sliceId}`;
  }
}

function renderList(projection: HealthListProjection): void {
  const evaluated = projection.evaluatedAt ?? "unavailable";
  console.log(`Fleet health — evaluated=${evaluated} findings=${projection.total} limit=${projection.limit}`);
  if (projection.records.length === 0) {
    console.log("No health findings match this bounded query. This is not a healthy assertion.");
    console.log("Next inspection: widen only as needed with `rig health --instance --json`.");
    return;
  }
  for (const record of projection.records) {
    console.log(`${record.id}  ${record.severity}  ${record.status}  ${record.detector}`);
    console.log(`  ${scopeLabel(record.scope)}  ${record.confidence} confidence  freshness=${record.freshness.state}${record.indeterminateReason ? `  indeterminate=${record.indeterminateReason}` : ""}`);
    console.log(`  ${record.summary}`);
  }
  if (projection.truncated) {
    console.log(`Truncated at ${projection.limit} of ${projection.total}; narrow the scope or raise --limit (maximum 200).`);
  }
}

function renderExplanation(record: HealthRecord): void {
  console.log(`Health finding ${record.id}`);
  console.log(`  Detector:    ${record.detector} (${record.category})`);
  console.log(`  Scope:       ${scopeLabel(record.scope)}`);
  console.log(`  Outcome:     ${record.severity} / ${record.status} / ${record.confidence} confidence`);
  console.log(`  Observed:    ${record.startedAt ?? "unavailable"} → ${record.lastObservedAt ?? "unavailable"}`);
  console.log(`  Window:      ${record.window.startedAt} → ${record.window.endedAt}; source=${record.window.source}; limit=${record.window.limit}; retention=${record.window.retentionSeconds}s`);
  console.log(`  Freshness:   ${record.freshness.state}; evaluated=${record.freshness.evaluatedAt}; newest=${record.freshness.newestSourceAt ?? "unavailable"}; max-age=${record.freshness.maxAgeSeconds}s; age=${record.freshness.ageSeconds ?? "unavailable"}s`);
  if (record.indeterminateReason) console.log(`  Indeterminate: ${record.indeterminateReason}`);
  console.log(`  Rule:        ${record.threshold}`);
  console.log(`  Explanation: ${record.explanation}`);
  console.log(`  Evidence:    ${JSON.stringify(record.evidence)}`);
  console.log(`  Inspect:     ${record.suggestedInspection}`);
}

async function guardedRequest<T>(
  request: () => Promise<{ status: number; data: T }>,
  json: boolean,
): Promise<{ status: number; data: T } | null> {
  try {
    return await request();
  } catch (error) {
    const details = error instanceof DaemonTimeoutError
      ? { kind: "timeout", message: error.message }
      : error instanceof DaemonResponseError
        ? { kind: "unreadable-response", status: error.status, bodySnippet: error.bodySnippet }
        : error instanceof DaemonConnectionError
          ? { kind: "connection", message: error.message }
          : { kind: "unexpected", message: error instanceof Error ? error.message : String(error) };
    emitError(daemonError(details), json);
    return null;
  }
}

export function healthCommand(depsOverride?: HealthDeps): Command {
  const deps = depsOverride ?? defaultDeps();
  const command = new Command("health")
    .description("Inspect read-only, explainable system health records")
    .addOption(new Option("--self", "Inspect the current seat (default)").conflicts(["seat", "rig", "instance"]))
    .addOption(new Option("--seat <node-id>", "Inspect one seat by stable node ID").conflicts(["self", "rig", "instance"]))
    .addOption(new Option("--rig <rig-id>", "Inspect findings whose canonical scope is this rig").conflicts(["self", "seat", "instance"]))
    .addOption(new Option("--instance [instance-id]", "Inspect the whole local instance, or one canonical instance scope by ID").conflicts(["self", "seat", "rig"]))
    .addOption(new Option("--severity <severity>", "Filter by severity").choices([...HEALTH_SEVERITIES]))
    .addOption(new Option("--status <status>", "Filter by finding status").choices([...HEALTH_STATUSES]))
    .option("--limit <count>", "Maximum findings (1-200)", parseLimit, 100)
    .option("--json", "Emit the canonical daemon health projection as JSON")
    .addHelpText("after", `
The default scope is the current seat. --instance without an ID is the bounded
instance-wide projection. Empty output is not a healthy assertion. This command
never acknowledges, snoozes, notifies, queues, reroutes, relaunches, or remediates.`);

  command.action(async (options: HealthListOptions) => {
    const json = Boolean(options.json);
    const client = await readyClient(deps, json);
    if (!client) return;

    let scopeType: HealthScope["type"] | undefined;
    let scopeId: string | undefined;
    if (options.seat) {
      scopeType = "seat";
      scopeId = options.seat;
    } else if (options.rig) {
      scopeType = "rig";
      scopeId = options.rig;
    } else if (typeof options.instance === "string") {
      scopeType = "instance";
      scopeId = options.instance;
    } else if (!options.instance) {
      const seatId = await guardedRequest(
        () => readSelfSeatId(client, deps, json).then((data) => ({ status: data === null ? 1 : 0, data })),
        json,
      );
      if (!seatId || seatId.data === null) return;
      scopeType = "seat";
      scopeId = seatId.data;
    }

    const params = new URLSearchParams();
    if (scopeType && scopeId) {
      params.set("scope_type", scopeType);
      params.set("scope_id", scopeId);
    }
    params.set("limit", String(options.limit ?? 100));
    if (options.severity) params.set("severity", options.severity);
    if (options.status) params.set("status", options.status);
    const response = await guardedRequest(
      () => client.get<HealthListProjection>(`/api/health?${params.toString()}`),
      json,
    );
    if (!response) return;
    if (response.status >= 400) {
      emitError(responseError(response.status, response.data), json);
      return;
    }
    if (json) console.log(JSON.stringify(response.data));
    else renderList(response.data);
  });

  command
    .command("explain <finding-id>")
    .description("Explain one health finding from its canonical bounded record")
    .option("--json", "Emit the canonical daemon health record as JSON")
    .action(async (findingId: string, options: { json?: boolean }) => {
      const json = Boolean(options.json || command.opts().json);
      const client = await readyClient(deps, json);
      if (!client) return;
      const response = await guardedRequest(
        () => client.get<HealthRecord>(`/api/health/${encodeURIComponent(findingId)}`),
        json,
      );
      if (!response) return;
      if (response.status >= 400) {
        emitError(responseError(response.status, response.data), json);
        return;
      }
      if (json) console.log(JSON.stringify(response.data));
      else renderExplanation(response.data);
    });

  return command;
}
