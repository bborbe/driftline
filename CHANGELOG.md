# Changelog

All notable changes to this project will be documented in this file.

Please choose versions by [Semantic Versioning](http://semver.org/).

* MAJOR version when you make incompatible API changes,
* MINOR version when you add functionality in a backwards-compatible manner, and
* PATCH version when you make backwards-compatible bug fixes.

Each release is a `vX.Y.Z` tag; `release.yml` runs the fast and slow test tiers and publishes the tag's section below as the GitHub release notes. Add changes under `## Unreleased`; a release renames it.

## Unreleased

- fix: the gamepad press that wakes the pad now counts — browsers reveal a pad only on its first button press after each page load, and that press (A on Begin after a track pick, the first d-pad step) was swallowed; the H panel says to press any button, then reload, when no "Controller connected" toast shows

## v0.2.0

- chore: opt into the maintainer bots (`.maintainer.yaml`: auto-approve, auto-release, trivial auto-merge); `release.yml` takes the version from the tag instead of requiring it to equal `package.json`
- feat: shareable challenge links — Results → Challenge a friend copies a URL with the target time and the session's best-lap ghost (lossless, ≤ 8192 chars, else target only); opening it races that ghost under the sender's Settings name, and a bad link says why over the start menu

## v0.1.0

- feat: split tests into a fast tier (every PR, `make test`) and a slow tier (releases, nightly on master, `make test-all`)
- feat: release workflow on `v*` tags and a nightly slow run on master that opens a `nightly-failure` issue when red
