import { homedir } from "os";
import { join } from "path";

export function getClaudeHome(): string {
  return join(homedir(), ".claude");
}

export function getClaudeProjectsDir(): string {
  return join(getClaudeHome(), "projects");
}

export function getClaudeSettingsPath(): string {
  return join(getClaudeHome(), "settings.json");
}

export function getClaudeGlobalConfigPath(): string {
  return join(getClaudeHome(), "config.json");
}

export function getClaudeSessionsDir(): string {
  return join(getClaudeHome(), "sessions");
}

// Claude stores project configs in a path-encoded directory structure
// e.g., ~/.claude/projects/-Users-jane-Desktop-myproject/
export function decodeProjectPath(encodedDir: string): string {
  return encodedDir.replace(/-/g, "/");
}
