import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import chalk from "chalk";
import { getClaudeProjectsDir } from "../utils/paths.js";
import {
  header,
  subheader,
  item,
  warning,
  table,
  divider,
  badge,
  info,
} from "../utils/display.js";

type SessionInfo = {
  project: string;
  file: string;
  size: number;
  modified: Date;
  messageCount: number;
  toolCalls: Record<string, number>;
  models: Set<string>;
  hasAdvisorBlocks: boolean;
  hasDreamActivity: boolean;
  hasMemoryExtraction: boolean;
};

async function findSessions(): Promise<SessionInfo[]> {
  const projectsDir = getClaudeProjectsDir();
  const sessions: SessionInfo[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return [];
  }

  for (const projDir of projectDirs) {
    const sessionsDir = join(projectsDir, projDir, "sessions");
    let files: string[];
    try {
      files = await readdir(sessionsDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(sessionsDir, file);
      try {
        const stats = await stat(filePath);
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim());

        const toolCalls: Record<string, number> = {};
        const models = new Set<string>();
        let hasAdvisorBlocks = false;
        let hasDreamActivity = false;
        let hasMemoryExtraction = false;

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);

            // Check for tool usage
            if (parsed.type === "assistant" && parsed.message?.content) {
              for (const block of parsed.message.content) {
                if (block.type === "tool_use") {
                  toolCalls[block.name] = (toolCalls[block.name] || 0) + 1;
                }
                if (
                  block.type === "server_tool_use" &&
                  block.name === "advisor"
                ) {
                  hasAdvisorBlocks = true;
                }
                if (block.type === "advisor_tool_result") {
                  hasAdvisorBlocks = true;
                }
              }
            }

            // Check for model info
            if (parsed.message?.model) {
              models.add(parsed.message.model);
            }

            // Check for dream/memory activity
            if (parsed.type === "system" && typeof parsed.text === "string") {
              if (
                parsed.text.includes("dream") ||
                parsed.text.includes("consolidat")
              ) {
                hasDreamActivity = true;
              }
              if (
                parsed.text.includes("memory") &&
                parsed.text.includes("extract")
              ) {
                hasMemoryExtraction = true;
              }
            }
          } catch {
            continue;
          }
        }

        sessions.push({
          project: projDir.replace(/-/g, "/"),
          file,
          size: stats.size,
          modified: stats.mtime,
          messageCount: lines.length,
          toolCalls,
          models,
          hasAdvisorBlocks,
          hasDreamActivity,
          hasMemoryExtraction,
        });
      } catch {
        continue;
      }
    }
  }
  return sessions;
}

export async function scanSessions(): Promise<string> {
  const output: string[] = [];
  output.push(header("SESSIONS — Conversation History & Background Activity"));

  const sessions = await findSessions();

  if (sessions.length === 0) {
    output.push("  No session transcripts found.");
    return output.join("\n");
  }

  // Summary
  const totalSize = sessions.reduce((a, s) => a + s.size, 0);
  const totalMessages = sessions.reduce((a, s) => a + s.messageCount, 0);
  const advisorSessions = sessions.filter((s) => s.hasAdvisorBlocks).length;
  const dreamSessions = sessions.filter((s) => s.hasDreamActivity).length;
  const memExtractSessions = sessions.filter(
    (s) => s.hasMemoryExtraction,
  ).length;

  output.push(subheader("Summary"));
  output.push(
    table([
      ["Total sessions", String(sessions.length)],
      ["Total messages", formatNumber(totalMessages)],
      ["Total transcript size", formatBytes(totalSize)],
      [
        "Date range",
        `${sessions.sort((a, b) => a.modified.getTime() - b.modified.getTime())[0]?.modified.toLocaleDateString() || "N/A"} → ${sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime())[0]?.modified.toLocaleDateString() || "N/A"}`,
      ],
    ]),
  );

  // Notable patterns in transcripts
  output.push(subheader("Notable Patterns"));
  if (advisorSessions > 0) {
    output.push(
      info(`Advisor-related messages found in ${advisorSessions} sessions`),
    );
  }
  if (dreamSessions > 0) {
    output.push(
      info(`Dream/consolidation references found in ${dreamSessions} sessions`),
    );
  }
  if (memExtractSessions > 0) {
    output.push(
      info(
        `Memory extraction references found in ${memExtractSessions} sessions`,
      ),
    );
  }
  if (
    advisorSessions === 0 &&
    dreamSessions === 0 &&
    memExtractSessions === 0
  ) {
    output.push("  No notable patterns detected in transcripts.");
  }

  // Tool usage aggregate
  output.push(subheader("Tool Usage (Across All Sessions)"));
  const allToolCalls: Record<string, number> = {};
  for (const session of sessions) {
    for (const [tool, count] of Object.entries(session.toolCalls)) {
      allToolCalls[tool] = (allToolCalls[tool] || 0) + count;
    }
  }
  const sortedTools = Object.entries(allToolCalls).sort((a, b) => b[1] - a[1]);
  for (const [tool, count] of sortedTools.slice(0, 15)) {
    const bar = "█".repeat(
      Math.min(
        30,
        Math.ceil((count / Math.max(...Object.values(allToolCalls))) * 30),
      ),
    );
    output.push(`  ${chalk.dim(tool.padEnd(25))} ${chalk.cyan(bar)} ${count}`);
  }
  if (sortedTools.length > 15) {
    output.push(chalk.dim(`  ... and ${sortedTools.length - 15} more tools`));
  }

  // Models seen
  const allModels = new Set<string>();
  for (const session of sessions) {
    for (const model of session.models) {
      allModels.add(model);
    }
  }
  if (allModels.size > 0) {
    output.push(subheader("Models Used"));
    for (const model of allModels) {
      output.push(`  ${badge(model, "blue")}`);
    }
  }

  // Recent sessions
  output.push(divider());
  output.push(subheader("Recent Sessions"));
  const recent = sessions
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .slice(0, 10);
  for (const s of recent) {
    const flags: string[] = [];
    if (s.hasAdvisorBlocks) flags.push(chalk.red("advisor"));
    if (s.hasDreamActivity) flags.push(chalk.magenta("dream"));
    if (s.hasMemoryExtraction) flags.push(chalk.yellow("mem-extract"));
    const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
    output.push(
      `  ${chalk.dim(s.modified.toLocaleDateString())} ${chalk.white(truncatePath(s.project))} ${chalk.dim(`(${s.messageCount} msgs, ${formatBytes(s.size)})`)}${flagStr}`,
    );
  }

  return output.join("\n");
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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
