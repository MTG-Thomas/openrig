---
name: messaging-the-human
description: "Use when project policy calls for a human decision or update, a human delivery is pending or failed, or a reply must resume the right work."
metadata:
  cli_surfaces_referenced:
    - gateway human list
    - gateway human show
    - queue create
    - queue transitions
    - queue block
    - send
  openrig:
    stage: provisional
    audience: all agents
    sibling_skills:
      - queue-handoff
      - openrig-user
---

# Messaging the Human

Project World supplies **when and why** to contact a human. This skill supplies
transport-neutral mechanics; installing it does not create an approval gate or
choose a connector. If policy leaves a material decision ambiguous, identify the
missing authority. Do not convert a solvable technical failure into a human gate.

## Discover, check, send, inspect

Discover the registered participants and inspect the chosen human:

```bash
rig gateway human list --json
rig gateway human show <entityId> --json
```

Use the returned `address` (`<entityId>@external`), not a username, remembered
seat, connector handle, or guessed kernel address. Where several humans exist,
use the decision ownership in Project World. An absent or ambiguous registration
needs a named registration correction, not a fallback address.

Check readiness: configured, enabled, active, ready, reason, and next action.
`indeterminate` is not ready. Follow the reported next inspection; do not enable
or reconfigure a connector merely to make the check pass.

Write the decision, evidence, and continuation in a body file. The sole outbound
human-message primitive is:

```bash
rig queue create --destination <entityId>@external \
  --summary "<decision or update>" --body-file <packet-file> \
  --evidence-ref <durable-evidence> --verify --json
```

If an existing agent-owned row must wait, block it on the **new live qitem ID**
(`rig queue block <work-id> --on <human-qitem-id> ...`), not on the human address.
Completion of the human qitem resumes its dependants. Blocking on the human as
well would issue another notification for the same decision.

The row persists before bounded delivery verification. Read its qitem ID and
verification result; `posted` proves connector posting, **not human readership**.
`transport-failed`, `never-posted`, or a pending/indeterminate result leaves the
row intact. Inspect that same row and its next action; never create a second row
or blindly resend because verification timed out.

```bash
rig queue transitions <qitem-id>
```

A correlated reply binds to that exact human and qitem and records the resolution
that resumes the owner. Check the recorded result before claiming the decision
arrived; a delivery receipt alone is not acceptance.

## Existing blockers and other channels

An existing agent-owned row may be blocked on `<entityId>@host`. That is an
internal custody label resolved through the human registry to the same external
participant; it is not a second delivery address. Keep the owner and continuation
on that row. Inspect its existing delivery receipt before considering another
request, so a legacy blocker does not produce a duplicate message. Never derive
`@host` from the current rig name.

`rig send` reaches an agent's terminal only. It is not a human transport or a
durable human obligation. Agent-to-agent work uses the queue handoff path.
Connector-specific configuration and handles belong to registry/readiness tools,
not to project-independent message instructions.
