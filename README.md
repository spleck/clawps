# clawps 🐾

A procps-style package of utilities for [OpenClaw](https://openclaw.ai) sessions.

```
$ clawps

STATUS  AGENT                                MODEL             CONTEXT     IDLE      CHANNEL     KIND
-------------------------------------------------------------------------------------------------------------
active  Kevin Smith (@spleck)                kimi-k2.5         15K/250K    2m        telegram    other
stale   Daily SPA Generator                  kimi-k2.5         250K/250K   4h        cron        other
-----------------------------------------------------------------------------------------------------------
2 sessions
```

```
$ clawtop

  PID   SESSIONS                          MODEL        CPU    MSGS    CTX/MAX    UPTIME
-------------------------------------------------------------------------------------------------
 1699   Kevin Smith (main)                minimax-m2.5  0.1    142     45K/250K   12m
 1705   pm-daily-spas (isolated)          kimi-k2.5     0.0    28      12K/250K   4h
-------------------------------------------------------------------------------------------------
Total: 2 sessions | Context: 57K/500K (11%)
```

## Installation

```bash
# Clone or download
git clone https://github.com/spleck/clawps.git
cd clawps

# Make executable and link to your PATH
chmod +x clawps.js
ln -s $(pwd)/clawps.js ~/.local/bin/clawps

chmod +x clawtop.js
ln -s $(pwd)/clawtop.js ~/.local/bin/clawtop

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

## Utilities

### clawps

Process-style session listing.

```bash
clawps              # Basic session listing
clawps -v           # Verbose/detailed output
clawps --json       # JSON output for scripting
clawps -w           # Watch mode (auto-refresh)
clawps -w -n5       # Watch mode, refresh every 5 seconds
clawps --no-color   # Disable colors
```

### clawtop

Top-style real-time session monitor.

```bash
clawtop             # Real-time monitoring (default 3s refresh)
clawtop -n5         # Refresh every 5 seconds
clawtop --json      # JSON output for scripting
clawtop --no-color  # Disable colors
```

## Output

### clawps

| Column | Description |
|--------|-------------|
| STATUS | active 🟢 / idle 🟡 / stale 🔴 |
| AGENT | Session/agent display name |
| MODEL | AI model in use (shortened) |
| CONTEXT | Current / max tokens (e.g., `15K/250K`) |
| IDLE | Time since last activity |
| CHANNEL | Communication channel |
| KIND | Session type |

### clawtop

| Column | Description |
|--------|-------------|
| PID | Process/Session ID |
| SESSIONS | Session name and type |
| MODEL | AI model in use |
| CPU | Estimated CPU usage |
| MSGS | Message count this session |
| CTX/MAX | Context usage |
| UPTIME | Session runtime |

## How It Works

Both tools query your local OpenClaw gateway via the `sessions_list` tool:
- `clawps` — formats sessions like Unix `ps`
- `clawtop` — monitors like Unix `top`

## License

MIT
