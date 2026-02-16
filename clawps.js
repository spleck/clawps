#!/usr/bin/env node
/**
 * clawps - List OpenClaw sessions like the `ps` command
 * Usage: clawps [options]
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

// Parse CLI arguments
const args = process.argv.slice(2);
const options = {
  color: !args.includes('--no-color') && process.stdout.isTTY,
  verbose: args.includes('-v') || args.includes('--verbose'),
  help: args.includes('-h') || args.includes('--help'),
  json: args.includes('--json'),
  watch: args.includes('-w') || args.includes('--watch'),
  interval: 2000, // ms for watch mode
};

// Watch interval override
const intervalArg = args.find(a => a.startsWith('-n'));
if (intervalArg) {
  const val = parseInt(intervalArg.replace('-n', ''), 10);
  if (!isNaN(val)) options.interval = val * 1000;
}

function printHelp() {
  console.log(`
Usage: clawps [options]

Options:
  -h, --help       Show this help message
  -v, --verbose    Show detailed session information
  --no-color       Disable colored output
  --json           Output as JSON
  -w, --watch      Refresh continuously (like watch command)
  -n<secs>         Watch interval in seconds (default: 2)

Examples:
  clawps              # Basic session listing
  clawps -v           # Verbose output
  clawps --no-color   # Plain text output
  clawps -w -n5       # Refresh every 5 seconds
`);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

function color(code, text) {
  return options.color ? `${COLORS[code]}${text}${COLORS.reset}` : text;
}

function getGatewayConfig() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    return {
      port: config.gateway?.port || 18789,
      token: config.gateway?.auth?.token,
    };
  } catch (err) {
    return { port: 18789, token: null };
  }
}

// Read sessions directly from sessions.json (like CLI does)
function getSessionsFromFile() {
  const sessionsPath = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions', 'sessions.json');
  try {
    const data = fs.readFileSync(sessionsPath, 'utf8');
    const sessionsObj = JSON.parse(data);
    
    const sessions = Object.entries(sessionsObj).map(([key, session]) => ({
      key: key,
      channel: session.channel || 'unknown',
      displayName: session.displayName || key,
      updatedAt: session.updatedAt || session.lastMessageAt || 0,
      sessionId: session.sessionId || key,
      model: session.model || 'unknown',
      contextTokens: session.contextWindow || session.contextTokens || 0,
      totalTokens: session.totalTokens || 0,
      kind: session.kind || 'other',
      deliveryContext: session.deliveryContext || {},
      systemSent: session.systemSent || false,
      abortedLastRun: session.abortedLastRun || false,
      lastChannel: session.lastChannel || session.channel || '',
      lastTo: session.lastTo || '',
      lastAccountId: session.lastAccountId || '',
      transcriptPath: session.transcriptPath || ''
    }));
    
    // Sort by updatedAt descending
    sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return sessions;
  } catch (err) {
    return [];
  }
}

function invokeTool(tool, args = {}) {
  return new Promise((resolve, reject) => {
    const { port, token } = getGatewayConfig();
    const postData = JSON.stringify({ tool, args });
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request({
      hostname: 'localhost',
      port,
      path: '/tools/invoke',
      method: 'POST',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok && parsed.result) {
            // Extract sessions from the tool result
            const result = parsed.result;
            if (result.content && result.content[0]?.text) {
              // Parse the JSON text content
              const innerResult = JSON.parse(result.content[0].text);
              resolve(innerResult.sessions || []);
            } else if (result.details?.sessions) {
              resolve(result.details.sessions);
            } else {
              resolve([]);
            }
          } else {
            reject(new Error(parsed.error?.message || 'Unknown error'));
          }
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(postData);
    req.end();
  });
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d${hours % 24}h`;
  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}

function formatBytes(bytes) {
  if (!bytes) return '0B';
  const units = ['B', 'K', 'M', 'G'];
  let idx = 0;
  while (bytes >= 1024 && idx < units.length - 1) {
    bytes /= 1024;
    idx++;
  }
  return `${Math.round(bytes)}${units[idx]}`;
}

function getAgentName(session) {
  // Extract agent name from session key or display name
  if (session.displayName) {
    // Remove common prefixes/suffixes for cleaner display
    return session.displayName
      .replace(/^Cron: /, '')
      .replace(/^agent:main:/, '');
  }
  const parts = session.key?.split(':') || [];
  return parts[parts.length - 1] || 'unknown';
}

function getModelShort(model) {
  if (!model) return '-';
  return model
    .replace('moonshot/', '')
    .replace('openrouter/', 'or/')
    .substring(0, 20);
}

function getStatusIndicator(session) {
  const now = Date.now();
  const idle = now - (session.updatedAt || 0);
  
  // Consider session active if updated in last 5 minutes
  if (idle < 5 * 60 * 1000) {
    return color('green', '●');
  }
  // Idle if updated in last 30 minutes
  if (idle < 30 * 60 * 1000) {
    return color('yellow', '○');
  }
  return color('red', '○');
}

function truncate(str, len) {
  if (!str) return '-'.padEnd(len);
  if (str.length <= len) return str.padEnd(len);
  return str.substring(0, len - 1) + '…';
}

async function listSessions() {
  try {
    const sessions = getSessionsFromFile();

    if (options.json) {
      console.log(JSON.stringify(sessions, null, 2));
      return;
    }

    if (sessions.length === 0) {
      console.log(color('dim', 'No active sessions.'));
      return;
    }

    const now = Date.now();

    if (options.verbose) {
      // Verbose table format
      console.log();
      console.log(color('bright', 'OpenClaw Sessions'));
      console.log(color('dim', '═'.repeat(100)));
      
      sessions.forEach((s, i) => {
        const idle = now - (s.updatedAt || 0);
        const status = getStatusIndicator(s);
        const agentName = getAgentName(s);
        
        console.log(`${status} ${color('bright', agentName)}`);
        console.log(`   Key:      ${color('gray', s.key || '-')}`);
        console.log(`   Session:  ${color('cyan', s.sessionId?.substring(0, 8) || '-')}`);
        console.log(`   Kind:     ${s.kind || '-'}`);
        console.log(`   Channel:  ${s.channel || '-'}`);
        console.log(`   Model:    ${getModelShort(s.model)}`);
        const currentTokens = s.totalTokens || 0;
        const maxTokens = s.contextWindow || s.contextTokens || 0;
        console.log(`   Context:  ${formatBytes(currentTokens)} / ${formatBytes(maxTokens)}`);
        console.log(`   Idle:     ${formatDuration(idle)}`);
        console.log(`   Updated:  ${new Date(s.updatedAt).toLocaleTimeString()}`);
        
        if (s.label) {
          console.log(`   Label:    ${color('magenta', s.label)}`);
        }
        if (s.abortedLastRun) {
          console.log(`   ${color('red', '⚠ Last run aborted')}`);
        }
        
        if (i < sessions.length - 1) console.log();
      });
      
      console.log(color('dim', '═'.repeat(100)));
      console.log(`${color('green', '●')} Active  ${color('yellow', '○')} Idle  ${color('red', '○')} Stale`);
      console.log();
    } else {
      // Compact ps-like format
      // Columns: STATUS AGENT MODEL CONTEXT IDLE CHANNEL KIND
      const headers = ['STATUS', 'AGENT', 'MODEL', 'CONTEXT', 'IDLE', 'CHANNEL', 'KIND'];
      const widths = [8, 35, 18, 12, 10, 12, 12];
      
      // Header
      console.log();
      const headerLine = [
        color('bright', truncate(headers[0], widths[0])),
        color('bright', truncate(headers[1], widths[1])),
        '  ',
        color('bright', truncate(headers[2], widths[2])),
        color('bright', truncate(headers[3], widths[3])),
        color('bright', truncate(headers[4], widths[4])),
        color('bright', truncate(headers[5], widths[5])),
        color('bright', truncate(headers[6], widths[6])),
      ].join('');
      console.log(headerLine);
      console.log(color('dim', '-'.repeat(widths.reduce((a, b) => a + b, 0) + 2)));
      
      // Rows
      sessions.forEach(s => {
        const idle = now - (s.updatedAt || 0);
        const idleStr = formatDuration(idle);
        const agentName = getAgentName(s);
        const model = getModelShort(s.model);
        const currentTokens = s.totalTokens || 0;
        const maxTokens = s.contextWindow || s.contextTokens || 0;
        const context = `${formatBytes(currentTokens)}/${formatBytes(maxTokens)}`;
        const channel = s.channel || '-';
        const kind = s.kind || '-';
        
        let statusStr;
        if (idle < 5 * 60 * 1000) {
          statusStr = color('green', 'active'.padEnd(8));
        } else if (idle < 30 * 60 * 1000) {
          statusStr = color('yellow', 'idle'.padEnd(8));
        } else {
          statusStr = color('red', 'stale'.padEnd(8));
        }
        
        const row = [
          statusStr,
          truncate(agentName, widths[1]),
          '  ',
          truncate(model, widths[2]),
          context.padEnd(widths[3]),
          idleStr.padEnd(widths[4]),
          truncate(channel, widths[5]),
          truncate(kind, widths[6]),
        ].join('');
        
        console.log(row);
      });
      
      console.log(color('dim', '-'.repeat(widths.reduce((a, b) => a + b, 0))));
      console.log(`${sessions.length} session${sessions.length !== 1 ? 's' : ''}`);
      console.log();
    }
  } catch (err) {
    console.error(color('red', `Error: ${err.message}`));
    if (err.message.includes('ECONNREFUSED')) {
      console.error(color('dim', 'Is the OpenClaw gateway running?'));
    }
    process.exit(1);
  }
}

async function main() {
  if (options.watch) {
    console.clear();
    console.log(color('dim', `Watching every ${options.interval/1000}s (Ctrl+C to exit)...`));
    console.log();
    
    const run = async () => {
      console.clear();
      console.log(color('dim', `Watching every ${options.interval/1000}s (Ctrl+C to exit)...`));
      await listSessions();
    };
    
    await run();
    setInterval(run, options.interval);
  } else {
    await listSessions();
  }
}

main();
