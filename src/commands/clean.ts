import { readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { join, basename } from "path";
import chalk from "chalk";
import { Command } from "commander";
import { getClaudeProjectsDir } from "../utils/paths.js";
import {
  header,
  subheader,
  success,
  warning,
  info,
  table,
} from "../utils/display.js";

type MemoryFile = {
  path: string;
  project: string;
  name: string;
  size: number;
  modified: Date;
  indexPath: string;
};

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
        const stats = await stat(filePath);
        memories.push({
          path: filePath,
          project: projDir.replace(/-/g, "/"),
          name: basename(file, ".md"),
          size: stats.size,
          modified: stats.mtime,
          indexPath: join(memoryDir, "MEMORY.md"),
        });
      } catch {
        continue;
      }
    }
  }
  return memories;
}

async function removeFromIndex(
  indexPath: string,
  fileName: string,
): Promise<void> {
  try {
    const content = await readFile(indexPath, "utf-8");
    const lines = content.split("\n");
    const filtered = lines.filter((line) => !line.includes(fileName));
    if (filtered.length !== lines.length) {
      await writeFile(indexPath, filtered.join("\n"), "utf-8");
    }
  } catch {
    // index file may not exist
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function registerCleanCommand(program: Command): void {
  program
    .command("clean")
    .description("Delete memory files by project or age")
    .option(
      "--project <name>",
      "Only target memories for a specific project (partial match)",
    )
    .option(
      "--older-than <days>",
      "Only target memories older than N days",
      parseInt,
    )
    .option("--dry-run", "Show what would be deleted without deleting")
    .action(async (opts) => {
      const output: string[] = [];
      output.push(header("CLEAN — Memory File Cleanup"));

      let memories = await findMemoryFiles();

      if (memories.length === 0) {
        output.push("\n  No memory files found.");
        console.log(output.join("\n"));
        return;
      }

      // Apply filters
      if (opts.project) {
        memories = memories.filter((m) =>
          m.project.toLowerCase().includes(opts.project.toLowerCase()),
        );
      }
      if (opts.olderThan) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - opts.olderThan);
        memories = memories.filter((m) => m.modified < cutoff);
      }

      if (memories.length === 0) {
        output.push("\n  No memory files match the filters.");
        console.log(output.join("\n"));
        return;
      }

      const totalSize = memories.reduce((a, m) => a + m.size, 0);
      output.push(subheader("Matched Files"));
      output.push(
        table([
          ["Files", String(memories.length)],
          ["Total size", formatBytes(totalSize)],
        ]),
      );

      // Group by project
      const byProject: Record<string, MemoryFile[]> = {};
      for (const m of memories) {
        if (!byProject[m.project]) byProject[m.project] = [];
        byProject[m.project].push(m);
      }

      for (const [project, mems] of Object.entries(byProject)) {
        output.push(`\n  ${chalk.bold(project)}`);
        for (const m of mems.sort(
          (a, b) => b.modified.getTime() - a.modified.getTime(),
        )) {
          const age = Math.floor(
            (Date.now() - m.modified.getTime()) / 86400000,
          );
          output.push(
            `    ${chalk.dim("×")} ${chalk.white(m.name)} ${chalk.dim(`(${formatBytes(m.size)}, ${age}d ago)`)}`,
          );
        }
      }

      if (opts.dryRun) {
        output.push(info("\nDry run — no files deleted."));
        console.log(output.join("\n"));
        return;
      }

      // Delete files
      let deleted = 0;
      for (const m of memories) {
        try {
          await unlink(m.path);
          await removeFromIndex(m.indexPath, basename(m.path));
          deleted++;
        } catch {
          output.push(warning(`Failed to delete: ${m.name}`));
        }
      }

      output.push(
        success(
          `\nDeleted ${deleted} memory files (${formatBytes(totalSize)} freed).`,
        ),
      );
      console.log(output.join("\n"));
    });
}
