import { readFileSync, statSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { createHash } from "node:crypto";
import { resolveAllowedFile } from "./files/path-safety.js";
import type { HealthRecord } from "./health-projection.js";
import { healthEpisodeId } from "./health-projection.js";
import type { AuthorityReference } from "./health-diagnosis.js";
import type { HealthCheckpointSource } from "./health-checkpoints.js";
import { loadHumanRegistry } from "./gateway/human-registry.js";
import { loadConfig } from "./gateway/slack/config.js";
import { resolveSecret } from "./gateway/slack/secrets.js";
import { verifyScopes, verifyChannelMembership } from "./gateway/slack/slack-api.js";

/** Local evidence files only. Unsupported addresses retain unavailable truth.
 * Reuse the file surface's realpath resolver; callers choose whether to embed bytes. */
export function readHealthArtifact(workspace: string, path: string, maxBytes = 1048576, embed = false): AuthorityReference {
  try {
    const root = realpathSync(workspace);
    const canonical = resolveAllowedFile([{ name: "workspace", canonicalPath: root }], "workspace", relative(resolve(workspace), resolve(workspace, path)));
    const size = statSync(canonical).size;
    if (size === 0 || size > maxBytes) return { path, state: "unavailable" };
    const bytes = readFileSync(canonical);
    return { path, state: "available", ...(embed ? { content: bytes.toString("utf8") } : {}), sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch { return { path, state: "unavailable" }; }
}

type AuthorityLevel = NonNullable<AuthorityReference["level"]>;

/** Only read a canonical file at the selected work-tree node; aliases are unavailable. */
function readAuthorityFile(workspace: string, path: string): AuthorityReference {
  try {
    const selected = relative(resolve(workspace), resolve(workspace, path));
    const actual = relative(realpathSync(workspace), realpathSync(resolve(workspace, path)));
    if (actual !== selected) return { path, state: "unavailable" };
    return readHealthArtifact(workspace, path, 65536, true);
  } catch { return { path, state: "unavailable" }; }
}

export function healthAuthority(workspace: string, checkpoints: HealthCheckpointSource, record: HealthRecord): AuthorityReference[] {
  const checkpoint = record.detector === "process.ceremony-amplification" ? checkpoints.entries().find((c) => healthEpisodeId(record.detector, c.checkpoint.scope, c.episodeStartedAt) === record.id)?.checkpoint : undefined;
  const scope = record.scope;
  const mission = (scope.type === "mission" || scope.type === "slice") && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(scope.missionId) ? scope.missionId : null;
  const groups: Record<AuthorityLevel, string[]> = {
    project: [join(workspace, "SPEC.md"), join(workspace, "project.yaml"), ...checkpoint?.authorityPaths.project ?? []],
    mission: [...(mission ? [join(workspace, "missions", mission, "SPEC.md"), join(workspace, "missions", mission, "mission.yaml")] : []), ...checkpoint?.authorityPaths.mission ?? []],
    slice: [...checkpoint?.authorityPaths.slice ?? [], ...record.ceremony?.context.filter((r) => r.role.startsWith("slice authority")).map((r) => r.path).filter((p) => /(?:SPEC\.md|slice\.yaml)$/.test(p)) ?? []],
  };
  const belongs = (level: AuthorityLevel, path: string): boolean => {
    const parts = relative(resolve(workspace), resolve(workspace, path)).split("/");
    if (level === "project") return parts.length === 1 && ["SPEC.md", "project.yaml"].includes(parts[0]!);
    if (!mission || parts[0] !== "missions" || parts[1] !== mission) return false;
    if (level === "mission") return parts.length === 3 && ["SPEC.md", "mission.yaml"].includes(parts[2]!);
    if (scope.type !== "slice" || parts.length !== 5 || parts[2] !== "slices" || !["SPEC.md", "slice.yaml"].includes(parts[4]!)) return false;
    // Directory names are not slice IDs. The canonical sibling SPEC owns identity.
    const spec = readAuthorityFile(workspace, join(workspace, ...parts.slice(0, 4), "SPEC.md"));
    const frontmatter = spec.content?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!frontmatter) return false;
    const identity = parseYaml(frontmatter) as { id?: unknown; mission?: unknown } | null;
    return identity?.id === scope.sliceId && (identity.mission === undefined || identity.mission === mission);
  };
  return (Object.keys(groups) as AuthorityLevel[]).flatMap((level) => [...new Set(groups[level])].map((path) => {
    try {
      return { ...(belongs(level, path) ? readAuthorityFile(workspace, path) : { path, state: "unavailable" as const }), level };
    } catch { return { path, state: "unavailable" as const, level }; }
  }));
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
