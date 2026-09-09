import { fieldLine, wrapDetailLines, type ContentLine } from "../detail.js";

export interface ConfigEntry {
  key: string;
  group: "general" | "slack" | "people" | "hosts" | "health";
  value: string | number | boolean | null;
  defaultValue: string | number | boolean | null;
  defaultKnown?: boolean;
  subject?: string;
  source: string;
  visibility: "shown" | "withheld" | "unavailable";
  reason: string | null;
  scope: string;
  application: string;
}
export interface ConfigRead {
  observedAt: string; home: string | null; readOnly: boolean;
  sources: Array<{ id: string; state: string; path: string | null; detail: string }>;
  entries: ConfigEntry[]; exclusions: string[];
}
export const CONFIG_CATEGORIES = [
  { id: "instance", label: "Instance & work" },
  { id: "context", label: "Context & skills" },
  { id: "display", label: "Display & terminals" },
  { id: "waiting", label: "Workflows & waiting" },
  { id: "recovery", label: "Recovery & snapshots" },
  { id: "activity", label: "Activity & retention" },
  { id: "agents", label: "Agents & runtime" },
  { id: "slack", label: "Slack & people" },
  { id: "all", label: "All settings / search" },
  { id: "sources", label: "Sources & coverage" },
] as const;
export function configCategory(entry: ConfigEntry): string {
  if (entry.group === "slack" || entry.group === "people") return "slack";
  if (entry.group === "hosts") return "instance";
  if (entry.group === "health") return "context";
  const key = entry.key;
  if (/^(daemon|host|db|workspace|files|progress)\./.test(key)) return "instance";
  if (/^(topology|context|skills|onboarding|health)\./.test(key)) return "context";
  if (/^(ui|terminal)\./.test(key)) return "display";
  if (/^(workflow|queue|policies\.idle_gate_qitem)\./.test(key)) return "waiting";
  if (/^(recovery|snapshots|policies\.claude_compaction)\./.test(key)) return "recovery";
  if (/^(transcripts|feed|retention)\./.test(key)) return "activity";
  if (/^(agents|runtime)\./.test(key)) return "agents";
  return "all"; // Future registry additions remain discoverable without an inventory fork.
}
const LABELS: Record<string, string> = {
  "host.name": "Instance name", "host.selected": "Selected host",
  "workspace.root": "Workspace", "workspace.slices_root": "Mission folders",
  "workspace.projects_root": "Project folders", "workspace.specs_root": "Spec folders",
  "workspace.steering_path": "Steering file", "workspace.catalog_path": "Workspace catalog",
  "workspace.operator_seat_name": "Operator seat", "db.path": "Database",
  "topology.root": "Topology root", "context.root": "Context root", "skills.root": "Skills root",
  "ui.timezone": "Timezone", "workflow.exception_routing": "Exception routing",
  "queue.wake_retry_interval_seconds": "Retry interval", "queue.wake_retry_cap": "Retry limit",
  "queue.wake_unconfirmed_window_minutes": "Unconfirmed window", "queue.wake_swap_grace_seconds": "Post-swap grace",
  "queue.pickup_stall_threshold_minutes": "Stall threshold", "queue.stuck_sweep_interval_seconds": "Stuck sweep cadence",
  "queue.stuck_sweep_unclaimed_age_minutes": "Unclaimed age", "policies.idle_gate_qitem.auto_register": "Auto-registration",
  "snapshots.periodic.enabled": "Periodic snapshots", "snapshots.periodic.interval_seconds": "Snapshot interval",
  "snapshots.periodic.retention_keep": "Snapshots to retain", "ui.terminal.max_live_terminals": "Legacy web terminal limit",
  "retention.usage_samples_days": "Usage sample retention",
  "transcripts.poll_interval_seconds": "Transcript refresh", "transcripts.lines": "Transcript lines",
  "ui.preview.refresh_interval_seconds": "Preview refresh", "ui.preview.max_pins": "Preview pins",
  "ui.preview.default_lines": "Preview lines", "context.system_world": "System world",
  "onboarding.default_pack.enabled": "Default onboarding pack",
  "health.context_pressure.warning_percent": "Context warning threshold",
  "health.context_pressure.critical_percent": "Context critical threshold",
  "recovery.auto_drive_provider_prompts": "Drive provider prompts",
  "recovery.provider_auth_env_allowlist": "Auth environment names",
  "policies.claude_compaction.enabled": "Claude compaction",
  "policies.claude_compaction.threshold_percent": "Compaction threshold",
  "policies.claude_compaction.pre_compact_instruction": "Before compaction instruction",
  "policies.claude_compaction.compact_instruction": "Compaction instruction",
  "policies.claude_compaction.message_inline": "Restore instruction",
  "policies.claude_compaction.message_file_path": "Restore instruction file",
  "policies.claude_compaction.post_restore_audit_instruction": "Restore audit instruction",
  "policies.idle_gate_qitem.scan_interval_seconds": "Idle-gate scan interval",
  "policies.idle_gate_qitem.active_wake_interval_seconds": "Active-wake interval",
  "policies.idle_gate_qitem.opt_in_sessions": "Opt-in sessions",
  "slack.credentialFile": "Credential file reference", "slack.botToken": "Bot credential",
  "slack.appToken": "Socket Mode credential", "slack.requiredScopes": "Required scopes",
  "slack.minimumLevelThatPosts": "Minimum posting level", "slack.minimumLevelThatInterrupts": "Minimum interrupt level",
  "feed.subscriptions.action_required": "Action-required feed", "feed.subscriptions.approvals": "Approval feed",
  "feed.subscriptions.shipped": "Shipped feed", "feed.subscriptions.progress": "Progress feed", "feed.subscriptions.audit_log": "Audit feed",
};
function words(value: string): string {
  const s = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function configLabel(entry: ConfigEntry): string {
  if (entry.subject) return entry.subject + " · " + words(entry.key.split(".").slice(2).join(".").replace(/^bindings\.[^.]+\./, "Binding "));
  return LABELS[entry.key] ?? words(entry.key.replace(/^(?:slack|health\.policy)\./, ""));
}
export function configEntries(read: ConfigRead | null, category: string, query = ""): ConfigEntry[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (read?.entries ?? []).filter((e) => (category === "all" || configCategory(e) === category)
    && words.every((word) => (configLabel(e) + " " + e.key).toLocaleLowerCase().includes(word)));
}
export function configValue(entry: ConfigEntry, defaultValue = false): string {
  if (defaultValue && entry.defaultKnown === false) return "Not reported";
  if (entry.visibility === "unavailable" && !defaultValue) return "Unavailable";
  if (entry.visibility === "withheld") return "Contents withheld";
  const v = defaultValue ? entry.defaultValue : entry.value;
  if (entry.key === "slack.outboundDestinations" && v === "") return "All registered humans";
  if (typeof v === "boolean" && /(?:credentialFile|credentialReference|bearer_env|bearer_file)$/.test(entry.key)) return v ? "Present" : "Missing";
  if (v === null || v === "") return "Unset";
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (typeof v === "number") {
    if (entry.key.endsWith("_seconds") || entry.key.endsWith("Seconds")) return v >= 60 && v % 60 === 0 ? v / 60 + " min" : v + " sec";
    if (entry.key.endsWith("_minutes")) return v + " min";
    if (entry.key.endsWith("_days")) return v + " days";
    if (entry.key.endsWith("_percent")) return v + "%";
  }
  return String(v);
}
function clip(text: string, width: number): string {
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + "…";
}
export function configListLines(entries: ConfigEntry[], width: number, selectedKey?: string): ContentLine[] {
  const room = Math.max(20, width);
  const labelWidth = Math.max(8, Math.floor(room * .5) - 2);
  const valueWidth = Math.max(5, room - labelWidth - 16);
  return entries.map((e) => ({ text: (e.key === selectedKey ? "> " : "  ")
    + clip(configLabel(e), labelWidth).padEnd(labelWidth) + " "
    + clip(configValue(e), valueWidth).padEnd(valueWidth) + " " + clip(e.source, 11) }));
}
export function configDetailLines(read: ConfigRead | null, key: string, width: number): ContentLine[] {
  const e = read?.entries.find((entry) => entry.key === key);
  if (!e) return wrapDetailLines([{ text: "Setting unavailable after refresh. Return to the list." }], width);
  const source = read?.sources.find((s) => s.id === e.group);
  const lines: ContentLine[] = [{ text: configLabel(e) }, { text: "" },
    fieldLine({ label: "key", value: e.key }), fieldLine({ label: "scope", value: e.scope }),
    fieldLine({ label: "value", value: configValue(e) }), fieldLine({ label: "default", value: configValue(e, true) }),
    fieldLine({ label: "source", value: e.source + (source ? " · " + source.state : "") }),
    fieldLine({ label: "application", value: e.application })];
  if (e.reason) lines.push(fieldLine({ label: "visibility", value: e.reason }));
  if (source) lines.push(fieldLine({ label: "source path", value: source.path ?? "Withheld / unavailable" }),
    { text: source.detail });
  if (e.key === "retention.usage_samples_days" || e.key === "ui.terminal.max_live_terminals") {
    lines.push({ text: "Daemon read supported; this key is absent from the current CLI setter registry." });
  }
  return wrapDetailLines(lines, width);
}
export function configSourceLines(read: ConfigRead | null, width: number): ContentLine[] {
  if (!read) return wrapDetailLines([{ text: "CONFIG unavailable. Refresh or inspect the displayed daemon." }], width);
  return wrapDetailLines([
    { text: "Sources & coverage" },
    ...read.sources.flatMap((s) => [fieldLine({ label: s.id, value: s.state }), { text: s.detail }]),
    { text: "" }, ...read.exclusions.map((text) => ({ text })),
    { text: "Resolved settings describe the daemon instance. Client display and rig declarations retain their own scopes." },
  ], width);
}
