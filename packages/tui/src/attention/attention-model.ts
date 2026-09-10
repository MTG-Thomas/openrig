import type { FleetSnapshot, ViewState } from "../types.js";
import { listItem, wrapDetailLines, type ContentLine } from "../detail.js";

export function attentionLines(state: ViewState, snap: FleetSnapshot, width: number): ContentLine[] {
  const read = snap.attentionRead;
  const lines: ContentLine[] = [{ text: "ATTENTION · INSTANCE" }];
  if (!read) return wrapDetailLines([...lines, { text: "Unavailable: Attention sources have not answered." }, ...snap.readErrors.map(text => ({ text }))], width);
  if (state.attentionOpen) {
    const d = read.detail;
    lines.push(listItem("Back", { type: "back" }));
    if (!d || d.item.id !== state.attentionOpen) lines.push({ text: read.detailError ?? "Selected source unavailable." });
    else {
      lines.push({ text: `${d.item.kind === "action" ? "Action required" : "Update"} · ${d.item.urgency}` }, { text: d.item.summary });
      if (d.item.unblocks) lines.push({ text: `Unblocks: ${d.item.unblocks}` });
      lines.push({ text: `Scope: ${d.item.scope}` }, { text: `Observed: ${d.item.at ?? "unknown"}` });
      for (const f of d.files) lines.push(listItem(f.label, { type: "attention-source", path: f.path }));
      lines.push({ text: `Source: ${d.item.source}` }, ...d.lines.map(text => ({ text })));
    }
  } else {
    const bad = read.sources.filter(s => s.state !== "available");
    if (bad.length) lines.push({ text: "Some sources unavailable or partial; this feed is incomplete." });
    for (const [kind, title] of [["action", "Action required"], ["update", "Updates"]] as const) {
      lines.push({ text: "" }, { text: title });
      const items = read.items.filter(i => i.kind === kind && (!state.filter || `${i.summary} ${i.scope}`.toLowerCase().includes(state.filter.toLowerCase())));
      if (!items.length) lines.push({ text: state.filter ? "  No matches in the served items." : bad.some(s => kind === "action" ? s.source === "queue" : s.source !== "queue") ? "  Unknown: a required source is unavailable or partial." : "  No current items in the available source window." });
      for (const i of items) {
        lines.push(listItem(`[${i.urgency}] ${i.summary}`, { type: "attention-open", id: i.id }));
        if (i.unblocks) lines.push({ text: `    Unblocks: ${i.unblocks}` });
        lines.push({ text: `    ${i.scope} · ${i.at ?? "time unknown"}` });
      }
    }
    lines.push({ text: "" }, { text: `Read at ${read.readAt}` }, ...read.sources.map(s => ({ text: `${s.source}: ${s.state} · ${s.detail}` })));
  }
  lines.push({ text: "" }, { text: "Viewing is not approval. Required Slack decisions still apply." });
  return wrapDetailLines(lines, width);
}
