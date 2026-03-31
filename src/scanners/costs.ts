import { readdir, readFile } from "fs/promises";
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

type ProjectCostData = {
  project: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  webSearchRequests: number;
  linesAdded: number;
  linesRemoved: number;
  apiDuration: number;
  wallDuration: number;
  modelUsage: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
      webSearchRequests: number;
    }
  >;
};

async function readProjectConfigs(): Promise<ProjectCostData[]> {
  const projectsDir = getClaudeProjectsDir();
  const results: ProjectCostData[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return [];
  }

  for (const projDir of projectDirs) {
    const configPath = join(projectsDir, projDir, ".config.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      if (!config.lastCost && !config.lastTotalInputTokens) continue;

      results.push({
        project: projDir.replace(/-/g, "/"),
        totalCost: config.lastCost || 0,
        inputTokens: config.lastTotalInputTokens || 0,
        outputTokens: config.lastTotalOutputTokens || 0,
        cacheReadTokens: config.lastTotalCacheReadInputTokens || 0,
        cacheCreationTokens: config.lastTotalCacheCreationInputTokens || 0,
        webSearchRequests: config.lastTotalWebSearchRequests || 0,
        linesAdded: config.lastLinesAdded || 0,
        linesRemoved: config.lastLinesRemoved || 0,
        apiDuration: config.lastAPIDuration || 0,
        wallDuration: config.lastDuration || 0,
        modelUsage: config.lastModelUsage || {},
      });
    } catch {
      continue;
    }
  }
  return results;
}

export async function scanCosts(): Promise<string> {
  const output: string[] = [];
  output.push(header("COSTS — Token Usage & Spend Breakdown"));

  const projects = await readProjectConfigs();

  if (projects.length === 0) {
    output.push("  No cost data found. Run Claude Code first.");
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
  const totalWebSearch = projects.reduce((a, p) => a + p.webSearchRequests, 0);
  const totalLinesAdded = projects.reduce((a, p) => a + p.linesAdded, 0);
  const totalLinesRemoved = projects.reduce((a, p) => a + p.linesRemoved, 0);

  output.push(subheader("Aggregate (Last Session Per Project)"));
  output.push(
    table([
      ["Total spend", costFmt(totalCost)],
      ["Input tokens", formatNumber(totalInput)],
      ["Output tokens", formatNumber(totalOutput)],
      ["Cache read tokens", formatNumber(totalCacheRead)],
      ["Cache write tokens", formatNumber(totalCacheWrite)],
      ["Web search requests", String(totalWebSearch)],
      ["Code changes", `+${totalLinesAdded} / -${totalLinesRemoved} lines`],
      ["Projects", String(projects.length)],
    ]),
  );

  // Cache efficiency
  if (totalInput > 0) {
    const cacheHitRate = (totalCacheRead / (totalInput + totalCacheRead)) * 100;
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

    // Multi-model note
    const modelNames = Object.keys(modelTotals);
    if (modelNames.length > 1) {
      output.push(divider());
      output.push(subheader("Multi-Model Usage"));
      output.push(
        info(`${modelNames.length} different models used across sessions.`),
      );
    }
  }

  // Per-project breakdown
  output.push(divider());
  output.push(subheader("Per-Project Costs"));
  const sortedProjects = projects.sort((a, b) => b.totalCost - a.totalCost);
  for (const proj of sortedProjects.slice(0, 15)) {
    output.push(
      `  ${costFmt(proj.totalCost)}  ${chalk.white(truncatePath(proj.project))}`,
    );
    output.push(
      `    ${chalk.dim(`+${proj.linesAdded}/-${proj.linesRemoved} lines · ${formatNumber(proj.inputTokens + proj.outputTokens)} tokens`)}`,
    );
    if (proj.wallDuration > 0) {
      const costPerHour = proj.totalCost / (proj.wallDuration / 3600000);
      output.push(
        `    ${chalk.dim(`Wall time: ${formatDuration(proj.wallDuration)} · ${costFmt(costPerHour)}/hr`)}`,
      );
    }
  }
  if (sortedProjects.length > 15) {
    output.push(
      chalk.dim(`  ... and ${sortedProjects.length - 15} more projects`),
    );
  }

  return output.join("\n");
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function truncatePath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 4) return "/" + parts.join("/");
  return "/.../" + parts.slice(-3).join("/");
}
