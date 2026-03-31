import { readdir, readFile, stat } from "fs/promises";
import { join, basename } from "path";
import chalk from "chalk";
import { getClaudeProjectsDir } from "../utils/paths.js";
import {
  header,
  subheader,
  item,
  warning,
  badge,
  divider,
  table,
  danger,
} from "../utils/display.js";

type MemoryFile = {
  path: string;
  project: string;
  name: string;
  description: string;
  type: string;
  content: string;
  size: number;
  modified: Date;
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

async function findMemoryFiles(): Promise<MemoryFile[]> {
  const projectsDir = getClaudeProjectsDir();
  const memories: MemoryFile[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return [];
  }

  for (const projDir of projectDirs) {
    const memoryDir = join(projectsDir, projDir, "memory");
    let files: string[];
    try {
      files = await readdir(memoryDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".md") || file === "MEMORY.md") continue;
      const filePath = join(memoryDir, file);
      try {
        const content = await readFile(filePath, "utf-8");
        const stats = await stat(filePath);
        const { meta, body } = parseFrontmatter(content);
        memories.push({
          path: filePath,
          project: projDir.replace(/-/g, "/"),
          name: meta.name || basename(file, ".md"),
          description: meta.description || "",
          type: meta.type || "unknown",
          content: body,
          size: stats.size,
          modified: stats.mtime,
        });
      } catch {
        continue;
      }
    }
  }
  return memories;
}

async function findMemoryIndexes(): Promise<
  { project: string; entries: string[] }[]
> {
  const projectsDir = getClaudeProjectsDir();
  const indexes: { project: string; entries: string[] }[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return [];
  }

  for (const projDir of projectDirs) {
    const indexPath = join(projectsDir, projDir, "memory", "MEMORY.md");
    try {
      const content = await readFile(indexPath, "utf-8");
      const entries = content
        .split("\n")
        .filter((l) => l.trim().startsWith("-"));
      indexes.push({ project: projDir.replace(/-/g, "/"), entries });
    } catch {
      continue;
    }
  }
  return indexes;
}

export async function scanMemory(): Promise<string> {
  const output: string[] = [];
  output.push(header("MEMORY — What Claude Remembers About You"));

  const memories = await findMemoryFiles();
  const indexes = await findMemoryIndexes();

  if (memories.length === 0 && indexes.length === 0) {
    output.push("  No memory files found.");
    return output.join("\n");
  }

  // Summary
  const byType: Record<string, number> = {};
  const byProject: Record<string, MemoryFile[]> = {};
  for (const m of memories) {
    byType[m.type] = (byType[m.type] || 0) + 1;
    if (!byProject[m.project]) byProject[m.project] = [];
    byProject[m.project].push(m);
  }

  output.push(subheader("Summary"));
  output.push(
    table([
      ["Total memory files", String(memories.length)],
      ["Projects tracked", String(Object.keys(byProject).length)],
      ["Total size", formatBytes(memories.reduce((a, m) => a + m.size, 0))],
    ]),
  );

  output.push(subheader("By Type"));
  const typeColors: Record<string, string> = {
    user: "magenta",
    feedback: "yellow",
    project: "blue",
    reference: "green",
  };
  for (const [type, count] of Object.entries(byType)) {
    const color = typeColors[type] || "white";
    output.push(
      `  ${badge(type, color as any)} ${count} ${count === 1 ? "memory" : "memories"}`,
    );
  }

  // Check for sensitive content patterns
  output.push(subheader("Sensitivity Scan"));
  let sensitiveCount = 0;
  const sensitivePatterns = [
    { pattern: /api[_-]?key/i, label: "API key reference" },
    { pattern: /password/i, label: "Password reference" },
    { pattern: /secret/i, label: "Secret reference" },
    { pattern: /token/i, label: "Token reference" },
    { pattern: /credential/i, label: "Credential reference" },
    { pattern: /\b[A-Za-z0-9+/]{40,}\b/, label: "Possible encoded secret" },
  ];

  for (const m of memories) {
    for (const { pattern, label } of sensitivePatterns) {
      if (pattern.test(m.content)) {
        output.push(
          warning(`${label} found in ${chalk.white(m.name)} (${m.project})`),
        );
        sensitiveCount++;
      }
    }
  }
  if (sensitiveCount === 0) {
    output.push("  No obvious sensitive data found in memory files.");
  }

  // Detail per project
  output.push(divider());
  output.push(subheader("Memory Contents"));

  for (const [project, mems] of Object.entries(byProject)) {
    output.push(`\n  ${chalk.bold(truncatePath(project))}`);
    for (const m of mems.sort(
      (a, b) => b.modified.getTime() - a.modified.getTime(),
    )) {
      const typeColor = typeColors[m.type] || "white";
      output.push(
        `    ${badge(m.type, typeColor as any)} ${chalk.white(m.name)}`,
      );
      if (m.description) {
        output.push(`      ${chalk.dim(m.description)}`);
      }
      // Show preview of content (first 3 lines)
      const preview = m.content.split("\n").slice(0, 3).join("\n");
      for (const line of preview.split("\n")) {
        output.push(`      ${chalk.dim("│")} ${chalk.dim(line.slice(0, 80))}`);
      }
      output.push(
        `      ${chalk.dim(`Modified: ${m.modified.toLocaleDateString()} · ${formatBytes(m.size)}`)}`,
      );
    }
  }

  return output.join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function truncatePath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 4) return "/" + parts.join("/");
  return "/.../" + parts.slice(-3).join("/");
}
