import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { resolve, dirname, join } from "path";
import { readFileSync, existsSync } from "fs";

export default function antigravity(pi: ExtensionAPI) {
  const PLUGIN_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const SCRIPTS = join(PLUGIN_ROOT, "scripts");

  // Default env vars the shell scripts expect (CLAUDE_PLUGIN_OPTION_* pattern preserved
  // so the existing scripts work unmodified). Override via OMP plugin settings.
  function scriptEnv(): Record<string, string> {
    return {
      ...process.env as Record<string, string>,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      CLAUDE_PLUGIN_OPTION_DEFAULT_TIER: "flash",
      CLAUDE_PLUGIN_OPTION_TIMEOUT: "5m",
    };
  }

  // ── A. Session-start hook: check agy + inject cost-aware policy ──
  pi.on("session_start", async (_event, ctx) => {
    // 1) Lightweight agy check (warns, never fails — mirrors hooks/check-agy.sh)
    try {
      const which = await pi.exec("command", ["-v", "agy"], { cwd: ctx.cwd });
      if (which.code !== 0) {
        ctx.ui.notify(
          "[antigravity] agy not on PATH — install the Antigravity CLI: https://antigravity.google/docs/cli-using",
          "warning"
        );
      }
    } catch { /* non-fatal */ }

    // 2) Inject cost-aware routing policy (mirrors hooks/inject-policy.sh)
    const policyFile = join(PLUGIN_ROOT, "hooks", "policy-context.json");
    if (existsSync(policyFile)) {
      try {
        const raw = JSON.parse(readFileSync(policyFile, "utf-8"));
        const policyText = raw?.hookSpecificOutput?.additionalContext ?? readFileSync(policyFile, "utf-8");
        pi.sendMessage(
          {
            customType: "antigravity-policy",
            content: policyText,
            display: false,
            attribution: "system",
          },
          { deliverAs: "nextTurn" }
        );
      } catch { /* non-fatal: skip policy if file is malformed */ }
    }
  });

  // Also re-inject policy after compaction (mirrors the "compact" matcher in hooks.json)
  pi.on("session_compact", async () => {
    const policyFile = join(PLUGIN_ROOT, "hooks", "policy-context.json");
    if (existsSync(policyFile)) {
      try {
        const raw = JSON.parse(readFileSync(policyFile, "utf-8"));
        const policyText = raw?.hookSpecificOutput?.additionalContext ?? readFileSync(policyFile, "utf-8");
        pi.sendMessage(
          { customType: "antigravity-policy", content: policyText, display: false, attribution: "system" },
          { deliverAs: "nextTurn" }
        );
      } catch { /* non-fatal */ }
    }
  });

  // ── B. Tool-call hook: bash validation gate for delegate mode ──
  // When the model is inside an antigravity-delegate task tool call,
  // block any bash command that isn't agy-delegate or agy-job.
  let delegateActive = false;

  pi.on("tool_call", async (event) => {
    if (!delegateActive) return;
    if (event.toolName !== "bash") return;
    const cmd = String((event.input as Record<string, unknown>).command ?? "");
    if (cmd.includes("agy-delegate") || cmd.includes("agy-job") || cmd.includes("scripts/")) return;
    return {
      block: true,
      reason: "[antigravity-delegate] this subagent may only run agy-delegate / agy-job via Bash. Delegate file work to agy; verification is the caller's job.",
    };
  });

  // ── C. LLM-callable tool: agy_delegate ──
  const z = pi.zod;

  pi.registerTool({
    name: "agy_delegate",
    label: "Antigravity Delegate",
    description:
      "Delegate work to Antigravity (agy/Gemini). USE for: bulk scaffolding, test generation, " +
      "code review, web/internal search, multi-source research, migrations, or any high-volume " +
      "deterministic work that saves context. AVOID for single-line edits or tiny tasks. " +
      "Caller owns verification. Read the `antigravity` skill for full routing policy.",
    parameters: z.object({
      task: z.string().describe("The task prompt for agy"),
      tier: z.enum(["flash", "flash-lo", "pro"]).optional().describe("Model tier (default: flash)"),
      dir: z.string().optional().describe("Workspace directory for agy (--dir)"),
      yolo: z.boolean().optional().describe("Auto-approve tool permissions (required for writes)"),
      sandbox: z.boolean().optional().describe("Run with terminal sandbox restrictions"),
      digest: z.boolean().optional().describe("Request digest-only output (compact bullets, no raw dumps)"),
      timeout: z.string().optional().describe("Print-mode timeout, e.g. 10m"),
      continue_session: z.boolean().optional().describe("Resume the most recent agy conversation"),
      conversation: z.string().optional().describe("Resume a specific agy conversation by ID"),
      model: z.string().optional().describe("Exact agy model name (overrides tier)"),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Delegating to Antigravity..." }] });

      const args: string[] = [];
      if (params.tier) args.push("--tier", params.tier);
      if (params.dir) args.push("--dir", params.dir);
      if (params.yolo) args.push("--yolo");
      if (params.sandbox) args.push("--sandbox");
      if (params.digest) args.push("--digest");
      if (params.timeout) args.push("--timeout", params.timeout);
      if (params.continue_session) args.push("--continue");
      if (params.conversation) args.push("--conversation", params.conversation);
      if (params.model) args.push("--model", params.model);
      args.push(params.task);

      delegateActive = true;
      try {
        const result = await pi.exec(join(SCRIPTS, "agy-delegate.sh"), args, {
          signal,
          cwd: ctx.cwd,
          env: scriptEnv(),
        });
        delegateActive = false;

        const stdout = result.stdout.trim();
        const stderr = result.stderr.trim();

        if (result.code !== 0) {
          return {
            content: [{ type: "text", text: `agy-delegate failed (exit ${result.code}):\n${stderr || stdout}` }],
            details: { exitCode: result.code, stderr },
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: stdout || "(empty output)" }],
          details: { exitCode: 0, charCount: stdout.length, stderr: stderr || undefined },
        };
      } catch (err) {
        delegateActive = false;
        throw err;
      }
    },
  });

  // ── D. LLM-callable tool: agy_job (background jobs) ──
  pi.registerTool({
    name: "agy_job",
    label: "Antigravity Job",
    description:
      "Manage background Antigravity delegation jobs. Actions: start (returns job ID), " +
      "status (check progress), result (collect output), cancel (stop a running job).",
    parameters: z.object({
      action: z.enum(["start", "status", "result", "cancel"]).describe("Job action"),
      id: z.string().optional().describe("Job ID (required for status/result/cancel)"),
      task: z.string().optional().describe("Task prompt (required for start)"),
      tier: z.enum(["flash", "flash-lo", "pro"]).optional(),
      dir: z.string().optional(),
      timeout: z.string().optional(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const args: string[] = [params.action];
      if (params.action === "start") {
        if (params.tier) args.push("--tier", params.tier);
        if (params.dir) args.push("--dir", params.dir);
        if (params.timeout) args.push("--timeout", params.timeout);
        if (params.task) args.push(params.task);
      } else {
        if (params.id) args.push(params.id);
      }

      const result = await pi.exec(join(SCRIPTS, "agy-job.sh"), args, {
        signal,
        cwd: ctx.cwd,
        env: scriptEnv(),
      });

      return {
        content: [{ type: "text", text: result.stdout.trim() || result.stderr.trim() || "(no output)" }],
        details: { exitCode: result.code, action: params.action },
        isError: result.code !== 0,
      };
    },
  });

  // ── E. LLM-callable tool: agy_doctor ──
  pi.registerTool({
    name: "agy_doctor",
    label: "Antigravity Doctor",
    description: "Health check — verify agy is installed, authenticated, and scripts are executable.",
    parameters: z.object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const result = await pi.exec(join(SCRIPTS, "doctor.sh"), [], {
        signal,
        cwd: ctx.cwd,
        env: scriptEnv(),
      });
      return {
        content: [{ type: "text", text: result.stdout.trim() || result.stderr.trim() || "(no output)" }],
        details: { exitCode: result.code },
        isError: result.code !== 0,
      };
    },
  });

  // ── F. Slash commands ──
  pi.registerCommand("antigravity-setup", {
    description: "Verify agy is installed and authenticated and the plugin is ready",
    handler: async (_args, ctx) => {
      pi.sendMessage(
        {
          customType: "antigravity-command",
          content:
            "Run the plugin's doctor and report status.\n\n" +
            "Run: `agy-doctor`\n\n" +
            "Then summarize for the user:\n" +
            "- Is `agy` installed, and can it list models (i.e. authenticated)?\n" +
            "- Are the plugin scripts executable?\n" +
            "- What GCP project / region / default model is `agy` configured for?\n\n" +
            "If anything is missing or failing, give the **exact** command to fix it.",
          display: true,
          attribution: "user",
        },
        { triggerTurn: true }
      );
    },
  });

  pi.registerCommand("antigravity-delegate", {
    description: "Delegate a well-scoped subtask to Antigravity (agy/Gemini) under cost discipline, then verify",
    handler: async (args, ctx) => {
      pi.sendMessage(
        {
          customType: "antigravity-command",
          content:
            `Delegate the following task to Antigravity (\`agy\` / Gemini) via the plugin wrapper,\n` +
            `following the \`antigravity\` skill's **Cost discipline** and **Verification gates**.\n\n` +
            `Task: ${args}\n\n` +
            `Do this:\n` +
            `1. Pick a tier (\`flash\` default; \`pro\` for hard reasoning). If the task needs the repo,\n` +
            `   add \`--dir <repo-root>\`. **If the task WRITES files or uses tools** add \`--yolo\`.\n` +
            `2. Run via the \`agy_delegate\` tool with the appropriate parameters.\n` +
            `3. Ingest only the result/digest — do NOT re-read the files agy already handled.\n` +
            `4. **Verify**: actually run/check the output; never trust a self-reported "done".`,
          display: true,
          attribution: "user",
        },
        { triggerTurn: true }
      );
    },
  });

  pi.registerCommand("antigravity-review", {
    description: "Independent cross-model review of the current diff from Antigravity (Gemini), then reconcile",
    handler: async (args, ctx) => {
      pi.sendMessage(
        {
          customType: "antigravity-command",
          content:
            `Use Antigravity (\`agy\` / Gemini) as an **independent, different-model reviewer** of the\n` +
            `current changes, then reconcile the findings yourself (you are the final judge).\n\n` +
            `Scope/flags: ${args}\n\n` +
            `Do this:\n` +
            `1. Capture the diff.\n` +
            `2. Delegate the review to agy (pro tier) via \`agy_delegate\` — pipe the diff,\n` +
            `   have it find correctness/security/performance bugs, be skeptical.\n` +
            `3. **Reconcile**: for each finding, corroborate against the actual code. Drop false positives.\n` +
            `4. Report the reconciled findings (most severe first) and your verdict.`,
          display: true,
          attribution: "user",
        },
        { triggerTurn: true }
      );
    },
  });

  pi.registerCommand("antigravity-research", {
    description: "Deep research — agy does grounded web legwork, you plan, verify citations, and synthesize",
    handler: async (args, ctx) => {
      pi.sendMessage(
        {
          customType: "antigravity-command",
          content:
            `Run a multi-source research pass on the topic below, following the \`antigravity\`\n` +
            `skill's **Deep-research recipe** and **Verification gates**.\n\n` +
            `Topic: ${args}\n\n` +
            `1. **Plan (you).** Break into 3–6 sub-questions + load-bearing claims to verify.\n` +
            `2. **Fan-out fetch (agy, cheap).** One \`agy_delegate\` call per sub-question, tier flash, --yolo.\n` +
            `3. **Deepen (agy).** For each load-bearing claim, have agy quote the supporting text.\n` +
            `4. **Adversarially verify (you).** Corroborate each key claim across ≥2 independent domains.\n` +
            `5. **Synthesize (you).** Write a cited report from verified findings only.`,
          display: true,
          attribution: "user",
        },
        { triggerTurn: true }
      );
    },
  });

  pi.registerCommand("antigravity-cloud-run-debug", {
    description: "Diagnose a failing Cloud Run service — agy digests logs, you infer root cause + fix",
    handler: async (args, ctx) => {
      pi.sendMessage(
        {
          customType: "antigravity-command",
          content:
            `Diagnose a Cloud Run service failure using Antigravity for log digestion and Cloud Logging.\n\n` +
            `Arguments: ${args}\n\n` +
            `Run \`cloud-debug\` script with the provided arguments via \`agy_delegate\` (pro tier, --yolo).\n` +
            `Parse the results, infer the root cause, propose a fix. Read-only by default.`,
          display: true,
          attribution: "user",
        },
        { triggerTurn: true }
      );
    },
  });

  pi.registerCommand("antigravity-status", {
    description: "Check status of background Antigravity delegation jobs",
    handler: async (args, ctx) => {
      pi.sendMessage(
        {
          customType: "antigravity-command",
          content: `Check the status of Antigravity background job(s): ${args || "(list all)"}`,
          display: true,
          attribution: "user",
        },
        { triggerTurn: true }
      );
    },
  });

  pi.registerCommand("antigravity-result", {
    description: "Collect the result of a background Antigravity delegation job",
    handler: async (args, ctx) => {
      pi.sendMessage(
        {
          customType: "antigravity-command",
          content: `Collect the result of Antigravity background job: ${args}`,
          display: true,
          attribution: "user",
        },
        { triggerTurn: true }
      );
    },
  });

  pi.registerCommand("antigravity-cancel", {
    description: "Cancel a running background Antigravity delegation job",
    handler: async (args, ctx) => {
      pi.sendMessage(
        {
          customType: "antigravity-command",
          content: `Cancel Antigravity background job: ${args}`,
          display: true,
          attribution: "user",
        },
        { triggerTurn: true }
      );
    },
  });
}
