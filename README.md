# clawps 🐾

A `ps`-like command for [OpenClaw](https://openclaw.ai) sessions.

```
$ clawps

STATUS  AGENT                                MODEL             CONTEXT     IDLE      CHANNEL     KIND
-------------------------------------------------------------------------------------------------------------
active  Kevin Smith (@spleck) id:7188231559  kimi-k2.5         15K/250K    2m        telegram    other
stale   Daily SPA Generator                  kimi-k2.5         250K/250K   4h        cron        other
-----------------------------------------------------------------------------------------------------------
2 sessions
```

## Installation

```bash
# Clone or download
git clone https://github.com/spleck/clawps.git
cd clawps

# Make executable and link to your PATH
chmod +x clawps.js
ln -s $(pwd)/clawps.js ~/.local/bin/clawps

# Or install globally via npm
npm link
```

Make sure `~/.local/bin` is in your PATH:
```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Requirements

- Node.js 18+
- OpenClaw gateway running (default: localhost:18789)
- Gateway auth token read from `~/.openclaw/openclaw.json`

## Usage

```bash
clawps              # Basic session listing
clawps -v           # Verbose/detailed output
clawps --json       # JSON output for scripting
clawps -w           # Watch mode (auto-refresh)
clawps -w -n5       # Watch mode, refresh every 5 seconds
clawps --no-color   # Disable colors
```

## Output

| Column | Description |
|--------|-------------|
| STATUS | active 🟢 / idle 🟡 / stale 🔴 |
| AGENT | Session/agent display name |
| MODEL | AI model in use (shortened) |
| CONTEXT | Current / max tokens (e.g., `15K/250K`) |
| IDLE | Time since last activity |
| CHANNEL | Communication channel |
| KIND | Session type |

## How It Works

`clawps` queries your local OpenClaw gateway via the `sessions_list` tool and formats the output like the Unix `ps` command.

## License

MIT
