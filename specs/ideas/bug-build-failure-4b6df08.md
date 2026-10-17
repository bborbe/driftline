---
status: idea
kind: bug
---

# Build Failure: bborbe/driftline

Filed automatically by the build-fix agent for the CI episode `4b6df0897a7339c3f00177e9b706b1d7501c4f05`.

## Summary

The default-branch build for `bborbe/driftline` is failing; the build-fix diagnosis classified this as a code/test bug (verdict `file_spec`).

## Reproduction

Failing workflow(s): deploy

Episode SHA: `4b6df0897a7339c3f00177e9b706b1d7501c4f05`

Log evidence:

```text
| Workflow | Job | Failed Step | Run |
|---|---|---|---|
| Deploy to GitHub Pages | deploy | Test | [Run](https://github.com/bborbe/driftline/actions/runs/39017319065) |
```

## Expected vs Actual

**Expected:** green CI on the default branch.
**Actual:** `Test 'an autopilot completes a 3-lap run: LAP 1/3 → 3/3 with no respawn' in src/race/full-lap.test.ts:74 times out after 5000ms, indicating a code bug where the LapLoop/FixedStepper simulation runs too slowly to complete within the default timeout. All other 1232 tests pass, so this is an isolated test failure caused by the autopilot implementation or test configuration, not a dependency or infrastructure issue.`

## Why this is a bug

The default-branch build is the repository's quality gate; a red build blocks merges. Diagnosis: `Test 'an autopilot completes a 3-lap run: LAP 1/3 → 3/3 with no respawn' in src/race/full-lap.test.ts:74 times out after 5000ms, indicating a code bug where the LapLoop/FixedStepper simulation runs too slowly to complete within the default timeout. All other 1232 tests pass, so this is an isolated test failure caused by the autopilot implementation or test configuration, not a dependency or infrastructure issue.`
