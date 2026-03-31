import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import { join, basename } from "path";
import { createHash } from "crypto";
import chalk from "chalk";
import { Command } from "commander";
import { getClaudeProjectsDir } from "../utils/paths.js";
import {
  header,
  subheader,
  success,
  info,
  warning,
  table,
  badge,
} from "../utils/display.js";
import { homedir } from "os";

type MemoryEntry = {
  path: string;
  project: string;
  name: string;
  type: string;
  size: number;
  modified: string;
  contentHash: string;
};

type Snapshot = {
  savedAt: string;
  memories: MemoryEntry[];
  sessionCount: number;
  sessionSizeBytes: number;
  featureFlags: Record<string, unknown>;
};

function getSnapshotsDir(): string {
  return join(homedir(), ".agentlens", "snapshots");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return meta;
}

async function collectSnapshot(): Promise<Snapshot> {
  const projectsDir = getClaudeProjectsDir();
  const memories: MemoryEntry[] = [];
  let sessionCount = 0;
  let sessionSizeBytes = 0;
  let featureFlags: Record<string, unknown> = {};

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    projectDirs = [];
  }

  for (const projDir of projectDirs) {
    // Memory files
    const memoryDir = join(projectsDir, projDir, "memory");
    try {
      const files = await readdir(memoryDir);
      for (const file of files) {
        if (!file.endsWith(".md") || file === "MEMORY.md") continue;
        const filePath = join(memoryDir, file);
        try {
          const content = await readFile(filePath, "utf-8");
          const stats = await stat(filePath);
          const meta = parseFrontmatter(content);
          const hash = createHash("sha256")
            .update(content)
            .digest("hex")
            .slice(0, 16);
          memories.push({
            path: filePath,
            project: projDir.replace(/-/g, "/"),
            name: meta.name || basename(file, ".md"),
            type: meta.type || "unknown",
            size: stats.size,
            modified: stats.mtime.toISOString(),
            contentHash: hash,
          });
        } catch {
          continue;
        }
      }
    } catch {
      // no memory dir
    }

    // Sessions
    const sessionsDir = join(projectsDir, projDir, "sessions");
    try {
      const files = await readdir(sessionsDir);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        try {
          const stats = await stat(join(sessionsDir, file));
          sessionCount++;
          sessionSizeBytes += stats.size;
        } catch {
          continue;
        }
      }
    } catch {
      // no sessions dir
    }
  }

  // Feature flags
  try {
    const configPath = join(projectsDir, "..", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    featureFlags = config.cachedGrowthBookFeatures || {};
  } catch {
    // no config
  }

  return {
    savedAt: new Date().toISOString(),
    memories,
    sessionCount,
    sessionSizeBytes,
    featureFlags,
  };
}

export function registerDiffCommand(program: Command): void {
  const diff = program
    .command("diff")
    .description("Save snapshots and compare changes over time");

  diff
    .command("save")
    .description("Save a snapshot of current state")
    .action(async () => {
      const output: string[] = [];
      output.push(header("DIFF — Save Snapshot"));

      const snapshotsDir = getSnapshotsDir();
      await mkdir(snapshotsDir, { recursive: true });

      const snapshot = await collectSnapshot();
      const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const filePath = join(snapshotsDir, filename);
      await writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf-8");

      output.push(subheader("Snapshot Saved"));
      output.push(
        table([
          ["File", filePath],
          ["Memories", String(snapshot.memories.length)],
          ["Sessions", String(snapshot.sessionCount)],
          ["Feature flags", String(Object.keys(snapshot.featureFlags).length)],
        ]),
      );

      console.log(output.join("\n"));
    });

  diff
    .command("show")
    .description("Compare the two most recent snapshots")
    .action(async () => {
      const output: string[] = [];
      output.push(header("DIFF — Compare Snapshots"));

      const snapshotsDir = getSnapshotsDir();
      let files: string[];
      try {
        files = (await readdir(snapshotsDir))
          .filter((f) => f.endsWith(".json"))
          .sort()
          .reverse();
      } catch {
        output.push(
          warning("\n  No snapshots found. Run `agentlens diff save` first."),
        );
        console.log(output.join("\n"));
        return;
      }

      if (files.length < 2) {
        output.push(
          warning(
            "\n  Need at least 2 snapshots to compare. Run `agentlens diff save` again later.",
          ),
        );
        console.log(output.join("\n"));
        return;
      }

      const newer: Snapshot = JSON.parse(
        await readFile(join(snapshotsDir, files[0]), "utf-8"),
      );
      const older: Snapshot = JSON.parse(
        await readFile(join(snapshotsDir, files[1]), "utf-8"),
      );

      output.push(subheader("Comparing"));
      output.push(`  ${chalk.dim("Older:")} ${older.savedAt}`);
      output.push(`  ${chalk.dim("Newer:")} ${newer.savedAt}`);

      // Memory diff
      const olderMemPaths = new Map(older.memories.map((m) => [m.path, m]));
      const newerMemPaths = new Map(newer.memories.map((m) => [m.path, m]));

      const added = newer.memories.filter((m) => !olderMemPaths.has(m.path));
      const removed = older.memories.filter((m) => !newerMemPaths.has(m.path));
      const changed = newer.memories.filter((m) => {
        const old = olderMemPaths.get(m.path);
        return old && old.contentHash !== m.contentHash;
      });

      output.push(subheader("Memory Changes"));
      if (added.length === 0 && removed.length === 0 && changed.length === 0) {
        output.push("  No changes.");
      }
      for (const m of added) {
        output.push(
          `  ${badge("+", "green")} ${chalk.white(m.name)} ${chalk.dim(`(${m.project})`)}`,
        );
      }
      for (const m of removed) {
        output.push(
          `  ${badge("-", "red")} ${chalk.white(m.name)} ${chalk.dim(`(${m.project})`)}`,
        );
      }
      for (const m of changed) {
        output.push(
          `  ${badge("~", "yellow")} ${chalk.white(m.name)} ${chalk.dim(`(${m.project})`)}`,
        );
      }

      // Session diff
      output.push(subheader("Session Changes"));
      const sessionDelta = newer.sessionCount - older.sessionCount;
      const sizeDelta = newer.sessionSizeBytes - older.sessionSizeBytes;
      output.push(
        `  Sessions: ${older.sessionCount} → ${newer.sessionCount} (${sessionDelta >= 0 ? "+" : ""}${sessionDelta})`,
      );
      output.push(
        `  Size: ${formatBytes(older.sessionSizeBytes)} → ${formatBytes(newer.sessionSizeBytes)} (${sizeDelta >= 0 ? "+" : ""}${formatBytes(Math.abs(sizeDelta))})`,
      );

      // Feature flag diff
      const oldFlags = new Set(Object.keys(older.featureFlags));
      const newFlags = new Set(Object.keys(newer.featureFlags));
      const addedFlags = [...newFlags].filter((f) => !oldFlags.has(f));
      const removedFlags = [...oldFlags].filter((f) => !newFlags.has(f));

      if (addedFlags.length > 0 || removedFlags.length > 0) {
        output.push(subheader("Feature Flag Changes"));
        for (const f of addedFlags)
          output.push(`  ${badge("+", "green")} ${f}`);
        for (const f of removedFlags)
          output.push(`  ${badge("-", "red")} ${f}`);
      }

      console.log(output.join("\n"));
    });

  diff
    .command("list")
    .description("List all saved snapshots")
    .action(async () => {
      const output: string[] = [];
      output.push(header("DIFF — Saved Snapshots"));

      const snapshotsDir = getSnapshotsDir();
      let files: string[];
      try {
        files = (await readdir(snapshotsDir))
          .filter((f) => f.endsWith(".json"))
          .sort()
          .reverse();
      } catch {
        output.push(warning("\n  No snapshots found."));
        console.log(output.join("\n"));
        return;
      }

      for (const file of files) {
        try {
          const snap: Snapshot = JSON.parse(
            await readFile(join(snapshotsDir, file), "utf-8"),
          );
          output.push(
            `  ${chalk.white(snap.savedAt)} ${chalk.dim(`— ${snap.memories.length} memories, ${snap.sessionCount} sessions`)}`,
          );
        } catch {
          output.push(`  ${chalk.dim(file)} ${chalk.red("(corrupt)")}`);
        }
      }

      console.log(output.join("\n"));
    });
}
