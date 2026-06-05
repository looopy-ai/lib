# AGENTS.md Policy For Looopy

This document defines mandatory engineering policy for coding agents and contributors in this repository.

## Policy Precedence

Rule Name: Policy precedence
- Trigger: When instructions conflict across repository policy documents.
- Requirement: Follow this precedence order: system/developer/user chat instructions, then AGENTS.md, then .github/copilot-instructions.md, then other docs.
- Verification: Resolve conflicts by applying the highest-priority source and document any material deviation in the PR or task summary.
- Exception: None.

## TypeScript Safety And Banned Type Hacks

Rule Name: Type-system integrity
- Trigger: Any TypeScript implementation, refactor, or bug fix.
- Requirement: NEVER use type-escape hacks including `as any`, `as unknown as`, multi-step cast chains, or assertions used only to silence compiler errors.
- Verification: Code review and static checks show no prohibited casts introduced.
- Exception: None.

Rule Name: Type-safe unblocking
- Trigger: When type errors block progress.
- Requirement: MUST redesign types, interfaces, or data flow instead of bypassing TypeScript.
- Verification: Final implementation compiles with `pnpm check:types` and does not rely on prohibited casts.
- Exception: None.

## Migration Immutability

Rule Name: Immutable migrations
- Trigger: Any task that affects DB schema or migration history.
- Requirement: NEVER modify existing migration files for functional changes; create a new migration for schema/behavior updates.
- Verification: Diff shows new migration files for functional changes, not in-place edits.
- Exception: ONLY IF a migration is broken and not safely applied may non-functional repair be made with explicit user approval.

## Database Permission Gate

Rule Name: Explicit DB approval
- Trigger: Any database-affecting action (schema change, data migration, destructive query, resets, deletes, backfills).
- Requirement: REQUIRES EXPLICIT USER APPROVAL before execution.
- Verification: Task transcript contains an explicit approval before any DB-affecting command or file edit.
- Exception: None.

## Bug-Fix Protocol (Red-Green-Refactor)

Rule Name: Test-first bug fixing
- Trigger: Any bug-fix request.
- Requirement: MUST follow Red-Green-Refactor: add a failing automated test first, implement minimal fix, then refactor with tests still green.
- Verification: Diff and test run history show a failing test added before the fix and passing tests after.
- Exception: None.

Rule Name: Hard stop without reproduction
- Trigger: A bug is reported but no failing automated test can be produced.
- Requirement: MUST stop implementation and request more information or a deterministic repro.
- Verification: No bug-fix code is merged without a failing test.
- Exception: None.

## Evidence-Based Debugging

Rule Name: No-guess debugging
- Trigger: Root-cause analysis, triage, and fix selection.
- Requirement: NEVER guess. MUST document expected vs actual behavior and cite evidence from tests, logs, traces, compiler, linter, or deterministic repro steps.
- Verification: Task summary includes concrete evidence references for diagnosis and final fix.
- Exception: None.

## Lint And Formatting Workflow

Rule Name: Auto-fix first
- Trigger: Any lint or formatting issue.
- Requirement: MUST run auto-fix before manual style edits.
- Verification: Run `pnpm lint:fix` (or relevant package-level `lint:fix`) before manual formatting changes.
- Exception: None.

Rule Name: Narrow manual formatting
- Trigger: Residual lint/format issues after auto-fix.
- Requirement: Manual edits MUST be limited to unresolved issues and MUST avoid unrelated reformatting.
- Verification: Diff scope remains focused and minimal.
- Exception: None.

## Verification Gates

Rule Name: Required validation before completion
- Trigger: Before declaring any code task complete.
- Requirement: MUST run checks relevant to changed scope: tests, type checks, and lint checks.
- Verification: Provide command results for relevant checks (for example `pnpm test`, `pnpm check:types`, `pnpm lint` or package-scoped equivalents).
- Exception: If a check cannot run, MUST report why and the residual risk.

## Naming Conventions

Rule Name: Kebab-case source files
- Trigger: Creating new source files.
- Requirement: New source files MUST use kebab-case names. PascalCase and camelCase filenames are prohibited.
- Verification: New filenames match kebab-case patterns such as `my-component.tsx`.
- Exception: ONLY IF framework-generated files require another convention.

## Async Reliability

Rule Name: No floating promises
- Trigger: Any async TypeScript code.
- Requirement: NEVER leave promises unhandled; MUST `await` or explicitly handle rejection.
- Verification: Lint, type checks, and review show explicit promise handling.
- Exception: None.

## API Compatibility

Rule Name: Stable public contracts
- Trigger: Changes to exported/public APIs.
- Requirement: MUST preserve backward compatibility unless breaking change is explicitly requested and documented.
- Verification: API diffs and release notes identify compatibility impact.
- Exception: Explicit user approval for breaking changes.

## Integration Before Invention

Rule Name: Reuse before new abstractions
- Trigger: Introducing utilities, models, services, or abstractions.
- Requirement: MUST evaluate and prefer existing repository patterns before creating parallel abstractions.
- Verification: Change summary identifies reused/refactored components or documents why reuse was not viable.
- Exception: None.

## Lint Suppression Discipline

Rule Name: Suppression minimalism
- Trigger: Adding lint suppression comments or config overrides.
- Requirement: Suppressions MUST be rare, narrowly scoped, and include a concrete reason.
- Verification: Every new suppression line includes justification.
- Exception: None.

## UI Regression Coverage

Rule Name: Story coverage for UI changes
- Trigger: Non-trivial UI changes in packages with Storybook support.
- Requirement: MUST add or update stories and run Storybook validation when available.
- Verification: Story changes exist and relevant Storybook command (for example `pnpm --filter @looopy-ai/react storybook` or `build-storybook`) is run when needed.
- Exception: Purely internal refactors with no visual behavior change.

## Changeset Policy

Rule Name: Changeset required for code changes
- Trigger: Any code change that affects published packages.
- Requirement: MUST create a changeset file at `.changeset/{id}.md` with only affected packages and valid bump levels `patch|minor|major`.
- Verification: Diff contains a new changeset file with correct frontmatter.
- Exception: Documentation-only or test-only changes that do not affect published package behavior.

Rule Name: Changeset format
- Trigger: Writing a changeset file.
- Requirement: MUST use this format:

```md
---
"@looopy-ai/aws": patch
"@looopy-ai/core": minor
"@looopy-ai/react": major
---

Description of change
```

- Verification: Frontmatter is valid YAML and package list matches changed published packages.
- Exception: None.
