#!/usr/bin/env node

import { Command } from "commander";
import { logo } from "./utils/display.js";
import { scanMemory } from "./scanners/memory.js";
import { scanCosts } from "./scanners/costs.js";
import { scanFeatures } from "./scanners/features.js";
import { scanSessions } from "./scanners/sessions.js";
import { scanPrivacy } from "./scanners/privacy.js";
import { registerCleanCommand } from "./commands/clean.js";
import { registerRedactCommand } from "./commands/redact.js";
import { registerDiffCommand } from "./commands/diff.js";
import { registerExportCommand } from "./commands/export.js";

const program = new Command();

program
  .name("agentlens")
  .description("See what your AI coding agents are really doing.")
  .version("0.1.0");

program
  .command("scan")
  .description("Full scan — memory, costs, features, sessions, and privacy")
  .option("--json", "Output as JSON (coming soon)")
  .action(async () => {
    console.log(logo);

    const results = await Promise.all([
      scanMemory(),
      scanCosts(),
      scanFeatures(),
      scanSessions(),
      scanPrivacy(),
    ]);

    for (const result of results) {
      console.log(result);
      console.log();
    }
  });

program
  .command("memory")
  .description("Scan what Claude remembers about you across projects")
  .action(async () => {
    console.log(logo);
    console.log(await scanMemory());
  });

program
  .command("costs")
  .description("Break down token usage and spending by model and project")
  .action(async () => {
    console.log(logo);
    console.log(await scanCosts());
  });

program
  .command("features")
  .description("Show active feature flags, settings, and configuration")
  .action(async () => {
    console.log(logo);
    console.log(await scanFeatures());
  });

program
  .command("sessions")
  .description(
    "Analyze session transcripts and detect background agent activity",
  )
  .action(async () => {
    console.log(logo);
    console.log(await scanSessions());
  });

program
  .command("privacy")
  .description("Audit your data footprint and exposure surface")
  .action(async () => {
    console.log(logo);
    console.log(await scanPrivacy());
  });

// Action commands
registerCleanCommand(program);
registerRedactCommand(program);
registerDiffCommand(program);
registerExportCommand(program);

// Default to scan if no command given
if (process.argv.length <= 2) {
  process.argv.push("scan");
}

program.parse();
