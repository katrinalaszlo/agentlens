import { readdir, readFile, stat, writeFile } from "fs/promises";
import { join, basename } from "path";
import chalk from "chalk";
import { Command } from "commander";
import { getClaudeProjectsDir } from "../utils/paths.js";
import {
  header,
  subheader,
  success,
  warning,
  danger,
  info,
} from "../utils/display.js";

type SensitiveMatch = {
  file: string;
  project: string;
  name: string;
  line: number;
  label: string;
  matched: string;
};

const PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /(?:api[_-]?key\s*[:=]\s*)([^\s"',;]{8,})/gi, label: "API key" },
  { pattern: /(?:password\s*[:=]\s*)([^\s"',;]{4,})/gi, label: "Password" },
  { pattern: /(?:secret\s*[:=]\s*)([^\s"',;]{8,})/gi, label: "Secret" },
  { pattern: /(?:token\s*[:=]\s*)([^\s"',;]{8,})/gi, label: "Token" },
  { pattern: /(?:credential\s*[:=]\s*)([^\s"',;]{8,})/gi, label: "Credential" },
  {
    pattern: /\b([A-Za-z0-9+/]{40,}={0,2})\b/g,
    label: "Possible encoded secret",
  },
];

function mask(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return value.slice(0, 4) + "*".repeat(value.length - 8) + value.slice(-4);
}

async function findSensitiveContent(): Promise<SensitiveMatch[]> {
  const projectsDir = getClaudeProjectsDir();
  const matches: SensitiveMatch[] = [];

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
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          for (const { pattern, label } of PATTERNS) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(lines[i])) !== null) {
              matches.push({
                file: filePath,
                project: projDir.replace(/-/g, "/"),
                name: basename(file, ".md"),
                line: i + 1,
                label,
                matched: match[1] || match[0],
              });
            }
          }
        }
      } catch {
        continue;
      }
    }
  }
  return matches;
}

async function redactFile(
  filePath: string,
  matches: SensitiveMatch[],
): Promise<void> {
  let content = await readFile(filePath, "utf-8");
  for (const m of matches) {
    content = content.replace(m.matched, "[REDACTED]");
  }
  await writeFile(filePath, content, "utf-8");
}

export function registerRedactCommand(program: Command): void {
  program
    .command("redact")
    .description("Find and redact sensitive content in memory files")
    .option("--fix", "Actually redact sensitive values (default is dry run)")
    .action(async (opts) => {
      const output: string[] = [];
      output.push(header("REDACT — Sensitive Content Scanner"));

      const matches = await findSensitiveContent();

      if (matches.length === 0) {
        output.push("\n  No sensitive content found in memory files.");
        console.log(output.join("\n"));
        return;
      }

      output.push(subheader(`Found ${matches.length} potential secrets`));

      // Group by file
      const byFile: Record<string, SensitiveMatch[]> = {};
      for (const m of matches) {
        if (!byFile[m.file]) byFile[m.file] = [];
        byFile[m.file].push(m);
      }

      for (const [file, fileMatches] of Object.entries(byFile)) {
        const first = fileMatches[0];
        output.push(
          `\n  ${chalk.bold(first.name)} ${chalk.dim(`(${first.project})`)}`,
        );
        for (const m of fileMatches) {
          output.push(
            `    ${danger(`${m.label}`)} line ${m.line}: ${chalk.dim(mask(m.matched))}`,
          );
        }
      }

      if (!opts.fix) {
        output.push(info("\nDry run — use --fix to redact these values."));
        console.log(output.join("\n"));
        return;
      }

      // Redact
      let redactedFiles = 0;
      for (const [file, fileMatches] of Object.entries(byFile)) {
        try {
          await redactFile(file, fileMatches);
          redactedFiles++;
        } catch {
          output.push(warning(`Failed to redact: ${file}`));
        }
      }

      output.push(
        success(
          `\nRedacted ${matches.length} secrets across ${redactedFiles} files.`,
        ),
      );
      console.log(output.join("\n"));
    });
}
