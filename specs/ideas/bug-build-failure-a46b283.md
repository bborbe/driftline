---
status: idea
kind: bug
---

# Build Failure: bborbe/driftline

Filed automatically by the build-fix agent for the CI episode `a46b283e34daa0e60b551f80c002065a09a7ca95`.

## Summary

The default-branch build for `bborbe/driftline` is failing; the build-fix diagnosis classified this as a code/test bug (verdict `file_spec`).

## Reproduction

Failing workflow(s): deploy

Episode SHA: `a46b283e34daa0e60b551f80c002065a09a7ca95`

Log evidence:

```text
| Workflow | Job | Failed Step | Run |
|---|---|---|---|
| Deploy to GitHub Pages | deploy | Test | [Run](https://github.com/bborbe/driftline/actions/runs/38992294239) |
```

## Expected vs Actual

**Expected:** green CI on the default branch.
**Actual:** `The test at src/race/golden-replay.test.ts:58 is a golden-replay test comparing sha256 hashes of output files against stored golden values. The ticks match exactly but sha256 hashes differ, indicating the golden files contain stale/incorrect expected hashes for the current code output. This is a test bug, not a dependency or Go build issue.`

## Why this is a bug

The default-branch build is the repository's quality gate; a red build blocks merges. Diagnosis: `The test at src/race/golden-replay.test.ts:58 is a golden-replay test comparing sha256 hashes of output files against stored golden values. The ticks match exactly but sha256 hashes differ, indicating the golden files contain stale/incorrect expected hashes for the current code output. This is a test bug, not a dependency or Go build issue.`
