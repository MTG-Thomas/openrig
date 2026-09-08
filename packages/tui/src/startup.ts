import { DaemonClient, StartupRequestError } from "./daemon-client.js";
import { probeCrashCart, type CrashCartRenderOpts } from "./crash-cart/from-emit.js";
import type { Action } from "./types.js";

export interface StartupSeat {
  logicalId: string; nodeId: string; runtime: string; model: string | null;
  revision: string; hasHistory: boolean; intendedAction: string; reason?: string;
  freshRequired: boolean; tokenState: string;
  freshAllowed?: boolean; prerequisite?: string;
  observed: { state: string; detail: string; sessionName: string };
}
interface StartupRig { rigId: string; rigName: string; seats: StartupSeat[] }
export interface StartupState {
  open: boolean; busy: boolean; page: "probe" | "down" | "unavailable" | "rigs" | "seats" | "kernel" | "confirm";
  target: string; home: string; notice: string; detail: string; expanded: boolean;
  selected: number; scroll: number; rigs: Array<{ id: string; name: string }>;
  rig?: StartupRig; probe?: CrashCartRenderOpts; freshBlocked?: string;
  prerequisites?: { codex: string; claudeCode: string };
  consent?: { rigId: string; seat: StartupSeat };
}
export interface StartupDeps {
  client: DaemonClient;
  home: string;
  probe: () => Promise<string>;
  startDaemon: () => Promise<void>;
  onChange: () => void;
  onWork: (rig?: StartupRig, seat?: StartupSeat) => void;
}

export class StartupController {
  readonly state: StartupState;
  constructor(private readonly deps: StartupDeps) {
    this.state = { open: true, busy: false, page: "probe", target: deps.client.baseUrl,
      home: deps.home, notice: "Reading startup state…", detail: "", expanded: false,
      selected: 0, scroll: 0, rigs: [] };
  }
  private changed() { this.deps.onChange(); }
  private async run(action: () => Promise<void>) {
    if (this.state.busy) return;
    this.state.busy = true;
    this.changed();
    try { await action(); }
    catch (error) {
      this.state.notice = error instanceof Error ? error.message : String(error);
      this.state.detail = this.state.notice;
      if (error instanceof StartupRequestError && (error.status === 401 || error.status === 403 || error.result.freshAllowed === false)) {
        this.state.freshBlocked = this.state.notice;
      }
    } finally { this.state.busy = false; this.changed(); }
  }
  async open() { this.state.open = true; await this.refresh(); }
  async refresh() {
    await this.run(async () => {
      this.state.consent = undefined;
      this.state.notice = "Reading actual state…";
      const probe = await probeCrashCart(this.deps.probe);
      this.state.probe = probe;
      if (probe.unavailable || probe.daemonState === "unverified") {
        this.state.page = "unavailable";
        this.state.notice = "Startup state is unavailable. No recovery effect has been authorized.";
        this.state.detail = probe.unavailable ?? JSON.stringify(probe.daemonEvidence);
        return;
      }
      if (probe.daemonState === "down") {
        this.state.page = "down";
        this.state.notice = probe.crashCart?.mode === "first-run" ? "Welcome. This instance has no saved rigs yet." : "The daemon is stopped. Saved rigs remain available.";
        return;
      }
      const rigs = await this.deps.client.rigsSummary();
      if (!Array.isArray(rigs) || rigs.some((r) => typeof r.id !== "string" || typeof r.name !== "string")) throw new Error("The daemon did not return a usable rig list.");
      this.state.rigs = rigs.sort((a, b) => Number(b.name === "kernel") - Number(a.name === "kernel") || a.name.localeCompare(b.name));
      if (this.state.rig && this.state.rigs.some((r) => r.id === this.state.rig!.rigId)) await this.readRig(this.state.rig.rigId);
      else { this.state.page = "rigs"; this.state.selected = 0; }
      this.state.notice = "Daemon connected. Kernel is recommended first; choose what to bring back.";
    });
  }
  private async readRig(id: string) {
    const rig = await this.deps.client.startupRequest<StartupRig>(`/${encodeURIComponent(id)}`);
    if (!Array.isArray(rig.seats) || rig.seats.some((s) => typeof s.logicalId !== "string" || typeof s.revision !== "string" || !s.observed)) throw new Error("Seat startup choices are unavailable from this daemon.");
    rig.seats.sort((a, b) => Number(b.logicalId === "operator.agent") - Number(a.logicalId === "operator.agent") || a.logicalId.localeCompare(b.logicalId));
    this.state.rig = rig;
    this.state.page = "seats";
    this.state.selected = Math.min(this.state.selected, Math.max(0, rig.seats.length - 1));
    this.state.consent = undefined;
    this.state.freshBlocked = undefined;
  }
  async key(key: string) {
    const s = this.state;
    if (s.busy) return;
    if (key === "d") { s.expanded = !s.expanded; this.changed(); return; }
    if (key === "r") { await this.refresh(); return; }
    if (key === "escape") {
      s.consent = undefined; s.scroll = 0;
      if (s.page === "confirm") { s.page = "seats"; s.notice = "Fresh start declined. No new conversation was launched."; }
      else if (["seats", "kernel"].includes(s.page)) { s.page = "rigs"; s.rig = undefined; s.selected = 0; }
      this.changed(); return;
    }
    if (key === "w" && ["rigs", "seats"].includes(s.page)) {
      s.open = false; this.deps.onWork(s.rig); this.changed(); return;
    }
    const count = s.page === "rigs" ? s.rigs.length : s.rig?.seats.length ?? 0;
    if (s.expanded && (key === "up" || key === "down")) {
      s.scroll = Math.max(0, s.scroll + (key === "down" ? 1 : -1)); this.changed(); return;
    }
    if (key === "up" || key === "down" || key.startsWith("select:")) {
      const index = key.startsWith("select:") ? Number(key.slice(7)) : s.selected + (key === "down" ? 1 : -1);
      s.selected = Math.max(0, Math.min(count - 1, index)); s.expanded = false; s.freshBlocked = undefined;
      this.changed(); return;
    }
    if (s.page === "down" && ["s", "enter"].includes(key)) {
      let confirmed = false;
      await this.run(async () => { s.notice = "Starting this daemon only… seats will be selected next."; this.changed(); await this.deps.startDaemon(); confirmed = true; });
      const failure = s.notice;
      await this.refresh();
      if (!confirmed) { s.notice = failure; s.detail = failure; this.changed(); }
      return;
    }
    if (s.page === "rigs" && key === "k" && !s.rigs.some((r) => r.name === "kernel")) {
      await this.run(async () => { s.prerequisites = await this.deps.client.startupRequest("/prerequisites"); s.page = "kernel"; }); return;
    }
    if (s.page === "kernel" && ["c", "l"].includes(key)) {
      await this.run(async () => {
        const runtime = key === "c" ? "codex" : "claude-code";
        s.notice = "Preparing kernel topology… no seats are being launched."; this.changed();
        const result = await this.deps.client.startupRequest<{ rigId: string }>("/kernel", { runtime });
        s.selected = 0; await this.readRig(result.rigId);
        s.notice = "Kernel prepared. The operator is recommended; choose the seat to start.";
      }); return;
    }
    if (s.page === "rigs" && key === "enter" && s.rigs[s.selected]) {
      await this.run(async () => { const id = s.rigs[s.selected]!.id; s.selected = 0; await this.readRig(id); s.notice = "Only the selected seat will be started. Other seats retain their history."; }); return;
    }
    const seat = s.rig?.seats[s.selected];
    if (s.page === "seats" && seat && key === "f" && seat.hasHistory && seat.freshAllowed !== false && !s.freshBlocked
      && (seat.intendedAction === "resume-original" || seat.freshRequired)) {
      s.consent = { rigId: s.rig!.rigId, seat: { ...seat } }; s.page = "confirm";
      this.changed(); return;
    }
    if (s.page === "confirm" && key === "y" && s.consent) {
      const consent = s.consent; s.consent = undefined; s.page = "seats";
      await this.launch(consent.rigId, consent.seat, "fresh"); return;
    }
    if (s.page === "seats" && seat && key === "enter") {
      if (seat.observed.state === "running") { s.open = false; this.deps.onWork(s.rig, seat); this.changed(); return; }
      await this.launch(s.rig!.rigId, seat, seat.hasHistory ? "resume" : "start");
    }
  }
  private async launch(rigId: string, seat: StartupSeat, action: string) {
    await this.run(async () => {
      this.state.notice = `${action === "resume" ? "Resuming" : "Starting"} ${seat.logicalId}…`;
      this.changed();
      try {
        const result = await this.deps.client.startupRequest<{ message?: string; status?: string; code?: string }>(
          `/${encodeURIComponent(rigId)}/${encodeURIComponent(seat.logicalId)}`, { action, revision: seat.revision });
        this.state.notice = action === "fresh" ? "A new conversation was started with the configured context. Previous history is retained." : result.message ?? result.status ?? result.code ?? "Launch finished; inspect the observed state.";
      } catch (error) {
        // Read effects after every failed/lost response. Never automatically replay a POST.
        await this.readRig(rigId).catch(() => {});
        throw error;
      }
      const notice = this.state.notice;
      await this.readRig(rigId);
      this.state.selected = Math.max(0, this.state.rig!.seats.findIndex((s) => s.nodeId === seat.nodeId));
      this.state.notice = notice;
    });
  }
}

export function startupLines(s: StartupState): Array<{ text: string; action?: Action }> {
  const button = (text: string, key: string) => ({ text, action: { type: "startup" as const, key } });
  const lines: Array<{ text: string; action?: Action }> = [
    { text: "OpenRig · Start and return" }, { text: `Instance: ${s.home}` }, { text: `Daemon: ${s.target}` }, { text: "" }, { text: s.notice }, { text: "" },
  ];
  if (s.busy) return [...lines, { text: "Working… repeated input will not start another operation." }, { text: "q leaves this view; an accepted operation continues." }];
  if (s.page === "down") lines.push(button("Enter / s  Start daemon; choose seats next", "s"));
  if (s.page === "rigs") {
    s.rigs.forEach((r, i) => lines.push(button(`${i === s.selected ? "▶" : " "} ${r.name}${r.name === "kernel" ? " · recommended first" : ""}`, `select:${i}`)));
    if (!s.rigs.some((r) => r.name === "kernel")) lines.push(button("k  Set up kernel (operator recommended)", "k"));
    if (s.rigs.length) lines.push(button("Enter  Choose seats in selected rig", "enter"));
  }
  if (s.page === "kernel") {
    lines.push({ text: "Choose the runtime for this new kernel. No model or credential will be changed." });
    lines.push(button(`c  Codex · ${s.prerequisites?.codex ?? "unavailable"}`, "c"), button(`l  Claude Code · ${s.prerequisites?.claudeCode ?? "unavailable"}`, "l"));
    lines.push({ text: "Unavailable means installation/authentication needs repair before setup." });
  }
  if (s.page === "seats" && s.rig) {
    lines.push({ text: `${s.rig.rigName} · choose one seat; unselected seats remain unchanged` });
    s.rig.seats.forEach((seat, i) => lines.push(button(`${i === s.selected ? "▶" : " "} ${seat.logicalId} · ${seat.observed.state} · ${seat.hasHistory ? seat.intendedAction : "new seat"}`, `select:${i}`)));
    const seat = s.rig.seats[s.selected];
    if (seat) {
      lines.push({ text: "" }, { text: `${seat.logicalId} · ${seat.runtime} · model ${seat.model ?? "configured default"}` },
        { text: seat.prerequisite ?? seat.reason ?? seat.observed.detail },
        button(seat.observed.state === "running" ? "Enter  Open live work" : `Enter  ${seat.hasHistory ? "Resume previous conversation" : "Start this new seat"}`, "enter"));
      if (seat.hasHistory && seat.freshAllowed !== false && !s.freshBlocked && (seat.intendedAction === "resume-original" || seat.freshRequired)) lines.push(button("f  Consider a fresh conversation…", "f"));
    }
  }
  if (s.page === "confirm" && s.consent) {
    lines.push({ text: `Start a NEW conversation for ${s.consent.seat.logicalId}?` },
      { text: "It will not contain the old conversation. The old history is retained; configured context and durable duties will be re-primed." },
      { text: "This decision applies only to this seat and the state just inspected." },
      button("y  Confirm this fresh start", "y"), button("Esc  Decline; leave stopped", "escape"));
  }
  if (["rigs", "seats"].includes(s.page)) lines.push(button("w  Continue to ordinary work", "w"));
  lines.push(button("r  Refresh actual state", "r"), button("d  Diagnostic details", "d"), button("Esc  Back / decline", "escape"), { text: "↑↓ choose · q quit · S opens startup from ordinary work" });
  if (s.expanded) lines.push({ text: "" }, { text: s.detail || JSON.stringify(s.rig?.seats[s.selected] ?? s.probe ?? {}) });
  return lines;
}
