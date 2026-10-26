---
status: idea
kind: bug
---

# Build Failure: bborbe/driftline

Filed automatically by the build-fix agent for the CI episode `f93766d18320271128a5a06e36da63d8d40dd46f`.

## Summary

The default-branch build for `bborbe/driftline` is failing; the build-fix diagnosis classified this as a code/test bug (verdict `file_spec`).

## Reproduction

Failing workflow(s): Test (slow tier)

Episode SHA: `f93766d18320271128a5a06e36da63d8d40dd46f`

Log evidence:

```text
| Workflow | Job | Failed Step | Run |
|---|---|---|---|
| Nightly slow tests | slow | Test (slow tier) | [Run](https://github.com/bborbe/driftline/actions/runs/40296268653) |
```

## Expected vs Actual

**Expected:** green CI on the default branch.
**Actual:** `The only failure is a Vitest timeout ("Test timed out in 5000ms") at src/render/track/geometry.test.ts:376 in the parameterized `it.each([...])` over track names, with 980/981 tests passing and no dependency, go.sum, or vulnerability signal anywhere in the evidence, so the root cause is repo test/code (a heavy per-track test exceeding the default 5s timeout) rather than a stale dependency.`

## Why this is a bug

The default-branch build is the repository's quality gate; a red build blocks merges. Diagnosis: `The only failure is a Vitest timeout ("Test timed out in 5000ms") at src/render/track/geometry.test.ts:376 in the parameterized `it.each([...])` over track names, with 980/981 tests passing and no dependency, go.sum, or vulnerability signal anywhere in the evidence, so the root cause is repo test/code (a heavy per-track test exceeding the default 5s timeout) rather than a stale dependency.`
