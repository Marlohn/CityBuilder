---
name: citybuilder-maintenance
description: Workflow for maintaining Marlohn/CityBuilder: issue triage, bug fixing, PR review and fixes, safe merges, branch cleanup, repository maintenance, and implementation work.
---

# CityBuilder Maintenance

Use this skill whenever the task involves engineering or maintaining the CityBuilder repository.

## Source of truth

GitHub is the primary source of current project state.

Before making decisions or changes:

1. Inspect the current state of `Marlohn/CityBuilder` on GitHub.
2. Read the root `AGENTS.md`.
3. When touching a package, read that package's `AGENTS.md`.
4. Read the code, tests, issue, PR, comments, commits, and history relevant to the task.
5. Consult `docs/GUIA-DO-CODIGO.md`, `docs/VISAO.md`, `docs/PLANO.md`, and `hermes/FACTORY.md` when relevant.

If this skill conflicts with a more specific or newer repository rule, the repository rule wins.

Do not rely on stale assumptions when the repository can be inspected directly.

## Autonomy

Work autonomously on safe engineering tasks.

You may investigate bugs, edit branches, create focused commits, fix code, update appropriate tests and documentation, review PRs, fix PR problems, triage issues, and merge when the repository's safety conditions are satisfied.

Do not stop to ask questions that can be answered from the repository, history, tests, issues, PRs, or documentation.

Ask the user only when a real product decision is ambiguous or when a potentially destructive action cannot be proven safe from repository evidence.

## Change discipline

- Preserve existing behavior unless the task requires changing it.
- Prefer the smallest correct change.
- Avoid broad architectural rewrites without a concrete need.
- Avoid unrelated opportunistic refactors.
- Preserve compatibility, especially contracts, configuration schemas, saves, and replay behavior.
- Respect package boundaries and deterministic simulation rules.
- Never invent simulation rules or real-world numbers when the project requires sourced data.
- Do not delete potentially important code, data, branches, tests, or documentation without checking history and references first.
- Keep commits small, focused, and descriptive.

## Issue triage

Classify open issues using repository evidence:

- **valid**: the problem or requested work still exists;
- **duplicate**: another issue already represents the same work;
- **resolved**: current code already satisfies it;
- **obsolete**: later changes made the request no longer relevant.

For each issue, inspect the description, comments, related code, relevant commits/PRs, and current behavior before changing its state.

Do not close an issue merely because it is old.

When implementing issues, keep traceability between issue, branch, commits, PR, and tests.

## Priority

In general, prioritize:

1. data loss/corruption, save/replay compatibility, determinism, and severe regressions;
2. broken CI/build/developer workflow;
3. important functional bugs;
4. architectural problems causing concrete defects;
5. product and UX improvements;
6. cleanup and maintenance.

Adjust priority when dependencies or repository context justify it.

## Pull request workflow

When reviewing a PR:

1. Read the linked issue/task and repository rules.
2. Inspect the complete diff and affected code paths.
3. Check open review threads and previous feedback.
4. Verify compatibility and unintended behavioral changes.
5. Check tests and CI for the exact PR head.
6. Fix defects directly when safe and within scope.
7. Re-run or re-check the appropriate validation.
8. Merge only when the reviewed head is still current and required checks are green.

Do not treat green CI as sufficient proof by itself; review the behavior and diff.

If the PR head or base materially changes after review, re-evaluate before merging.

## Branch cleanup

A branch is a cleanup candidate only after checking:

- whether it has already been merged;
- whether it contains commits not reachable from the target branch;
- whether it has an open PR;
- whether an issue, active workflow, or recovery process still depends on it;
- whether another branch was based on it.

Never delete a branch merely because it is old.

Prefer false negatives over deleting potentially valuable work.

## Bug fixing

For bugs:

1. Reproduce or establish evidence of the failure when practical.
2. Identify the actual cause, not just the visible symptom.
3. Add or identify a regression test when appropriate.
4. Make the smallest correct fix.
5. Check adjacent behavior for regressions.
6. Validate with the repository's documented commands.
7. Record useful reproduction details in the PR or issue.

Use replay/seed information when available for simulation bugs.

## Validation

Follow the validation rules in `AGENTS.md`.

At minimum, for code changes, run the affected tests and the appropriate repository check. Before considering a merge safe, require the repository's required CI checks for the exact candidate revision.

For changes whose risk warrants it, also use slow tests, E2E tests, build, or simulation commands.

Never report a task as complete if validation that should have run is known to be failing.

## Documentation

Update documentation in the same change when commands, architecture, rules, package responsibilities, configuration, or developer workflow change.

Do not edit generated roadmap artifacts unless the repository explicitly says to.

## Reporting back

Keep status concise and evidence-based.

When finishing a task, report:
- what changed;
- what was validated;
- any remaining risk or unresolved dependency;
- relevant issue/PR/commit references.

Do not claim success based on intention; claim it only from repository state and validation evidence.
