# Agent-operated System Health diagnosis

System Health can give a responsible agent one durable investigation packet when
a configured detector needs interpretation. The packet preserves the finding,
policy version, evidence, and current authority documents. It invites the agent
to investigate beyond that selection, including its own contribution. It does
not declare a pathology or perform corrective actions.

## Enable a bounded diagnosis loop

```sh
rig health policy --json > effective-policy.json
jq '.policy' effective-policy.json > health-policy.json
# Edit health-policy.json: diagnosis.enabled=true and diagnosis.owner=<seat@rig>.
rig health policy --file health-policy.json
rig health diagnose                    # preview; no writes or wakes
rig health diagnose --apply            # evaluate now and apply admitted actions
rig health diagnosis list
rig health diagnosis show <qitem-id>
```

The daemon checks enabled policy once per minute. `health policy` reports whether
that check is scheduled and its last result, including errors. Ordinary `health`
list/explain commands remain observational. Diagnosis defaults to disabled;
ceremony amplification is the only default diagnosis trigger. A continuing
episode keeps one qitem, receives at most one additional presentation by default,
and shares an owner cooldown across episodes (one hour by default). A disposition
stops re-presentation. Disabling policy stops automatic admission and presentation.
Ownership changes do not silently reroute existing occurrences.
Outside a managed seat, name the writer with `rig health --actor <name> ...`.
Managed-seat transport identity takes precedence over that declared name.
Only the occurrence's assigned owner may record its disposition or request human
notification. Other agents can advise the owner; a policy-owner change does not
grant custody of existing occurrences. Writes retain the sender's identity
provenance on the queue transition.

Policy controls detector enablement, ceremony/review/wake thresholds, checkpoint
observation window and freshness, diagnostic owner, cooldown, re-presentation
bound, and human-escalation conditions. Edit plain JSON and apply it with the
command; unknown keys and invalid values refuse without changing the policy.
Applied proposals and their predecessors are retained under the configured
OpenRig home in `health/policy-history/`. The effective version also includes
the existing `health.context_pressure.warning_percent` and `critical_percent`
settings, which remain configurable with `rig config`. Their defaults are 95
and 99. CLI/TUI finding explanations show the policy version used.

## Supply an outcome-boundary checkpoint

Live queue transitions do not, on their own, prove product outcomes or the
authority for a bounded operation. At a meaningful outcome boundary, the agent
holding those facts may submit a census for one qitem lineage and time window. Set `includeHandoffs: true`
to follow its declared handoff descendants; this is the normal path for work that
passed between seats. The root alone usually misses the review/return traffic.
Prefer the existing proof/progress/outcome artifact as evidence. Do not add a
checkpoint to each edit or message. No checkpoint means no ceremony inference.

```json
{
  "schema": "openrig.health-checkpoint/v0alpha1",
  "lineageQitemId": "<existing-product-qitem>",
  "includeHandoffs": true,
  "scope": {"type": "slice", "projectId": "<project>", "missionId": "<mission>", "sliceId": "<slice>"},
  "startedAt": "<ISO timestamp>",
  "observedAt": "<ISO timestamp>",
  "transitionIds": "derive",
  "productOutcomes": [
    {"id": "<outcome-id>", "observedAt": "<ISO timestamp>", "evidenceRef": "<proof-artifact-path>"}
  ],
  "productCensusRef": "<artifact establishing the complete outcome census for this lineage/window>",
  "boundedAuthority": {"applies": false, "evidenceRef": "<bounded-effect-authority assessment>"},
  "sdlc": {"expectation": "<selected components and review boundary>", "evidenceRef": "<authority for that selection>"},
  "authorityPaths": {
    "project": ["<current project SPEC and project.yaml paths>"],
    "mission": ["<current mission SPEC and mission.yaml paths>"],
    "slice": ["<current slice SPEC and slice.yaml paths>"]
  }
}
```

```sh
rig queue transitions <existing-product-qitem>
rig health checkpoint --file checkpoint.json
rig health --instance --json
```

`transitionIds: "derive"` asks the existing submission command to collect the
complete census once, then retain the exact IDs in the checkpoint and its audit.
The author supplies outcomes and their meaning, not a row-by-row bookkeeping
ritual. An explicit ID array is also supported for sealed replay or a
caller-supplied census. Later reads never silently extend either form.

The daemon verifies that transition IDs are the complete census for that exact
qitem and window, including all handoff descendants when selected. It does not
infer shared lineage from similar names or seat names. The complete transition
census may be assembled from the queue ledger; omitting a descendant refuses.
Explicit mission/slice tags on counted family members must match the checkpoint
scope; untagged descendants inherit the declared handoff relationship.
The bound is 1,000 linked qitems and 10,000 transitions; an oversized family
refuses rather than silently sampling it. Independent roots are separate censuses. It counts
those transitions and the distinct, evidenced product outcomes, and explains
both sides of the ratio, the literal gate-tag breakdown, and the selected SDLC
expectation. These are custody/status transitions, not messages or judgments
about whether each review was useful. A product outcome is a distinct evidenced
user-visible result; commits, test runs, returns and fixes needed to achieve
that same promised result do not each create another denominator unit. The
census must state its outcome granularity and coverage. The same granularity
must be used for positive and proportionate controls. An empty outcome list requires the same census evidence
as a nonempty one. An unavailable product census is a null denominator: the explanation says
no ratio was computed, rather than silently substituting zero or one.
`boundedAuthority.applies=null` means unknown, never false.
Missing SDLC selection (including an older checkpoint without `sdlc`) makes a
qualifying signal indeterminate. Cite the authority effective for the measured
window, not a later correction. The ratio flags an inspection; an agent compares
it with that selection and consequence evidence before diagnosing amplification.
Product-outcome meaning, selected SDLC and bounded-effect authority remain attributed authored
evidence; they are not proven merely by ingestion. Findings label that source
and use medium confidence. Required evidence references must resolve to nonempty,
readable local files (at most 1 MiB) inside the configured workspace. Absolute
paths and paths relative to that workspace are supported; other reference kinds
(including section addresses) remain unavailable. Resolved evidence records carry
a SHA-256; missing files and symlink escapes remain attributed claims but force
indeterminate source truth and cannot admit a diagnosis. Availability is checked
again on every projection; presence does not certify the artifact's meaning.
This authority assessment is distinct from the
project/mission/slice documents supplied to the diagnosing agent. Embedded
context is limited to canonical `SPEC.md` and project/mission/slice YAML files
at their corresponding work-tree nodes, at most 64 KiB each. Other paths and
symlink aliases are reported unavailable without embedding their contents.
Each entry retains its authority level. Project files must be at the configured
project root; mission files must belong to the finding's mission; slice files
must also have a sibling `SPEC.md` declaring the finding's slice ID (and matching
mission when declared). A sibling slice or another mission is unavailable even
when its filename is canonical. Without mission/slice scope, those authority
levels remain unavailable.

Checkpoints are audited under `health/checkpoints/history/`; replaying identical
bytes writes nothing. Later censuses advance observation time. High-to-high
observations retain episode identity; a clearing checkpoint and later recurrence
produce a cleared episode and a new ID. Reads never update checkpoint state.
Stale, unavailable, contradictory, clipped, or missing evidence cannot admit a
diagnosis. No findings is not a healthy assertion. The current source bounds are
200 lineages, 10,000 transitions and 1,000 product outcomes per checkpoint, and
1 MiB per input. Unsupported or invalid sources fail visibly.

## Investigate and record a disposition

Read the exact evidence and the current authority. Trace where the pattern
began, test whether your own actions amplified it, and distinguish another seat
or stale guidance. A second opinion is optional. The packet is a starting point,
not a closed evidence set.

```json
{
  "verdict": "insufficient evidence",
  "causalStart": null,
  "steering": "Inspect the product-outcome census before changing work.",
  "uncertainty": "The cited artifact does not yet establish the denominator.",
  "evidenceRefs": ["<inspected-evidence-path>"]
}
```

```sh
rig health diagnosis record <qitem-id> --file disposition.json
rig health diagnosis show <qitem-id>
```

Verdicts are `false positive`, `early real condition`, `established pathology`,
`insufficient evidence`, or `resolved`. The disposition is retained on the
diagnostic qitem's transitions and visible in CLI output and the queue. Recording
it does not close or alter the underlying product work. Changed dispositions
retain earlier testimony; exact replay is a no-op. A detector clearing is
recorded separately from an agent declaring the problem resolved.

## Human delivery

Human escalation is an explicit agent action:

```sh
rig health diagnosis notify <qitem-id>
```

It requires a registered `human.address` and an admitted `human.conditions`
entry (`critical` or `established pathology`). The connector must be enabled
and pass live readiness checks. The current connector implementation verifies
Slack scopes and channel membership; the diagnosis service itself uses a
transport-neutral readiness port. The existing gateway owns delivery policy
and posting. One human request is retained per episode, and its actual delivery
outcome comes from queue receipts. `pending` is never presented as `posted`.
Inspect the returned qitem's transitions for the connector receipt. No periodic
health check sends a human notification or performs remediation.

## Read-only consumers and calibration

A consumer such as a later Herder plugin reads `GET /api/health` and
`GET /api/health/:findingId`, or the identical `rig health --json` and
`rig health explain <finding-id> --json` records. The record schema is
`openrig.health/v0alpha1`; list metadata is `openrig.health-list/v0alpha1`.
Preserve ID, status, policy version, time window, freshness, evidence and
threshold together. There is no health score or implicit remediation authority.
The default list excludes cleared records; explicit cleared queries and exact
ID reads retain them while the source can still project them. A recurrence after
clear receives a new episode ID. This is an on-demand projection, not a history
store; a detail 404 does not prove resolution.

Lists default to 100 and cap at 200, with `total` and `truncated` explicit.
Ceremony findings take precedence before the cap so context pressure cannot
hide the primary signal. Narrow a truncated query; do not certify the unseen
remainder. Empty is not healthy, unavailable is not empty, and an indeterminate
finding cannot authorize a diagnostic occurrence. An existing occurrence may
receive one status-observation receipt when its source becomes indeterminate;
that does not create another obligation or wake.

Live sources currently supply context pressure and ceremony checkpoints.
Behavioral and epistemic categories intentionally have no detector. Review
carousel, redundant wakes, stale directives and scope admission have typed
evaluators and replay controls, but the live source does not infer their missing
candidate-change, rescue, directive-conflict or admission-authority facts.
Unsubmitted outcome censuses and unlinked work roots remain outside ceremony
coverage. A small lineage below the configured threshold may still deserve an
agent's inspection; the threshold is a conservative admission rule, not a
definition of good process.

`packages/daemon/scripts/probe-health-calibration.mjs` accepts a sealed replay
export and output directory after daemon/CLI/TUI builds. It drives the compiled
checkpoint/list/explain/diagnosis commands, renders the TUI, retains exact
records and screens, compares database and filesystem effects around reads,
and measures query cost against declared budgets. Every write uses a disposable
home and database. Historical expected states must be grounded independently
of the detector formula; incomplete outcome evidence is an indeterminate case,
not a denominator of one. A calibration report describes its selected corpus
and remaining blind spots, not a fleet-wide false-positive rate.
