# Changelog

Each release is a `vX.Y.Z` tag; `release.yml` runs the fast and slow test tiers and publishes the tag's
section below as the GitHub release notes. Add changes under `## Unreleased`; a release renames it.

## v0.1.0

- First release. Tests split into a fast tier (every PR, `make test`) and a slow tier (releases, nightly on master, `make test-all`)
- Release workflow on `v*` tags and nightly slow run on master that opens a `nightly-failure` issue when red
