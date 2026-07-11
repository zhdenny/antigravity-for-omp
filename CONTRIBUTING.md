# Contributing

Thanks for your interest! This is an early-stage, MIT-licensed community project —
issues, PRs, and even a ⭐ all genuinely help shape where it goes.

**Not sure where to start?** Look for the
[`good first issue`](https://github.com/zhdenny/antigravity-for-omp/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
label.

## What's especially welcome

- **More A/B data points** — repeat the measured runs (n>1) for tighter confidence ([`docs/AB-RESULTS.md`](docs/AB-RESULTS.md)).
- **New SDLC recipes** — when-to-delegate patterns in [`skills/antigravity/SKILL.md`](skills/antigravity/SKILL.md).
- **Support for other CLIs / models** — the delegation wrapper is intentionally thin.
- **Real Vertex prices** — keep [`prices.json`](prices.json) accurate.

## Dev setup

You need the [Antigravity CLI](https://antigravity.google/docs/cli-using) (`agy`,
authenticated — `agy models` should list Gemini models) and oh-my-pi.

```bash
git clone https://github.com/zhdenny/antigravity-for-omp ~/antigravity-for-omp
cd ~/antigravity-for-omp

# load the plugin live from your working tree:
omp plugin link .
```

The scripts also run standalone — handy for quick iteration:

```bash
scripts/agy-delegate.sh --tier flash "Summarize this in 3 bullets: ..."
```

## Before you open a PR

```bash
bash tests/run-tests.sh          # dependency-free; stubs `agy`, no network
shellcheck scripts/*.sh tests/*.sh   # CI gates on --severity=error
```

- **Tests pass** and shellcheck is clean (CI runs both — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
- If you touch a manifest, `python3 -c "import json; json.load(open('.omp-plugin/marketplace.json'))"` (and `marketplace.json`, `prices.json`) still parse.
- **Keep the skill honest.** [`skills/antigravity/SKILL.md`](skills/antigravity/SKILL.md) is the plugin's brain — if behavior changes, update it. Don't claim a capability the code doesn't have.
- **Cost numbers are estimates.** If you quote figures, say so and point at `prices.json`.
- Add a line to [`CHANGELOG.md`](CHANGELOG.md) under "Unreleased".

## Conventions

- Small, focused PRs. Describe *what changed and why*; link the issue.
- Match the surrounding style — POSIX-ish bash, `set -euo pipefail`, quote expansions.
- New scripts get a `usage()` and a test in `tests/run-tests.sh`.

## Reporting bugs / ideas

Open an issue with what you ran (`agy --version`, the command, OS) and what you
expected vs. saw. Feature ideas welcome too — even half-formed ones.

By contributing you agree your work is licensed under the project's [MIT License](LICENSE).
