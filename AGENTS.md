# Repository guidance

OpenRig is an agent-work runtime with daemon, UI, CLI, and TUI npm workspaces under `packages/`. Read `README.md`, `docs/DESIGN.md`, and relevant as-built/reference documents before changing runtime or product contracts. Product-native agent coordination is part of this repository's functionality; preserve it rather than stripping it as generic orchestration boilerplate.

## Verification

Use a Node version accepted by `package.json` (`^20 || ^22 || ^24`) and the committed lockfile. Root scripts expose:

```sh
npm run lint
npm test
npm run test:ui
npm run mirror-skills:check
npm run generate-context-packs:check
npm run gate
```

`npm test` covers repository checks and daemon/CLI/TUI workspace tests; UI tests are separate. The gate runner binds its verdict to a clean worktree-local candidate, refuses machine-wide lane contention, and runs typecheck and test legs. Preserve its candidate identity, dependency-root checks, refusal behavior, and honest load/verdict evidence. A smoke-only gate is not a full test verdict.

## Context and release boundaries

Skill mirrors and context packs are generated surfaces: modify their canonical inputs and use the check scripts instead of editing output copies independently. Read `docs/reference/release-boundary.md` before release or seat lifecycle work. Its checklist is judgment guidance rather than blanket authorization: preserve seat-owner continuity decisions, earned knowledge, dirty work, exact runtime identity, and live plus last-known-good installs.

Do not infer that an on-disk guidance edit reached an active session. Capability-delta expiry requires both the canon's exact absorption marker and a distinct successor; unknown inputs stay unknown/live. Keep private host topology and release ownership out of public packages. Verify actual publication and runtime adoption separately from candidate checks.
