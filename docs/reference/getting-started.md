# Getting started: one useful change in your repository

Start with a repository and one bounded change you can exercise. The shipped
`first-project` starter provides two native Codex seats: an outcome owner and
an independent checker. It uses your installed Codex executable and login;
terminal-provider support does not change the harness or account being used.

> Everything below reports **what is currently true**, never a guarantee that
> downstream work will succeed. "Daemon up" does not mean every agent is healthy;
> "kernel ready" does not mean every kernel agent is healthy; a workspace root
> being *live* does not mean it is the *right* one for your project.

## Prepare and launch

Type `rig` in an ordinary terminal to open the startup and work TUI. It shows
the daemon address; **d** expands the selected instance path and diagnostics.
If the daemon is stopped, press Enter
to start that daemon, then choose the rigs and seats you want. Kernel is
recommended first; selecting its operator does not start every kernel seat.
The same view is available with **S** from ordinary TUI work.
**?** opens Help even while connection checks are pending. **w** skips startup;
**Esc** goes back, or leaves startup from its first page. These choices do not
start a daemon or a seat. **L** opens local reading before or after connecting:
choose configured Specs, project intent, projects, or missions and slices, then
select a directory or file. **r** reads the selected source again; **Esc** returns.
Local reading uses this machine's configured workspace paths and file allowlist,
including when the selected daemon address is remote. It shows disk provenance,
missing or denied sources, binary files and the 1 MiB text truncation boundary.
These disk snapshots may change after reading and do not supply live queue,
execution or topology state. Live views load after a confirmed connection and
deliberate entry; a stalled live read does not prevent Help or local reading.
When terminal transport is unavailable, **t** starts the empty terminal service
so recovery choices can be inspected. It launches no seats.

For a previously occupied seat, Enter attempts its previous conversation.
If history is unavailable, read the reason. **f** opens a separate fresh-start
decision for that named seat; **Esc** declines without launching it. A confirmed
fresh conversation receives the configured context and retains the old history,
but does not resume that history. Authentication or runtime failures require
repair of that prerequisite. **o** opens the existing native terminal here; detach
to return (tmux defaults to Ctrl-b, then d). Decide native trust/auth prompts
there. If a fresh start paused before context delivery, **c** finishes that
delivery to the same occupant. **r** reads actual state again; **d** expands details.

Install OpenRig and inspect `rig setup --dry-run` before applying machine
changes. Check `tmux -V`, `codex --version` and `codex login status` in your
launch shell; install missing prerequisites and complete `codex login` when
needed. This starter needs tmux and Codex, without a Claude login or Herdr
plugin. The kernel selects its available native runtime variant separately.

`rig setup` currently installs/checks both harnesses and cmux. Use it when you
want that full environment. Its overall failure can include an optional
component for this starter: read the individual result and verify the three
prerequisites above rather than treating a missing Claude login as broken
Codex. A missing Codex login remains a real launch blocker.

```sh
cd <your-repository>
rig specs preview first-project
rig up first-project --cwd . --plan
rig up first-project --cwd .
rig status
rig ps --nodes --rig first-project
```

Preview the starter's seats and resources; plan checks resolution and
preflight for the selected working directory. Launch starts the daemon if needed; the kernel boots in the
background. Read readiness for the project seats, not only daemon health. If a
seat has an authentication, trust or permission prompt, resolve the named
prompt before assigning it work. A model pin is configuration; the native
harness must report the intended model before consequential work.

The default Codex workspace sandbox may also ask before local `rig` calls.
Approve only the intended operations in the selected instance. A waiting
permission prompt is not task progress; inspect it before retrying delivery.

`first-project` is a deliberately small starting point, not a universal team.
For a different installed runtime or team shape, inspect `rig specs ls --kind
rig` and `rig specs preview <name>` before selecting it. A seven-seat showcase
is optional and consumes more concurrent capacity.

## Give the owner an outcome

For example, in a project that imports CSV files:

```sh
rig send dev-owner@first-project 'Improve the CSV import error when a required column is missing: name the column and leave the existing data unchanged. Add a regression check, ask dev-check for an independent check of the exact candidate, and record the result and how I can try it. Keep the change local; do not publish.'
```

Replace the example with a real problem in your repository. Include what the
user should observe, a boundary and how success can be checked. The owner
creates and claims a durable task, implements it, and routes the selected
independent check. You should not have to relay the review between terminals.
`rig send` is the initial conversation; the queue and repository artifacts
retain the work. An unbound shell does not need to impersonate a queue owner.

Follow the work with `rig queue list --rig first-project --limit 1000`, then
`rig queue show <id> --full` and `rig queue transitions <id>`. A delivered
message is not a reviewed result. Read the final artifact, exercise the stated
behavior, and check the candidate the review actually covered.

## Share the dashboard and return to it

```sh
rig tui --shared
```

A fresh kernel runs the ordinary TUI in its existing `operator-human` terminal.
This command attaches another client to that terminal. **Ctrl-b, then d**
detaches without quitting the TUI; return with the same command and the view
stays where it was. Another authorized agent can capture or operate that same
pane. It should tell you before changing your view. The terminal is not a
human inbox and does not prove anyone is watching it.

Plain `rig tui` remains an independent local view. If an older kernel or a TUI
you quit shows a shell, run `rig tui` in that shell once. `--shared` does not
start or replace a terminal, so a missing binding is reported with recovery
guidance rather than creating a second kernel.

Herdr users follow the same launch and task path. To place the managed team in
Herdr, use `rig terminal open first-project --provider herdr`; for the shared
dashboard, use `rig terminal open kernel --provider herdr`. The equivalent
cmux provider is also available. Read the opened/absent/degraded result: a
partial terminal view is not a healthy team. Repeated terminal-open calls can
create another provider workspace; return to the one already open when you
want to preserve it. This is terminal integration, not native plugin enrollment.

## Continue real project work

Return to the same owner with the next outcome, citing the earlier result.
The seat address and durable queue survive closing your viewing terminal.
Keep intent, acceptance and evidence in the repository's existing project,
mission and slice artifacts; the starter reads those before inventing a path.

If the project has no work tree, start with `rig workspace doctor` and
`rig scope mission create --help`, then `rig scope slice create --help`. Set
the actual intended outcome before creating work. `rig scope` retains what is
being built. When repeated coordination warrants a workflow, discover with
`rig workflow specs`, inspect its owners and inputs, and instantiate the
selected name with `rig workflow instantiate --help`. A workflow is not needed
merely to make the first local change.

## Incomplete setup and restart

| Observation | Next action |
| --- | --- |
| Tool missing or login fails | Use the specific setup/auth hint; recheck that executable in the launch shell. Do not send work to an unready seat. |
| Daemon is healthy, kernel is still starting | Read `rig status` and `rig ps --nodes --rig kernel`; kernel readiness is separate. |
| Shared terminal is absent | Inspect the existing kernel binding and recovery state; use standalone `rig tui` while resolving it. |
| Viewing terminal was closed | Reattach with `rig tui --shared`; do not relaunch the team. |
| Daemon restarted but tmux survived | Re-read `rig status` and the existing queue; a daemon restart is not a fresh project. |
| Host reboot lost tmux sessions | Open `rig`, start the daemon if needed, and select the existing rig and seats. Resume is the default; a fresh conversation needs a separate decision. |
| Launch reports no usable snapshot | Inspect the existing rig and retained project files, then follow the same-seat recovery below. |
| Work is waiting on a prompt or decision | Read the row, transition and named prompt; preserve the obligation until the missing decision arrives. |

If a snapshot is unavailable, the startup view checks the selected seat's
retained startup source and authoritative occupant relation. It reports a
missing or ambiguous source instead of selecting an arbitrary historical row.
Repair the named source, retry, or leave the seat stopped. Check the retained
queue, project notes and observed result before continuing work.

`rig setup` prints the short form of this path; `rig status` points back here.

## Kernel framing (what `rig setup` does and does not do)

Explicit CLI daemon startup retains its automatic kernel behavior. The TUI
starts the daemon with kernel auto-boot disabled so the user can select seats:

- `rig setup` installs/verifies the runtime; it does not start the daemon or the
  kernel.
- Starting the daemon (`rig daemon start`, or implicitly via `rig up`) is what
  boots the kernel rig in the background.
- Starting it from bare `rig` prepares no agents automatically. The TUI offers
  kernel setup and individual seat selection after connecting.
- **Kernel readiness is a distinct signal from daemon health.** The daemon's HTTP
  health binds early; the kernel can still be booting or a kernel agent can be
  unhealthy while the daemon is up. `rig status` surfaces kernel readiness
  separately (via `/api/kernel/status`); `rig daemon start --wait-for-kernel`
  polls it.

## The scope <-> workflow bridge

Two related primitives, often confused by new operators:

- **`rig scope`** manages **durable, on-disk artifacts** - missions and slices
  (markdown/YAML files in your workspace). These are the persistent record of
  *what work exists*.
- **`rig workflow`** manages a **runtime instance** - when you
  `rig workflow instantiate <name>`, the daemon creates a workflow instance plus
  an **entry qitem** that routes the first step to an owner. This is the live
  coordination of *who does the next step*.

How they relate: a scope slice is the durable description of a unit of work; a
workflow instance + its qitems are the live machinery that moves that work
through owners (hot-potato handoffs). They are not auto-bridged - there is no
auto-instantiate-from-scope - you instantiate a workflow by name when you want to
run one, and you reference your scope artifacts as the work it coordinates. A
typical loop: author/track the unit in `rig scope`, then
`rig workflow instantiate <name>` to start the runtime that drives it.
