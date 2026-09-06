/** Receipt evidence only: complete input and its closed native turn, never comprehension. */
export function analyzeWalkSuffix(suffix: string, content: string): { consumed: boolean; turnClosed: boolean } {
  // CRLF and surrounding whitespace are the only permitted transport normalization.
  // Internal whitespace (including code indentation) remains content.
  const canonical = (text: string) => text.replace(/\r\n/g, "\n").trim();
  const expected = canonical(content);
  const textOf = (value: unknown): string => typeof value === "string" ? value
    : Array.isArray(value) ? value.map(b => (b?.type === "text" || b?.type === "input_text") && typeof b.text === "string" ? b.text : "").join("") : "";
  let consumed = false;
  const descendants = new Set<string>();
  let sawAssistant = false;
  let activeTurn: string | undefined;
  let matchedTurn: string | undefined;
  for (const line of suffix.split("\n").slice(0, -1)) { // unfinished appends are not evidence
    let rec: {
      type?: string; subtype?: string; uuid?: string; parentUuid?: string; isSidechain?: boolean; isMeta?: boolean;
      message?: { role?: string; content?: unknown };
      payload?: { type?: string; role?: string; content?: unknown; turn_id?: string };
    };
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || rec.isSidechain) continue;
    if (rec.type === "compacted") return { consumed, turnClosed: false };
    const p = rec.payload;
    if (rec.type === "event_msg" && p?.type === "task_started") {
      activeTurn = typeof p.turn_id === "string" ? p.turn_id : undefined;
    }
    if (rec.type === "turn_context" && activeTurn !== p?.turn_id) activeTurn = undefined;
    if (rec.type === "response_item" && p?.type === "message" && p.role === "user"
      && expected && canonical(textOf(p.content)) === expected) {
      consumed = true;
      matchedTurn = activeTurn;
    }
    if (rec.type === "event_msg" && p?.type === "task_complete") {
      if (matchedTurn && activeTurn === matchedTurn && p.turn_id === matchedTurn) return { consumed: true, turnClosed: true };
      if (p.turn_id === activeTurn) activeTurn = undefined;
    }
    if (rec.type === "user" && rec.message?.role === "user") {
      const value = rec.message.content;
      const toolResult = Array.isArray(value) && value.some(b => b?.type === "tool_result");
      if (!toolResult && !rec.isMeta) {
        descendants.clear();
        sawAssistant = false;
        if (expected && canonical(textOf(value)) === expected) {
          consumed = true;
          if (typeof rec.uuid === "string") descendants.add(rec.uuid);
        }
        continue;
      }
    }
    // Claude tool results and hook summaries also carry parentUuid, so walk the actual
    // ancestry rather than blessing the next turn_duration in append order.
    if (typeof rec.uuid === "string" && rec.parentUuid && descendants.has(rec.parentUuid)) {
      descendants.add(rec.uuid);
      if (rec.type === "assistant" && rec.message?.role === "assistant") sawAssistant = true;
      if (sawAssistant && rec.type === "system" && rec.subtype === "turn_duration") return { consumed: true, turnClosed: true };
    }
  }
  return { consumed, turnClosed: false };
}
