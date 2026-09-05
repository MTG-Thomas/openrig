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
holding those facts may submit a census for one qitem lineage and time window.
Prefer the existing proof/progress/outcome artifact as evidence. Do not add a
checkpoint to each edit or message. No checkpoint means no ceremony inference.

```json
{
  "schema": "openrig.health-checkpoint/v0alpha1",
  "lineageQitemId": "<existing-product-qitem>",
  "scope": {"type": "slice", "projectId": "<project>", "missionId": "<mission>", "sliceId": "<slice>"},
  "startedAt": "<ISO timestamp>",
  "observedAt": "<ISO timestamp>",
  "transitionIds": [123, 124],
  "productOutcomes": [
    {"id": "<outcome-id>", "observedAt": "<ISO timestamp>", "evidenceRef": "<proof-artifact-path>"}
  ],
  "productCensusRef": "<artifact establishing the complete outcome census for this lineage/window>",
  "boundedAuthority": {"applies": false, "evidenceRef": "<bounded-effect-authority assessment>"},
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

The daemon verifies that transition IDs are the complete census for that exact
qitem and window. It does not infer shared lineage from similar names. It counts
those transitions and the distinct, evidenced product outcomes, and explains
both sides of the ratio. An empty outcome list requires the same census evidence
as a nonempty one. `boundedAuthority.applies=null` means unknown, never false.
Product-outcome meaning and bounded-effect authority remain attributed authored
evidence; they are not proven merely by ingestion. Findings label that source
and use medium confidence. This authority assessment is distinct from the
project/mission/slice documents supplied to the diagnosing agent.

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
