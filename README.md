# agentlens

See what your AI coding agents store on your machine.

`agentlens` scans `~/.claude/` for data stored by Claude Code and shows you what's there: memory files, token costs, feature flags, session transcripts, and your total data footprint.

## Quick Start

```bash
npx agentlens scan
```

No API keys, no accounts, no config. Reads files already on your disk.

## What It Finds

### Memory
What Claude remembers about you across projects: user profiles, feedback, project context. Scans for sensitive data (API keys, secrets) accidentally stored in memory files.

### Costs
Token usage and spending broken down by model and project. Shows which models consumed tokens and your cache hit rate.

### Features
Active feature flags cached on your machine via GrowthBook. Shows what's toggled on your account: the flag names and values Anthropic has set.

### Sessions
Analyzes your conversation transcripts: message counts, tool usage frequency, which models were used, and total transcript size.

### Privacy
Full data footprint audit: how many files Claude Code stores, how much space they take, and what categories they fall into (transcripts, memory, config).

## Commands

### Scan

```bash
agentlens scan        # Full scan (default)
agentlens memory      # What Claude remembers about you
agentlens costs       # Token usage and spending
agentlens features    # Active feature flags and config
agentlens sessions    # Session history and tool usage
agentlens privacy     # Data footprint audit
```

### Actions

```bash
agentlens clean              # Delete memory files (--dry-run, --project, --older-than)
agentlens redact             # Find secrets in memory files (--fix to redact them)
agentlens diff save          # Save a snapshot of current state
agentlens diff show          # Compare the two most recent snapshots
agentlens export             # Export all data to portable JSON (--memory, --sessions, --costs)
```

## Why This Exists

AI coding agents store a lot of data on your machine: conversation transcripts, persistent memory files, feature flags, cost data. Most of it is invisible unless you go digging through `~/.claude/` yourself.

agentlens makes it easy to see what's there.

## License

MIT
