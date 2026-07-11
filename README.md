<div align="center">

# 🛰️ Antigravity for oh-my-pi

**Run the Antigravity CLI (Gemini) as a collaborating AI inside omp, with intelligent model routing across the SDLC.**

The conductor orchestrates the judgement; Gemini does the heavy lifting — intelligent model routing across the SDLC.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Antigravity CLI](https://img.shields.io/badge/Antigravity%20CLI-agy-4285F4?logo=googlegemini&logoColor=white)](https://antigravity.google/docs/cli-using)

</div>

---

> Ported from [yuting0624/antigravity-for-claude-code](https://github.com/yuting0624/antigravity-for-claude-code) (MIT).

---

## ⚡ Quick look

The conductor stays the orchestrator; the bulk, token-heavy read runs on cheaper Gemini, and the conductor verifies the result.

---

## 💡 Why

| | Conductor (frontier LLM) | Gemini / `agy` (executor) |
|---|---|---|
| **Owns** | requirements · architecture · the hard 20% · **verification** · review | scaffold · implementation · test generation · search |
| **Strength** | judgement | cheap, fast throughput |

```
you → omp (conduct: design / verify / review)
         └── agy → Gemini (execute: implement / test / search)
```

> *Generation is solved; verification, judgement, and direction are the craft.*

## ✨ What it does

- **Routes work across the SDLC** — the conductor keeps the judgement calls; Antigravity handles scaffolding, **test generation**, **first-pass review**, and **migrations** under a shared `AGENTS.md`.
- **Adds tools the conductor lacks natively** — live **Google/web search**, **Vertex AI Search** over your internal data, deep research, Cloud Logging. The conductor reviews and re-checks the results.
- **Cross-model verification** — an independent, different-model opinion on your code.
- **Background jobs** — fire a long delegation, keep working, collect later.
- **Internal fan-out** — one delegation, and agy spawns its own subagents on the cheap side (dynamic `define_subagent` on agy ≥ 1.0.16; `TypeName "self"` + Role on any version); each leaves a **readable trajectory** you audit with `agy-trace`.
- **Built-in cost discipline** — measured, not guessed (see below).
- **Drops in with the discipline on** — the extension injects the *cost-aware* routing policy at session start, and the `agy_delegate` tool does file **writing** on Gemini, so the conductor spends **no tokens generating file contents**.

## 📊 Measured results

On a **large** ADK multi-agent build (+ `adk eval`), same task / same model, 3 ways:

| | solo @high | solo @max | **hybrid** |
|---|---|---|---|
| frontier cost (COST-WEIGHTED) | 2.62M | 5.34M | **1.91M** |
| quality (`adk eval`) | ✅ 3/3 | ✅ 3/3 | ✅ **3/3** |

→ **−27% vs solo@high, −64% vs solo@max, at equal quality** — and the cheap Gemini work isn't even counted. Savings scale with task size; tiny one-off tasks are cheaper to just run on the conductor. Full A/B: [`docs/AB-RESULTS.md`](docs/AB-RESULTS.md).

> **Note on cost figures:** numbers are **estimates** — token counts are approximated and rates live in [`prices.json`](prices.json). **Set your real Vertex rates there before quoting any figure.**

## 🚀 Install

```bash
# Option A: npm/git install (full extension support — recommended)
omp plugin install github:zhdenny/antigravity-for-omp

# Option B: local development
git clone https://github.com/zhdenny/antigravity-for-omp ~/antigravity-for-omp
omp plugin link ~/antigravity-for-omp

# Verify
/antigravity-setup
```

**Prerequisites:** the [Antigravity CLI](https://antigravity.google/docs/cli-using) (`agy`) installed & authenticated (`agy models` lists Gemini models), and oh-my-pi. For the same-bill cost benefit, run the conductor on Vertex too.

**Platform support:** macOS, Linux, and **WSL** are the supported targets for headless delegation. **Native Windows (Git Bash/MSYS) is not recommended** — `agy -p` can hang with a 0-byte log when run without a real console (ConPTY). The wrapper bounds this with a wall-clock guard (GNU `timeout`/`gtimeout`, returning a clean TIMEOUT instead of hanging), and `doctor` distinguishes a hang from an auth failure — but for reliable headless use, run from **WSL/macOS/Linux**.

## 🧩 Slash commands

| command | what it does |
|---|---|
| `/antigravity-setup` | health check — `agy` installed + authenticated, scripts ready |
| `/antigravity-delegate [--tier flash\|pro] <task>` | delegate a subtask to agy under cost discipline, then verify |
| `/antigravity-review` | independent cross-model review of the current diff; the conductor reconciles |
| `/antigravity-research <topic>` | conductor-orchestrated deep research — agy does grounded web legwork, conductor verifies citations across ≥2 sources |
| `/antigravity-status [id]` · `/antigravity-result <id>` · `/antigravity-cancel <id>` | manage background delegation jobs |

---

<details>
<summary><b>🛠️ Direct script usage &amp; tiers</b></summary>

```bash
# one-shot delegation (plain text on stdout)
scripts/agy-delegate.sh --tier flash "Summarize this changelog in 3 bullets: ..."

# give Antigravity a workspace for multi-file agentic work
scripts/agy-delegate.sh --tier pro --dir ./src "List every TODO with file:line"

# bulk read -> digest-only reply (the biggest cost lever; wrapper warns on dump-sized replies)
scripts/agy-delegate.sh --digest --dir . "Map the auth flow end to end"

# live web / Google search (tools need --yolo in headless mode)
scripts/agy-delegate.sh --tier pro --yolo "Web-search <X>. Give URLs + dates."

# Vertex AI Search over internal data
scripts/agy-delegate.sh --tier pro --yolo "List Vertex AI Search engines (list_engines)."

# cross-model review / stdin / background job
scripts/agy-delegate.sh --tier pro "Review for bugs, be skeptical: <paste>"
cat big-prompt.txt | scripts/agy-delegate.sh -
ID=$(scripts/agy-job.sh start --tier pro --dir . "big task"); scripts/agy-job.sh result "$ID"
```

| tier | model | use for |
|------|-------|---------|
| `flash` (default) | Gemini 3.5 Flash (High) | most bulk work |
| `flash-lo` | Gemini 3.5 Flash (Low) | cheapest, trivial tasks |
| `pro` | Gemini 3.1 Pro (High) | harder reasoning / cross-checks |

**agy is multi-model.** Tiers default to Gemini, but you can use any model `agy models` lists
(Claude / GPT on plans that expose them): pass `--model "<exact name>"`.
Keep the executor a *different, cheaper* model than the conductor — that's what gives both
the cost saving and the cross-model verification.

</details>

<details>
<summary><b>💸 How to actually get the savings (cost discipline)</b></summary>

Delegation doesn't save money by itself — these do (also in the skill):

1. **Delegate above the break-even** — bulk/parallel/repetitive work, not tiny tasks.
2. **Keep the conductor's context lean** — don't re-read what agy already handled; take a **digest**, not raw output. (Biggest lever — it collapses `cache_read`.) Enforced in code: `--digest` appends a digest-only output contract, and the wrapper **warns when a reply comes back dump-sized** (tune via the `digest_warn_chars` plugin option).
3. **Batch** — one big delegation beats many round-trips.
4. **Review the diff, not the whole tree.**

`scripts/measure-session.py <session-id>` prints the COST-WEIGHTED + est. USD breakdown for a session (conductor side; Gemini side priced separately). `scripts/agy-cost-compare.sh` shows the per-token gap for a task — **estimates from char-count, so verify `prices.json` first.**

</details>

<details>
<summary><b>🚧 Guardrails &amp; known limits</b></summary>

> **Something broken?** See **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** — symptom-first fixes for Windows/WSL, writes that silently don't happen, quota/auth/timeout codes, and updating.

**Guardrails**
- Always **verify** agy's output (it can be wrong, and may even alter its environment to make a check pass — re-run gates yourself in a clean state).
- `--yolo` auto-approves every tool call — use with `--sandbox` or in a throwaway dir.
- Write tasks: run on a dedicated branch/worktree, review the diff before merging.

**Known limits (agy v1.0.x)**
- `-p`/`--print` **takes the prompt as its value** and must come last — the wrapper handles this.
- No `--output-format json` (plain text); `--print` drops stdout on a non-TTY unless stdin is detached (handled via `< /dev/null`).
- **Writes need `--yolo`:** without it, headless agy only *describes* edits and returns a confident success **without writing any files** ([issue #10](https://github.com/zhdenny/antigravity-for-omp/issues/10)). Pass `--yolo` for write tasks (on a branch).
- **Native Windows (no ConPTY):** headless `agy -p` / `agy models` can hard-hang with a 0-byte log when stdio is redirected. The wrapper wraps agy in a wall-clock `timeout`/`gtimeout` guard so it returns a structured TIMEOUT (exit 12) instead of hanging; `doctor` reports the likely hang instead of a misleading "not authenticated". Without `timeout` on PATH there's no safety net — use **WSL/macOS/Linux** for headless delegation.
- **WSL:** running agy with `--add-dir` on a Windows mount (`/mnt/c/...`) is very slow — agy reads the workspace over a 9p bridge, so even trivial calls can take 20s+. Keep the repo on the WSL Linux filesystem (`~`). The wrapper and `doctor` warn about this.

</details>

<details>
<summary><b>📦 What's inside · local dev · tests</b></summary>

```
extensions/index.ts      extension entry point (tools, commands, hooks)
skills/antigravity/SKILL.md   WHEN + HOW the conductor collaborates with agy
scripts/                  agy-delegate · agy-job · agy-cost-compare · agy-trace · measure-session · doctor
hooks/policy-context.json cost-aware routing policy injected at session start
docs/                     AB-RESULTS (measured A/B) · TROUBLESHOOTING · DEMO-KIT
prices.json               Vertex rate config (verify before quoting)
```

**Local development** (hack on the plugin — loads live files):
```bash
git clone https://github.com/zhdenny/antigravity-for-omp ~/antigravity-for-omp
cd ~/antigravity-for-omp
omp plugin link .
```

**Tests** (no dependencies; stubs `agy`):
```bash
bash tests/run-tests.sh
```

</details>

---

## 🤝 Contributing

Early-stage and MIT — issues, PRs, and ⭐ all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## ⚠️ Disclaimer

Community project. **Not affiliated with, endorsed by, or supported by Google or Anthropic.** "Antigravity", "Gemini", "Claude", "oh-my-pi", and "omp" are trademarks of their respective owners. This plugin orchestrates the third-party `agy` CLI; you are responsible for your own API/cloud costs, credentials, and data-sharing choices. MIT licensed — see [LICENSE](LICENSE).
