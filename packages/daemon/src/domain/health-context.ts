import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { HealthRecord } from "./health-projection.js";
import type { AuthorityReference } from "./health-diagnosis.js";
import type { HealthCheckpointSource } from "./health-checkpoints.js";
import { loadHumanRegistry } from "./gateway/human-registry.js";
import { loadConfig } from "./gateway/slack/config.js";
import { resolveSecret } from "./gateway/slack/secrets.js";
import { verifyScopes, verifyChannelMembership } from "./gateway/slack/slack-api.js";

export function healthAuthority(workspace: string, checkpoints: HealthCheckpointSource, record: HealthRecord): AuthorityReference[] {
  const lineage = record.evidence.find((e) => e.type === "queue-transition");
  const checkpoint = lineage?.type === "queue-transition" ? checkpoints.entries().find((c) => c.checkpoint.lineageQitemId === lineage.qitemId)?.checkpoint : undefined;
  const paths = new Set([join(workspace, "SPEC.md"), join(workspace, "project.yaml"),
    ...Object.values(checkpoint?.authorityPaths ?? {}).flat()]);
  if (record.scope.type === "mission" || record.scope.type === "slice") {
    paths.add(join(workspace, "missions", record.scope.missionId, "SPEC.md"));
    paths.add(join(workspace, "missions", record.scope.missionId, "mission.yaml"));
  }
  return [...paths].map((path) => {
    try {
      if (!/\.(md|yaml|yml)$/i.test(path) || statSync(path).size > 65536) return { path, state: "unavailable" };
      const content = readFileSync(path, "utf8");
      return { path, state: "available", content, sha256: createHash("sha256").update(content).digest("hex") };
    } catch { return { path, state: "unavailable" }; }
  });
}

/** Connector-specific readiness lives behind the transport-neutral diagnosis port.
 * No notification is posted here; the existing gateway owns posting and receipts. */
export async function healthHumanReadiness(home: string, address: string, gatewayActive: boolean) {
  const registry = loadHumanRegistry(home);
  const human = registry.ok ? registry.entities.find((h) => h.address === address) : undefined;
  const primary = human?.connectorBindings.find((b) => b.role === "primary");
  if (!human || primary?.kind !== "slack") return { ready: false, reason: "registered human primary connector unavailable" };
  const cfg = loadConfig(home);
  if (!gatewayActive || !cfg.enabled || !cfg.channel || (cfg.outboundDestinations.length > 0 && !cfg.outboundDestinations.includes(address))) return { ready: false, reason: "gateway disabled, channel missing, or destination excluded" };
  const token = resolveSecret("SLACK_BOT_TOKEN", { envFile: cfg.secretsEnvFile ?? undefined });
  if (!token) return { ready: false, reason: "connector token unavailable" };
  const scopes = await verifyScopes(token, [...new Set([...cfg.requiredScopes, "chat:write"])]);
  if (!scopes.ok) return { ready: false, reason: `connector scope verification failed: ${scopes.error ?? scopes.missing.join(", ")}` };
  const channel = await verifyChannelMembership(token, cfg.channel);
  return { ready: channel.ok && channel.isMember, reason: channel.ok && channel.isMember ? "verified scopes and channel membership" : "connector membership could not be verified" };
}
