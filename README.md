# OpenRig

OpenRig is a self-hosted coordination layer for teams of coding agents. Run Claude Code and Codex in their native terminal sessions, give each a stable role and address, and let them delegate work, share context, and review each other's results.

Talk to a lead agent about the outcome you want. Leave specialists in stable seats to build up project knowledge; team leads coordinate their work across teams and bring you results and decisions that need your attention. You can inspect their terminals, follow the work in the TUI, and step into any conversation. The team's structure, roles, and guidance are files you control.

[Website](https://openrig.dev) · [Interactive TUI tour](https://openrig.dev/tour/workspace) · [Documentation](https://openrig.dev/docs) · [0.5.14 release notes](docs/releases/v0.5.14.md)

## Start with one repository

The `first-project` starter has two Codex seats: an owner who makes the change and a checker who reviews it. You need **Node.js 20, 22, or 24**, **tmux**, and an installed, authenticated **Codex**. Other rigs can use Claude Code or mix runtimes.

```bash
npm install -g @openrig/cli
rig setup --dry-run
codex login status
```

`rig setup --dry-run` previews machine preparation. Run `rig setup` to apply it if needed, or prepare the prerequisites yourself. Setup checks both native harnesses and cmux; Claude Code and cmux are optional for this starter. Managed startup can write harness trust, hooks, and selected runtime configuration; the [first-use guide](docs/reference/getting-started.md) explains the setup and launch behavior.

From the repository you want the agents to work on:

```bash
cd /path/to/your/repository
rig up first-project --cwd . --plan
rig up first-project --cwd .
rig ps --nodes --rig first-project
```

The plan previews the launch. The next command starts the team and brings up OpenRig's local daemon and operational kernel if needed. Check seat readiness and resolve any harness login or trust prompts before assigning work.

Give the owner a small, concrete task from your project. For example:

```bash
rig send dev-owner@first-project 'Improve the CSV import error when a required column is missing: name the missing column and leave existing data unchanged. Track the task in the queue and return its ID. Verify the behavior, ask dev-check@first-project to review the exact change, and tell me how to try it. Keep the change local.'
rig tui
```

Follow the result in the TUI. Sending a message does not itself create a queue item; once the owner records the task, inspect its tracked work using the returned ID:

```bash
rig queue list --destination dev-owner@first-project
rig queue show <qitem-id> --full
```

Review the change and its verification, then return to the same owner for the next task. You do not need to rebuild the team for each request. The [first-use guide](docs/reference/getting-started.md) covers the complete path, including recovery and larger starters.

## See and drive the team

The terminal UI is the primary operator interface. Its command bar provides direct navigation as an alternative to clicking through the explorer; `rig tui commands` lists the available commands.

| Section | What you can inspect |
| --- | --- |
| **Topology** | Rigs, pods, seats, their relationships, and current agent state |
| **Specs** | Rig, agent, and workflow definitions and their source files |
| **Projects** | Projects, missions, slices, and execution progress |
| **Terminals** | Saved and derived terminal layouts |
| **Feed** | Human requests and updates |
| **System** | Instance health, configuration, and connections |

Plain `rig tui` opens an independent view. `rig tui --shared` attaches to the operational kernel's shared TUI when that terminal is available; **Ctrl-b, then d** detaches from it. Leaving the dashboard does not stop the agents.

To see the actual harness sessions together, open a terminal workspace with herdr:

```bash
rig terminal open first-project --provider herdr
```

herdr is optional; OpenRig also supports cmux, and the underlying sessions are available through tmux. See the [terminal workspace guide](docs/reference/getting-started.md#share-the-dashboard-and-return-to-it). The TUI shows coordination state while the terminal workspace lets you watch and interact with the agents themselves. The older browser UI remains in maintenance mode with best-effort support.

## How the pieces fit

### Stable seats, programmable teams

A **rig** is a team topology. **Pods** group related responsibilities within it. A **seat** is a stable place in that topology, with a role, context, and address such as `dev-owner@first-project`. The agent conversation occupying it can change while the seat's identity and authored context remain.

A [RigSpec](docs/reference/rig-spec.md) defines the topology in YAML: pods, members, relationships, working directories, and startup behavior. An [AgentSpec](docs/reference/agent-spec.md) supplies reusable role guidance, skills, hooks, and runtime profiles. Culture files describe how the agents should coordinate and exercise judgment.

You can start with a pair, add specialist seats, or have a lead coordinate across several rigs. These are separate harness sessions with their own context windows; they can also use their harness's own subagents. Browse the shipped definitions with `rig specs ls` and preview a launch with `rig up <spec-name> --plan`.

### Messages and owned work

`rig send` is for direct communication. The queue records work with an owner, a state, and a handoff history. Agents can delegate through the queue, return a result to the requesting seat, and surface a question for a human. This makes ownership visible across conversations and runtimes.

Workflow definitions describe repeatable routes through that work: planning, implementation, review, or another sequence suited to the project. The agents still do the reasoning and execution. A larger workflow is optional; start with a useful task and add structure when it helps.

### Project knowledge and context

The work has its own structure: **project → mission → slice**. A project holds enduring intent and conventions; missions organize larger outcomes; slices define bounded pieces of work. These are file-backed workspaces that can live alongside versioned project material. The [workspace contract](docs/reference/project-workspace.md) explains their layout and project bindings.

OpenRig separates reusable **System World** guidance from a **Project World** of project-specific context and skills. Agents can load addressed Markdown sections with `rig context get`, and trace context through the topology or work hierarchy. This lets specialists find the part they need while retaining a route back to the broader intent. See [chain files](docs/reference/chain-file-convention.md) and [Refocus](docs/reference/refocus-channel.md).

Useful continuity comes from maintaining those files and handing work over deliberately. A stable address and a saved conversation do not give an agent unlimited memory.

## Runtime and operations

```text
CLI / TUI / MCP
      |
Local HTTP daemon
      |
SQLite + tmux + runtime adapters
      |
Claude Code / Codex / Pi runner / terminal sessions
```

Claude Code and Codex run as native harness sessions. The Pi adapter uses an RPC runner inside a terminal pane, rather than Pi's native interactive TUI. You keep the selected harness's provider authentication and usage costs; OpenRig's control plane runs on your own machine.

`rig doctor` checks machine health. The TUI's **System → Health** view exposes instance findings; [health diagnosis](docs/reference/health-diagnosis.md) documents detection and diagnosis policy. Snapshots and restore support recovery, with per-seat outcomes rather than an assumption that every conversation resumed successfully.

For an existing installation, follow the [upgrade procedure](skills/_canonical/core/openrig-upgrade/SKILL.md) and the target release notes. It includes the 0.5.9 context-library and telemetry migration for installations crossing that boundary. An upgrade should preserve live seats; `rig down` is not an upgrade step.

## Further reading

- [Getting started](docs/reference/getting-started.md)
- [RigSpec](docs/reference/rig-spec.md) and [AgentSpec](docs/reference/agent-spec.md)
- [Project workspaces](docs/reference/project-workspace.md) and [instance layout](docs/reference/instance-layout.md)
- [Developing OpenRig](docs/reference/developing.md)
- [Website and guides](https://openrig.dev/docs)

## License

[Apache 2.0](LICENSE)
