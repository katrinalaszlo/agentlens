import chalk from "chalk";

export function header(text: string): string {
  const line = "─".repeat(60);
  return `\n${chalk.cyan(line)}\n${chalk.bold.cyan(`  ${text}`)}\n${chalk.cyan(line)}`;
}

export function subheader(text: string): string {
  return `\n${chalk.bold.white(`  ${text}`)}`;
}

export function item(label: string, value: string | number): string {
  return `  ${chalk.gray("│")} ${chalk.dim(label + ":")} ${value}`;
}

export function warning(text: string): string {
  return `  ${chalk.yellow("⚠")} ${chalk.yellow(text)}`;
}

export function info(text: string): string {
  return `  ${chalk.blue("ℹ")} ${text}`;
}

export function success(text: string): string {
  return `  ${chalk.green("✓")} ${text}`;
}

export function danger(text: string): string {
  return `  ${chalk.red("✗")} ${chalk.red(text)}`;
}

export function cost(amount: number): string {
  if (amount > 1) return chalk.red(`$${amount.toFixed(2)}`);
  if (amount > 0.1) return chalk.yellow(`$${amount.toFixed(4)}`);
  return chalk.green(`$${amount.toFixed(4)}`);
}

export function badge(
  text: string,
  color: "green" | "yellow" | "red" | "blue" | "magenta" = "blue",
): string {
  const fn = chalk[color];
  return fn(`[${text}]`);
}

export function indent(text: string, level: number = 2): string {
  return " ".repeat(level) + text;
}

export function divider(): string {
  return chalk.dim("  " + "·".repeat(56));
}

export function table(rows: [string, string][]): string {
  const maxLabel = Math.max(...rows.map(([l]) => l.length));
  return rows
    .map(
      ([label, value]) =>
        `  ${chalk.gray("│")} ${chalk.dim(label.padEnd(maxLabel))}  ${value}`,
    )
    .join("\n");
}

export const logo = chalk.cyan(`
   ╔═══════════════════════════════════╗
   ║         ${chalk.bold("agentlens")} v0.1.0          ║
   ║  ${chalk.dim("See what your AI agents do.")}     ║
   ╚═══════════════════════════════════╝
`);
