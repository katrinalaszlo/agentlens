import { readFile, readdir } from "fs/promises";
import { join } from "path";
import chalk from "chalk";
import {
  getClaudeHome,
  getClaudeSettingsPath,
  getClaudeGlobalConfigPath,
  getClaudeProjectsDir,
} from "../utils/paths.js";
import {
  header,
  subheader,
  item,
  success,
  badge,
  table,
  divider,
} from "../utils/display.js";

// Known feature flag names found in Claude Code's GrowthBook cache.
// Labels are best guesses based on the flag name — actual behavior may differ.
const KNOWN_FLAGS: Record<string, { label: string; description: string }> = {
  tengu_sage_compass: {
    label: "Sage Compass",
    description: "Purpose unclear from flag name alone.",
  },
  tengu_onyx_plover: {
    label: "Onyx Plover",
    description: "Purpose unclear from flag name alone.",
  },
  tengu_anti_distill_fake_tool_injection: {
    label: "Anti-Distillation",
    description: "Appears related to model distillation prevention.",
  },
  tengu_auto_mode_config: {
    label: "Auto-Mode Config",
    description: "Configuration for autonomous operation mode.",
  },
  tengu_amber_quartz_disabled: {
    label: "Amber Quartz",
    description: "Purpose unclear from flag name alone.",
  },
  tengu_thinkback: {
    label: "Year in Review",
    description: "Claude Code Year in Review feature.",
  },
  tengu_keybinding_customization_release: {
    label: "Custom Keybindings",
    description: "Keybinding customization feature gate.",
  },
  tengu_remote_backend: {
    label: "Remote Sessions",
    description: "Cloud-hosted agent sessions.",
  },
  tengu_ant_model_override: {
    label: "Anthropic Employee Model Override",
    description: "Internal model routing for Anthropic employees.",
  },
  tengu_miraculo_the_bard: {
    label: "Miraculo",
    description: "Purpose unclear from flag name alone.",
  },
};

type Settings = Record<string, unknown>;

async function readJsonSafe(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

export async function scanFeatures(): Promise<string> {
  const output: string[] = [];
  output.push(header("FEATURES — Active Flags & Configuration"));

  // Read settings
  const settings = await readJsonSafe(getClaudeSettingsPath());
  const globalConfig = await readJsonSafe(getClaudeGlobalConfigPath());

  // User settings
  output.push(subheader("User Settings"));
  if (settings) {
    const interestingKeys = [
      "model",
      "advisorModel",
      "customApiKey",
      "permissions",
      "autoUpdaterEnabled",
      "autoDreamEnabled",
      "showThinkingSummaries",
      "bypassPermissions",
      "autoMode",
      "effort",
    ];
    let found = false;
    for (const key of interestingKeys) {
      if (settings[key] !== undefined) {
        const value =
          typeof settings[key] === "object"
            ? JSON.stringify(settings[key])
            : String(settings[key]);
        output.push(item(key, value));
        found = true;
      }
    }
    if (!found) {
      output.push("  Default settings (no custom overrides).");
    }

    // Note advisor setting if configured
    if (settings.advisorModel) {
      output.push(item("Advisor model", String(settings.advisorModel)));
    }
  } else {
    output.push("  Settings file not found.");
  }

  // Global config analysis
  output.push(subheader("Global Config"));
  if (globalConfig) {
    // Check for cached GrowthBook features
    const cachedFeatures = globalConfig.cachedGrowthBookFeatures as
      | Record<string, unknown>
      | undefined;
    if (cachedFeatures && Object.keys(cachedFeatures).length > 0) {
      output.push(subheader("Active Feature Flags (from GrowthBook cache)"));
      for (const [flag, value] of Object.entries(cachedFeatures)) {
        const known = KNOWN_FLAGS[flag];
        if (known) {
          output.push(`  ${badge("FLAG", "blue")} ${chalk.white(known.label)}`);
          output.push(`    ${chalk.dim(known.description)}`);
          output.push(
            `    ${chalk.dim("Flag:")} ${flag} = ${chalk.dim(JSON.stringify(value).slice(0, 80))}`,
          );
        } else {
          output.push(`  ${badge("UNKNOWN", "magenta")} ${chalk.white(flag)}`);
          output.push(`    ${chalk.dim(JSON.stringify(value).slice(0, 100))}`);
        }
      }
    } else {
      output.push("  No cached feature flags found.");
    }

    // Check interesting config values
    const configChecks: [string, string][] = [];

    if (globalConfig.hasAcceptedTerms)
      configChecks.push(["Terms accepted", "Yes"]);
    if (globalConfig.companionMuted !== undefined) {
      configChecks.push([
        "Companion pet",
        globalConfig.companionMuted ? "Muted" : "Active",
      ]);
    }
    if (globalConfig.hasSeenUndercoverAutoNotice) {
      configChecks.push(["Undercover notice seen", "Yes"]);
    }

    for (const [label, value] of configChecks) {
      output.push(success(`${label}: ${value}`));
    }
  } else {
    output.push("  Global config not found.");
  }

  // Scan for CLAUDE.md files
  output.push(divider());
  output.push(subheader("CLAUDE.md Files (Project Instructions)"));
  const claudeHome = getClaudeHome();
  try {
    const globalClaude = await readFile(join(claudeHome, "CLAUDE.md"), "utf-8");
    output.push(
      success(`Global CLAUDE.md found (${globalClaude.length} chars)`),
    );
    const preview = globalClaude
      .split("\n")
      .slice(0, 3)
      .map((l) => `    ${chalk.dim(l.slice(0, 80))}`)
      .join("\n");
    output.push(preview);
  } catch {
    output.push("  No global CLAUDE.md found.");
  }

  // Count project-level CLAUDE.md files
  try {
    const projectsDir = getClaudeProjectsDir();
    const projects = await readdir(projectsDir);
    let claudeMdCount = 0;
    for (const proj of projects) {
      try {
        await readFile(join(projectsDir, proj, "CLAUDE.md"), "utf-8");
        claudeMdCount++;
      } catch {
        continue;
      }
    }
    if (claudeMdCount > 0) {
      output.push(item("Project CLAUDE.md files", String(claudeMdCount)));
    }
  } catch {
    // ignore
  }

  return output.join("\n");
}
