import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import chalk from "chalk";
import { getClaudeProjectsDir } from "../utils/paths.js";
import {
  header,
  subheader,
  item,
  table,
  cost as costFmt,
  divider,
  badge,
  info,
  warning,
} from "../utils/display.js";

// Anthropic pricing per million tokens (as of May 2025)
const MODEL_PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  "claude-opus-4-6": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 1,
  },
  // Older models that may appear in history
  "claude-sonnet-4-5-20250514": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
};

const DEFAULT_PRICING = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
};

type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
};

type ProjectCostData = {
  project: string;
  sessions: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  modelUsage: Record<string, ModelUsage>;
};

const unknownModels = new Set<string>();

function getPricing(model: string) {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  if (model.includes("opus")) return MODEL_PRICING["claude-opus-4-6"];
  if (model.includes("sonnet")) return MODEL_PRICING["claude-sonnet-4-6"];
  if (model.includes("haiku"))
    return MODEL_PRICING["claude-haiku-4-5-20251001"];
  unknownModels.add(model);
  return DEFAULT_PRICING;
}

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): number {
  const pricing = getPricing(model);
  return (
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheReadTokens * pricing.cacheRead +
      cacheCreationTokens * pricing.cacheWrite) /
    1_000_000
  );
}

async function readProjectCosts(): Promise<ProjectCostData[]> {
  const projectsDir = getClaudeProjectsDir();
  const results: ProjectCostData[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(`agentlens: could not read ${projectsDir}: ${err}`);
    }
    return [];
  }

  for (const projDir of projectDirs) {
    const projPath = join(projectsDir, projDir);
    try {
      const stats = await stat(projPath);
      if (!stats.isDirectory()) continue;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(`agentlens: could not stat ${projDir}: ${err}`);
      }
      continue;
    }

    let files: string[];
    try {
      files = await readdir(projPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(`agentlens: could not read ${projDir}: ${err}`);
      }
      continue;
    }

    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) continue;

    const modelUsage: Record<string, ModelUsage> = {};
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let totalCost = 0;

    let unreadableFiles = 0;
    for (const file of jsonlFiles) {
      const filePath = join(projPath, file);
      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        console.error(`agentlens: could not read ${file}: ${code || err}`);
        unreadableFiles++;
        continue;
      }

      const lines = content.split("\n").filter((l) => l.trim());
      let parseErrors = 0;

      // Deduplicate by message ID — streaming chunks repeat usage data.
      // Keep the last entry per message ID (has final output token count).
      const lastUsageByMsg = new Map<
        string,
        { model: string; usage: Record<string, unknown> }
      >();
      let anonCounter = 0;

      for (const line of lines) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line);
        } catch {
          parseErrors++;
          continue;
        }

        const msg = parsed.message as
          | {
              id?: string;
              usage?: Record<string, unknown>;
              model?: string;
            }
          | undefined;
        const usage = msg?.usage;
        if (!usage) continue;

        const msgId = msg?.id ?? `anon-${anonCounter++}`;
        lastUsageByMsg.set(msgId, {
          model: msg?.model || "unknown",
          usage,
        });
      }

      for (const [, { model, usage }] of lastUsageByMsg) {
        const input = Number(usage.input_tokens) || 0;
        const output = Number(usage.output_tokens) || 0;
        const cacheRead = Number(usage.cache_read_input_tokens) || 0;
        const cacheCreation = Number(usage.cache_creation_input_tokens) || 0;

        totalInput += input;
        totalOutput += output;
        totalCacheRead += cacheRead;
        totalCacheCreation += cacheCreation;

        if (!modelUsage[model]) {
          modelUsage[model] = {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0,
          };
        }
        modelUsage[model].inputTokens += input;
        modelUsage[model].outputTokens += output;
        modelUsage[model].cacheReadInputTokens += cacheRead;
        modelUsage[model].cacheCreationInputTokens += cacheCreation;

        const msgCost = estimateCost(
          model,
          input,
          output,
          cacheRead,
          cacheCreation,
        );
        modelUsage[model].costUSD += msgCost;
        totalCost += msgCost;
      }

      if (
        parseErrors > 0 &&
        (parseErrors === lines.length || parseErrors > 5)
      ) {
        const pct = ((parseErrors / lines.length) * 100).toFixed(0);
        console.error(
          `agentlens: ${file} — ${parseErrors}/${lines.length} lines failed to parse (${pct}%)`,
        );
      }
    }

    if (unreadableFiles > 0) {
      console.error(
        `agentlens: ${projDir} — ${unreadableFiles} session file(s) could not be read`,
      );
    }

    if (totalInput === 0 && totalOutput === 0) continue;

    results.push({
      project: projDir.replace(/-/g, "/"),
      sessions: jsonlFiles.length,
      totalCost,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheCreationTokens: totalCacheCreation,
      modelUsage,
    });
  }
  return results;
}

export async function scanCosts(): Promise<string> {
  unknownModels.clear();
  const output: string[] = [];
  output.push(header("COSTS — Token Usage & Spend Breakdown"));

  const projects = await readProjectCosts();

  if (projects.length === 0) {
    output.push(
      "  No cost data found. No session transcripts with usage data.",
    );
    return output.join("\n");
  }

  // Aggregate totals
  const totalCost = projects.reduce((a, p) => a + p.totalCost, 0);
  const totalInput = projects.reduce((a, p) => a + p.inputTokens, 0);
  const totalOutput = projects.reduce((a, p) => a + p.outputTokens, 0);
  const totalCacheRead = projects.reduce((a, p) => a + p.cacheReadTokens, 0);
  const totalCacheWrite = projects.reduce(
    (a, p) => a + p.cacheCreationTokens,
    0,
  );
  const totalSessions = projects.reduce((a, p) => a + p.sessions, 0);

  output.push(subheader("Aggregate (All Sessions)"));
  output.push(
    table([
      ["Estimated spend", costFmt(totalCost)],
      ["Input tokens", formatNumber(totalInput)],
      ["Output tokens", formatNumber(totalOutput)],
      ["Cache read tokens", formatNumber(totalCacheRead)],
      ["Cache write tokens", formatNumber(totalCacheWrite)],
      ["Sessions", String(totalSessions)],
      ["Projects", String(projects.length)],
    ]),
  );

  // Cache efficiency: reads as fraction of all cached tokens (reads + writes)
  const totalCacheable = totalCacheRead + totalCacheWrite;
  if (totalCacheable > 0) {
    const cacheHitRate = (totalCacheRead / totalCacheable) * 100;
    output.push(subheader("Cache Efficiency"));
    output.push(item("Cache hit rate", `${cacheHitRate.toFixed(1)}%`));
    if (cacheHitRate < 30) {
      output.push(
        warning("Low cache hit rate — you may be paying more than needed"),
      );
    }
  }

  // Model breakdown across all projects
  const modelTotals: Record<
    string,
    { input: number; output: number; cost: number; cacheRead: number }
  > = {};
  for (const proj of projects) {
    for (const [model, usage] of Object.entries(proj.modelUsage)) {
      if (!modelTotals[model])
        modelTotals[model] = { input: 0, output: 0, cost: 0, cacheRead: 0 };
      modelTotals[model].input += usage.inputTokens;
      modelTotals[model].output += usage.outputTokens;
      modelTotals[model].cost += usage.costUSD;
      modelTotals[model].cacheRead += usage.cacheReadInputTokens;
    }
  }

  if (Object.keys(modelTotals).length > 0) {
    output.push(subheader("Spend By Model"));
    const sorted = Object.entries(modelTotals).sort(
      (a, b) => b[1].cost - a[1].cost,
    );
    for (const [model, usage] of sorted) {
      const pct =
        totalCost > 0 ? ((usage.cost / totalCost) * 100).toFixed(0) : "0";
      output.push(
        `  ${badge(model, "blue")} ${costFmt(usage.cost)} ${chalk.dim(`(${pct}% of total)`)}`,
      );
      output.push(
        `    ${chalk.dim(`${formatNumber(usage.input)} in / ${formatNumber(usage.output)} out / ${formatNumber(usage.cacheRead)} cache`)}`,
      );
    }
  }

  // Per-project breakdown
  output.push(divider());
  output.push(subheader("Per-Project Costs"));
  const sortedProjects = projects.sort((a, b) => b.totalCost - a.totalCost);
  for (const proj of sortedProjects.slice(0, 15)) {
    output.push(
      `  ${costFmt(proj.totalCost)}  ${chalk.white(truncatePath(proj.project))} ${chalk.dim(`(${proj.sessions} sessions)`)}`,
    );
    output.push(
      `    ${chalk.dim(`${formatNumber(proj.inputTokens + proj.outputTokens)} tokens · ${formatNumber(proj.cacheReadTokens)} cache reads`)}`,
    );
  }
  if (sortedProjects.length > 15) {
    output.push(
      chalk.dim(`  ... and ${sortedProjects.length - 15} more projects`),
    );
  }

  output.push(divider());
  if (unknownModels.size > 0) {
    const models = [...unknownModels].filter(
      (m) => m !== "<synthetic>" && m !== "unknown",
    );
    if (models.length > 0) {
      output.push(
        warning(
          `Default pricing used for unrecognized model(s): ${models.join(", ")}. Costs may be inaccurate.`,
        ),
      );
    }
  }
  output.push(
    info(
      "Costs are estimates based on published Anthropic pricing. Actual billing may differ.",
    ),
  );

  return output.join("\n");
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function truncatePath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 4) return "/" + parts.join("/");
  return "/.../" + parts.slice(-3).join("/");
}
