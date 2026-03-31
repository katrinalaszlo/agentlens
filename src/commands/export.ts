import { readdir, readFile, stat, writeFile } from "fs/promises";
import { join, basename } from "path";
import chalk from "chalk";
import { Command } from "commander";
import { getClaudeProjectsDir } from "../utils/paths.js";
import { header, subheader, success, info, table } from "../utils/display.js";

type ExportData = {
  exportedAt: string;
  version: string;
  memory?: MemoryExport[];
  sessions?: SessionExport[];
  costs?: CostExport[];
};

type MemoryExport = {
  project: string;
  name: string;
  type: string;
  content: string;
  size: number;
  modified: string;
};

type SessionExport = {
  project: string;
  file: string;
  size: number;
  modified: string;
  messageCount: number;
};

type CostExport = {
  project: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  modelUsage: Record<string, unknown>;
};

function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: match[2].trim() };
}

async function collectMemory(): Promise<MemoryExport[]> {
  const projectsDir = getClaudeProjectsDir();
  const results: MemoryExport[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return [];
  }

  for (const projDir of projectDirs) {
    const memoryDir = join(projectsDir, projDir, "memory");
    try {
      const files = await readdir(memoryDir);
      for (const file of files) {
        if (!file.endsWith(".md") || file === "MEMORY.md") continue;
        const filePath = join(memoryDir, file);
        try {
          const content = await readFile(filePath, "utf-8");
          const stats = await stat(filePath);
          const { meta, body } = parseFrontmatter(content);
          results.push({
            project: projDir.replace(/-/g, "/"),
            name: meta.name || basename(file, ".md"),
            type: meta.type || "unknown",
            content: body,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return results;
}

async function collectSessions(): Promise<SessionExport[]> {
  const projectsDir = getClaudeProjectsDir();
  const results: SessionExport[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return [];
  }

  for (const projDir of projectDirs) {
    const sessionsDir = join(projectsDir, projDir, "sessions");
    try {
      const files = await readdir(sessionsDir);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = join(sessionsDir, file);
        try {
          const content = await readFile(filePath, "utf-8");
          const stats = await stat(filePath);
          const messageCount = content
            .split("\n")
            .filter((l) => l.trim()).length;
          results.push({
            project: projDir.replace(/-/g, "/"),
            file,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            messageCount,
          });
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return results;
}

async function collectCosts(): Promise<CostExport[]> {
  const projectsDir = getClaudeProjectsDir();
  const results: CostExport[] = [];

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
        modelUsage: config.lastModelUsage || {},
      });
    } catch {
      continue;
    }
  }
  return results;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Export Claude Code data to portable JSON")
    .option("--output <path>", "Output file path")
    .option("--memory", "Export only memory files")
    .option("--sessions", "Export only session metadata")
    .option("--costs", "Export only cost data")
    .action(async (opts) => {
      const output: string[] = [];
      output.push(header("EXPORT — Data Export"));

      const exportSpecific = opts.memory || opts.sessions || opts.costs;

      const data: ExportData = {
        exportedAt: new Date().toISOString(),
        version: "0.1.0",
      };

      if (!exportSpecific || opts.memory) {
        data.memory = await collectMemory();
      }
      if (!exportSpecific || opts.sessions) {
        data.sessions = await collectSessions();
      }
      if (!exportSpecific || opts.costs) {
        data.costs = await collectCosts();
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outPath = opts.output || `./agentlens-export-${timestamp}.json`;
      const json = JSON.stringify(data, null, 2);
      await writeFile(outPath, json, "utf-8");

      output.push(subheader("Export Complete"));
      output.push(
        table([
          ["File", outPath],
          ["Size", formatBytes(Buffer.byteLength(json))],
          ["Memories", String(data.memory?.length ?? 0)],
          ["Sessions", String(data.sessions?.length ?? 0)],
          ["Cost entries", String(data.costs?.length ?? 0)],
        ]),
      );

      console.log(output.join("\n"));
    });
}
