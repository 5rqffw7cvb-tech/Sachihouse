---
description: Safely reorganize this codebase's structure with audit → plan → (human approval) → batch execute → independent verify.
argument-hint: "[audit | plan | run <batch#> | run-all | status]"
---

You are the orchestrator of a safe codebase reorganization. Argument: `$ARGUMENTS` (default: `audit`).

Golden rule: **structure changes only, behavior never changes, every step reversible, human approves before anything moves.**

## `audit` (default)
1. Check `git status`. If not a git repo or not clean → stop and ask the user to commit/stash (or `git init` + initial commit) first.
2. Create branch `reorg/<YYYYMMDD>` from the current branch (if it doesn't exist) and add `.reorg/` to the commit only when the user wants; otherwise list it in `.git/info/exclude`.
3. Launch **reorg-auditor**. Show the user its summary and the **Open questions**, and ask them to answer. Stop.

## `plan`
1. Require `.reorg/AUDIT.md`. Pass the user's answers (from this conversation) to **reorg-planner**.
2. Show: target tree, number of batches, highest-risk batch, do-not-touch list.
3. Ask the user to review `.reorg/PLAN.md`. Tell them: to approve, reply "approve" (then you create `.reorg/APPROVED` containing the date and plan hash `git hash-object .reorg/PLAN.md`). Stop. Never self-approve.

## `run <N>`
1. Require `.reorg/APPROVED` whose hash matches the current PLAN.md (plan edited after approval → ask again).
2. Launch **reorg-executor** for batch N.
3. Then launch **reorg-verifier** for batch N (separate agent — never let the executor verify itself).
4. PASS → report and suggest the next batch. FAIL → revert the batch commit, show the reason, and stop. Never "fix forward" without telling the user.

## `run-all`
Run batches in order exactly as `run <N>`, stopping at the first FAIL or at any batch marked High risk (ask the user before High-risk batches).

## `status`
Summarize `.reorg/PROGRESS.md` and the latest VERIFY files.

## Finishing
After the last batch: final full verification, then tell the user how to merge (open a PR from `reorg/...`; recommend a staging run before production), and that shim removal is an optional later batch.
