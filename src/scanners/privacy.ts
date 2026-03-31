import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import chalk from "chalk";
import { getClaudeHome, getClaudeProjectsDir } from "../utils/paths.js";
import {
  header,
  subheader,
  warning,
  danger,
  table,
  divider,
  info,
} from "../utils/display.js";

type DataFootprint = {
  totalFiles: number;
  totalSizeBytes: number;
  sessionTranscripts: number;
  memoryFiles: number;
  configFiles: number;
  otherFiles: number;
};

async function walkDir(
  dir: string,
): Promise<{ path: string; size: number; isDir: boolean }[]> {
  const results: { path: string; size: number; isDir: boolean }[] = [];
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const s = await stat(fullPath);
        if (s.isDirectory()) {
          results.push({ path: fullPath, size: 0, isDir: true });
          results.push(...(await walkDir(fullPath)));
        } else {
          results.push({ path: fullPath, size: s.size, isDir: false });
        }
      } catch {
        continue;
      }
    }
  } catch {
    // dir doesn't exist
  }
  return results;
}

export async function scanPrivacy(): Promise<string> {
  const output: string[] = [];
  output.push(header("PRIVACY — Data Footprint & Exposure Analysis"));

  const claudeHome = getClaudeHome();
  const allFiles = await walkDir(claudeHome);
  const files = allFiles.filter((f) => !f.isDir);

  // Data footprint
  const footprint: DataFootprint = {
    totalFiles: files.length,
    totalSizeBytes: files.reduce((a, f) => a + f.size, 0),
    sessionTranscripts: files.filter((f) => f.path.endsWith(".jsonl")).length,
    memoryFiles: files.filter(
      (f) => f.path.includes("/memory/") && f.path.endsWith(".md"),
    ).length,
    configFiles: files.filter((f) => f.path.endsWith(".json")).length,
    otherFiles: 0,
  };
  footprint.otherFiles =
    footprint.totalFiles -
    footprint.sessionTranscripts -
    footprint.memoryFiles -
    footprint.configFiles;

  output.push(subheader("Data Stored on Disk"));
  output.push(
    table([
      ["Total files", String(footprint.totalFiles)],
      ["Total size", formatBytes(footprint.totalSizeBytes)],
      [
        "Session transcripts",
        `${footprint.sessionTranscripts} files (${formatBytes(files.filter((f) => f.path.endsWith(".jsonl")).reduce((a, f) => a + f.size, 0))})`,
      ],
      ["Memory files", `${footprint.memoryFiles} files`],
      ["Config files", `${footprint.configFiles} files`],
    ]),
  );

  if (footprint.totalSizeBytes > 100 * 1024 * 1024) {
    output.push(
      danger(`Large data footprint: ${formatBytes(footprint.totalSizeBytes)}`),
    );
  }

  // Session transcript analysis
  output.push(subheader("Session Transcript Contents"));
  output.push(
    info("Session transcripts contain your complete conversation history"),
  );
  output.push(
    info(
      "including every file you read, every command you ran, and every edit.",
    ),
  );

  // Check what's in transcripts
  const jsonlFiles = files
    .filter((f) => f.path.endsWith(".jsonl"))
    .sort((a, b) => b.size - a.size);
  if (jsonlFiles.length > 0) {
    output.push(`  Largest transcript: ${formatBytes(jsonlFiles[0].size)}`);
    output.push(
      `  Smallest transcript: ${formatBytes(jsonlFiles[jsonlFiles.length - 1].size)}`,
    );

    // Sample the largest transcript for sensitive content
    try {
      const sample = await readFile(jsonlFiles[0].path, "utf-8");
      const sampleLines = sample.split("\n").slice(0, 50);
      let hasFileContents = false;
      let hasBashCommands = false;
      let hasEnvVars = false;

      for (const line of sampleLines) {
        if (line.includes('"tool_use"') && line.includes('"Read"'))
          hasFileContents = true;
        if (line.includes('"Bash"') || line.includes('"command"'))
          hasBashCommands = true;
        if (
          line.includes("API_KEY") ||
          line.includes("SECRET") ||
          line.includes(".env")
        )
          hasEnvVars = true;
      }

      if (hasFileContents)
        warning("Transcripts contain full file contents you've read");
      if (hasBashCommands)
        warning("Transcripts contain bash commands you've executed");
      if (hasEnvVars)
        danger(
          "Possible environment variables or secrets detected in transcripts",
        );
    } catch {
      // ignore
    }
  }

  // Analytics / telemetry
  output.push(divider());
  output.push(subheader("Telemetry"));
  output.push(info("Claude Code sends usage telemetry to Anthropic."));
  output.push(
    info("See Anthropic's privacy policy for details on what is collected."),
  );

  // Feature flags
  output.push(divider());
  output.push(subheader("Feature Flags"));
  output.push(
    info("Claude Code uses GrowthBook for remote feature flag management."),
  );
  output.push(info("Cached flags are shown in the Features scan."));

  return output.join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
