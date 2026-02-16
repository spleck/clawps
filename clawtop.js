#!/usr/bin/env node

/**
 * clawtop - A top-like utility for monitoring OpenClaw instances
 * Lightweight, cross-platform session monitor
 * 
 * Usage: node clawtop.js [options]
 *   -n, --iterations  Number of iterations (default: infinite)
 *   -d, --delay       Delay in seconds between updates (default: 2)
 *   -s, --sort       Sort by: cpu, mem, idle, tokens (default: cpu)
 *   -h, --help       Show this help
 * 
 * Keyboard shortcuts (when running):
 *   q        Quit
 *   r        Reverse sort order
 *   s        Change sort field
 *   Space    Pause/Resume updates
 *   h        Show help
 */

import http from 'http';
import https from 'https';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default config
const CONFIG = {
  delay: 2,
  iterations: Infinity,
  sortBy: 'cpu',
  reverse: false,
  maxSessions: 20,
  showSystem: true,
  color: true
};

// State
let paused = false;
let showingHelp = false;
let inputBuffer = '';
let awaitingInput = null; // 'delay' or 'iterations'

// Colors (disable on Windows or no-color)
const isWindows = process.platform === 'win32';
const noColor = process.env.NO_COLOR || isWindows;

const C = noColor ? {
  reset: '', bright: '', dim: '', green: '', yellow: '', red: '', cyan: '', magenta: '', white: '', gray: ''
} : {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

function getGatewayConfig() {
  const configPaths = [
    process.env.HOME + '/.openclaw/openclaw.json',
    process.env.USERPROFILE + '/.openclaw/openclaw.json',
    '/etc/openclaw/openclaw.json'
  ];
  
  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(raw);
        return {
          port: config.gateway?.port || 18789,
          token: config.gateway?.auth?.token,
          host: config.gateway?.host || 'localhost'
        };
      }
    } catch {}
  }
  return { port: 18789, token: null, host: 'localhost' };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '--';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function getSystemInfo() {
  const info = {
    os: 'Unknown',
    arch: process.arch,
    nodeVersion: process.version,
    platform: process.platform,
    cpuCount: os.cpus().length,
    totalMem: os.totalmem(),
    uptime: os.uptime(),
    cpuUsage: 0,
    freeMem: os.freemem(),
    usedMem: os.totalmem() - os.freemem()
  };
  
  // Try to get OS info
  try {
    if (process.platform === 'darwin') {
      const out = execSync('sw_vers -productVersion 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
      info.os = 'macOS ' + out.trim();
    } else if (process.platform === 'linux') {
      const out = execSync('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d "\""', { encoding: 'utf8', timeout: 2000 });
      info.os = out.trim() || 'Linux';
    } else if (process.platform === 'win32') {
      info.os = 'Windows';
    }
  } catch {
    info.os = process.platform;
  }
  
  return info;
}

// Get current CPU usage by comparing idle times
let lastCpuInfo = null;
function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  
  if (lastCpuInfo) {
    const idleDiff = totalIdle - lastCpuInfo.idle;
    const totalDiff = totalTick - lastCpuInfo.total;
    if (totalDiff > 0) {
      const usage = 100 - (100 * idleDiff / totalDiff);
      lastCpuInfo = { idle: totalIdle, total: totalTick };
      return Math.round(usage);
    }
  }
  
  lastCpuInfo = { idle: totalIdle, total: totalTick };
  return null;
}

function getGatewayUptime() {
  try {
    if (process.platform === 'darwin') {
      // Use ps to find openclaw-gateway process directly
      const out = execSync('ps aux | grep "openclaw-gateway" | grep -v grep | head -1', { encoding: 'utf8', timeout: 2000 });
      const match = out.trim().match(/^\S+\s+(\d+)/);
      if (match) {
        const pid = match[1];
        const startOut = execSync(`ps -o lstart= -p ${pid} 2>/dev/null`, { encoding: 'utf8', timeout: 2000 });
        const startTime = new Date(startOut.trim());
        if (!isNaN(startTime.getTime())) {
          return Math.floor((Date.now() - startTime.getTime()) / 1000);
        }
      }
    } else if (process.platform === 'linux') {
      const out = execSync('pgrep -f openclaw-gateway 2>/dev/null | head -1', { encoding: 'utf8', timeout: 2000 });
      const pid = parseInt(out.trim());
      if (pid) {
        const startOut = execSync(`ps -o lstart= -p ${pid} 2>/dev/null`, { encoding: 'utf8', timeout: 2000 });
        const startTime = new Date(startOut.trim());
        if (!isNaN(startTime.getTime())) {
          return Math.floor((Date.now() - startTime.getTime()) / 1000);
        }
      }
    } else if (process.platform === 'win32') {
      // Windows: use wmic to get creation date
      const out = execSync('wmic process where "name=\'node.exe\' and commandline like \'%openclaw%\'" get ProcessId,CreationDate 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
      const lines = out.trim().split('\n').filter(l => l.trim());
      if (lines.length > 1) {
        // Parse the second line (first is headers)
        const parts = lines[1].trim().split(/\s+/);
        if (parts.length >= 2) {
          const pid = parseInt(parts[parts.length - 2]);
          const createDate = parts[parts.length - 1];
          // CreationDate format: 20260212170000.000000-000
          const dateMatch = createDate.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
          if (dateMatch) {
            const startTime = new Date(
              parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3]),
              parseInt(dateMatch[4]), parseInt(dateMatch[5]), parseInt(dateMatch[6])
            );
            if (!isNaN(startTime.getTime())) {
              return Math.floor((Date.now() - startTime.getTime()) / 1000);
            }
          }
        }
      }
    }
  } catch {}
  return null;
}

async function fetchSessions(config) {
  return new Promise((resolve, reject) => {
    const { port, token, host } = config;
    const postData = JSON.stringify({ tool: 'sessions_list', args: { activeMinutes: 60, messageLimit: 1 } });
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request({
      hostname: host,
      port,
      path: '/tools/invoke',
      method: 'POST',
      headers,
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok && parsed.result) {
            const result = parsed.result;
            if (result.content && result.content[0]?.text) {
              const innerResult = JSON.parse(result.content[0].text);
              resolve(innerResult.sessions || []);
            } else if (result.details?.sessions) {
              resolve(result.details.sessions);
            } else {
              resolve([]);
            }
          } else {
            reject(new Error(parsed.error?.message || 'API error'));
          }
        } catch (e) {
          reject(new Error('Invalid JSON: ' + e.message));
        }
      });
    });

    req.on('error', (err) => reject(new Error('Request failed: ' + err.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(postData);
    req.end();
  });
}

// Simple health check - just verifies gateway is reachable
async function checkGatewayHealth(config) {
  return new Promise((resolve) => {
    const { port, token, host } = config;
    
    const req = http.request({
      hostname: host,
      port,
      path: '/health',
      method: 'GET',
      timeout: 3000
    }, (res) => {
      resolve(res.statusCode === 200);
    });
    
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function calculateCpuUsage(session, prevSession, elapsedMs) {
  if (!session || !prevSession || elapsedMs < 500) return 0;
  const currTokens = session.totalTokens || 0;
  const prevTokens = prevSession.totalTokens || 0;
  const diff = currTokens - prevTokens;
  if (diff <= 0) return 0;
  const tps = diff / (elapsedMs / 1000);
  return Math.min(100, tps);
}

function sortSessions(sessions, sortBy, reverse) {
  const sorted = [...sessions].sort((a, b) => {
    let valA, valB;
    
    switch (sortBy) {
      case 'cpu':
        valA = a._cpu || 0;
        valB = b._cpu || 0;
        break;
      case 'mem':
      case 'tokens':
        valA = a.totalTokens || 0;
        valB = b.totalTokens || 0;
        break;
      case 'idle':
        valA = a.updatedAt || 0;
        valB = b.updatedAt || 0;
        break;
      case 'name':
        valA = (a.displayName || a.key || '').toLowerCase();
        valB = (b.displayName || b.key || '').toLowerCase();
        break;
      default:
        valA = a._cpu || 0;
        valB = b._cpu || 0;
    }
    
    if (typeof valA === 'string') {
      return reverse ? valB.localeCompare(valA) : valA.localeCompare(valB);
    }
    return reverse ? valB - valA : valA - valB;
  });
  
  return sorted;
}

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function moveToTop() {
  process.stdout.write('\x1b[H');
}

function render(sysInfo, gwUptime, sessionCount, sessions, error, delay) {
  const width = process.stdout.columns || 80;
  
  // If showing help, render that instead
  if (showingHelp) {
    const helpLines = [
      '',
      '  CLAWTOP - Keyboard Shortcuts',
      '',
      '  q         Quit',
      '  Space     Pause/Resume updates',
      '  r         Reverse sort order',
      '  s         Cycle sort field (cpu → mem → idle → tokens → name)',
      '  d         Change delay (prompts for seconds)',
      '  n         Change iterations (prompts for number, 0 = infinite)',
      '  h         Toggle this help',
      '',
      '  Press any key to return...',
      ''
    ];
    clearScreen();
    console.log(C.cyan + C.bright + '┌─ CLAWTOP HELP ────────────────────────────────────────────────────────────┐' + C.reset);
    helpLines.forEach(line => console.log(line));
    console.log(C.cyan + '└───────────────────────────────────────────────────────────────────────────────┘' + C.reset);
    return;
  }
  
  // If awaiting input, show that
  if (awaitingInput === 'delay') {
    clearScreen();
    console.log(C.cyan + '┌─ CLAWTOP ─────────────────────────────────────────────────────────────────────┐' + C.reset);
    console.log(C.yellow + '  Enter delay in seconds (current: ' + CONFIG.delay + 's): ' + C.reset + inputBuffer);
    console.log(C.gray + '  Press Enter to confirm, Esc to cancel' + C.reset);
    console.log(C.cyan + '└───────────────────────────────────────────────────────────────────────────────┘' + C.reset);
    return;
  }
  
  if (awaitingInput === 'iterations') {
    clearScreen();
    console.log(C.cyan + '┌─ CLAWTOP ─────────────────────────────────────────────────────────────────────┐' + C.reset);
    const iterStr = CONFIG.iterations === Infinity ? 'infinite' : CONFIG.iterations;
    console.log(C.yellow + '  Enter iterations (current: ' + iterStr + '): ' + C.reset + inputBuffer);
    console.log(C.gray + '  Press Enter to confirm, Esc to cancel' + C.reset);
    console.log(C.cyan + '└───────────────────────────────────────────────────────────────────────────────┘' + C.reset);
    return;
  }
  
  // Normal render
  clearScreen();
  
  const statusLine = paused ? C.yellow + ' [PAUSED] ' + C.reset : '';
  console.log(C.cyan + C.bright + '┌─ CLAWTOP ─────────────────────────────────────────────────────────────────────┐' + C.reset);
  console.log(C.gray + '  OpenClaw session monitor' + statusLine + ' '.repeat(width - 45) + C.gray + `Refresh: ${delay}s` + C.reset);
  console.log(C.cyan + '├──────────────────────────────────────────────────────────────────────────────┤' + C.reset);
  
  if (CONFIG.showSystem) {
    const cpuUsage = sysInfo.cpuUsage !== null ? sysInfo.cpuUsage : 0;
    const memPercent = sysInfo.totalMem > 0 ? Math.round((sysInfo.usedMem / sysInfo.totalMem) * 100) : 0;
    const sysLine = `  ${C.cyan}OS:${C.reset} ${sysInfo.os}  ${C.cyan}CPU:${C.reset} ${cpuUsage}%  ${C.cyan}Mem:${C.reset} ${formatBytes(sysInfo.usedMem)}/${formatBytes(sysInfo.totalMem)} (${memPercent}%)  ${C.cyan}Uptime:${C.reset} ${formatDuration(sysInfo.uptime)}`;
    console.log(sysLine.substring(0, width - 2));
    
    const gwLine = `  ${C.magenta}Gateway:${C.reset} ${gwUptime ? formatDuration(gwUptime) : C.red + 'offline' + C.reset}  ${C.magenta}Sessions:${C.reset} ${sessionCount}  ${C.magenta}Node:${C.reset} ${sysInfo.nodeVersion}`;
    console.log(gwLine.substring(0, width - 2));
  }
  
  console.log(C.cyan + '├──────────────────────────────────────────────────────────────────────────────┤' + C.reset);
  
  const sortIndicator = (field) => CONFIG.sortBy === field ? (CONFIG.reverse ? '▼' : '▲') : ' ';
  console.log(C.white + C.bright + 
    `  ${sortIndicator('name')} NAME                         ${sortIndicator('cpu')} CPU   ${sortIndicator('mem')} TOKENS    ${sortIndicator('idle')} IDLE    CHANNEL` + 
    C.reset);
  console.log(C.cyan + '├──────────────────────────────────────────────────────────────────────────────┤' + C.reset);
  
  if (error) {
    console.log(C.red + '  Error: ' + error + C.reset);
    console.log(C.gray + `  Gateway may be offline. Config: ${config.host}:${config.port}` + C.reset);
  } else if (sessions.length === 0) {
    console.log(C.gray + '  No active sessions' + C.reset);
  } else {
    sessions.forEach((s) => {
      const name = (s.displayName || s.key || 'unknown').substring(0, 27).padEnd(27);
      const cpu = s._cpu || 0;
      const tokens = s.totalTokens || 0;
      const idleMs = s.updatedAt ? Date.now() - s.updatedAt : 0;
      let idleStr;
      if (idleMs < 60000) idleStr = Math.round(idleMs / 1000) + 's';
      else if (idleMs < 3600000) idleStr = Math.round(idleMs / 60000) + 'm';
      else idleStr = Math.round(idleMs / 3600000) + 'h';
      
      const channel = (s.channel || '-').substring(0, 10);
      
      let nameColor = C.white;
      let cpuColor = C.gray;
      
      if (idleMs < 5 * 60 * 1000) {
        nameColor = C.green;
        cpuColor = cpu > 50 ? C.red : (cpu > 20 ? C.yellow : C.green);
      } else if (idleMs < 30 * 60 * 1000) {
        nameColor = C.yellow;
      } else {
        nameColor = C.gray;
      }
      
      const cpuStr = cpu > 0 ? cpu.toFixed(1) + '%' : '-';
      const tokensStr = tokens > 0 ? formatNumber(tokens) : '-';
      
      console.log(`  ${nameColor}${name}${C.reset} ${cpuColor}${cpuStr.padStart(6)}${C.reset} ${tokensStr.padStart(9)} ${idleStr.padStart(7)}  ${channel}`);
    });
  }
  
  console.log(C.cyan + '├──────────────────────────────────────────────────────────────────────────────┤' + C.reset);
  console.log(C.gray + `  Sort: ${CONFIG.sortBy} (s)  Reverse: ${CONFIG.reverse ? 'ON' : 'OFF'} (r)  Delay: ${CONFIG.delay}s (d)  Quit: q  Help: h` + C.reset);
  console.log(C.cyan + '└───────────────────────────────────────────────────────────────────────────────┘' + C.reset);
}

async function main() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      console.log(`
clawtop - A top-like utility for monitoring OpenClaw instances

Usage: node clawtop.js [options]

Options:
  -n, --iterations N   Number of iterations (default: infinite)
  -d, --delay N        Delay in seconds between updates (default: 2)
  -s, --sort FIELD     Sort by: cpu, mem, idle, tokens, name (default: cpu)
  --no-color           Disable colored output
  --no-system          Hide system info
  -h, --help           Show this help

Keyboard shortcuts (when running):
  Space    Pause/Resume updates
  q        Quit
  r        Reverse sort order
  s        Cycle sort field
  d        Change delay (prompts)
  n        Change iterations (prompts)
  h        Toggle help

Examples:
  node clawtop.js
  node clawtop.js -n 5
  node clawtop.js -d 5 -s idle
`);
      process.exit(0);
    } else if (arg === '-n' || arg === '--iterations') {
      CONFIG.iterations = parseInt(args[++i]) || Infinity;
    } else if (arg === '-d' || arg === '--delay') {
      CONFIG.delay = parseInt(args[++i]) || 2;
    } else if (arg === '-s' || arg === '--sort') {
      CONFIG.sortBy = args[++i] || 'cpu';
    } else if (arg === '--no-color') {
      Object.keys(C).forEach(k => C[k] = '');
    } else if (arg === '--no-system') {
      CONFIG.showSystem = false;
    }
  }
  
  const config = getGatewayConfig();
  let iterations = 0;
  let prevSessions = [];
  let lastTime = Date.now();
  let lastRenderTime = Date.now();
  
  // Setup input handling
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    
    process.stdin.on('keypress', (str, key) => {
      // Handle help toggle
      if (key.name === 'h' && !awaitingInput) {
        showingHelp = !showingHelp;
        lastRenderTime = Date.now(); // Force render
        return;
      }
      
      // If showing help, any key closes it
      if (showingHelp) {
        showingHelp = false;
        lastRenderTime = Date.now();
        return;
      }
      
      // Handle input modes
      if (awaitingInput) {
        if (key.name === 'escape') {
          awaitingInput = null;
          inputBuffer = '';
        } else if (key.name === 'return' || key.name === 'enter') {
          if (awaitingInput === 'delay') {
            const newDelay = parseInt(inputBuffer);
            if (newDelay > 0 && newDelay <= 3600) {
              CONFIG.delay = newDelay;
            }
          } else if (awaitingInput === 'iterations') {
            const newIter = parseInt(inputBuffer);
            if (!isNaN(newIter)) {
              CONFIG.iterations = newIter === 0 ? Infinity : newIter;
            }
          }
          awaitingInput = null;
          inputBuffer = '';
        } else if (key.name === 'backspace') {
          inputBuffer = inputBuffer.slice(0, -1);
        } else if (str && str.length === 1 && /[\d]/.test(str)) {
          inputBuffer += str;
        }
        lastRenderTime = Date.now();
        return;
      }
      
      // Regular keyboard shortcuts
      if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
        console.log('\n' + C.gray + 'Goodbye!' + C.reset);
        process.exit(0);
      } else if (key.name === 'space') {
        paused = !paused;
      } else if (key.name === 'r') {
        CONFIG.reverse = !CONFIG.reverse;
      } else if (key.name === 's') {
        const fields = ['cpu', 'mem', 'idle', 'tokens', 'name'];
        const idx = fields.indexOf(CONFIG.sortBy);
        CONFIG.sortBy = fields[(idx + 1) % fields.length];
      } else if (key.name === 'd') {
        awaitingInput = 'delay';
        inputBuffer = '';
      } else if (key.name === 'n') {
        awaitingInput = 'iterations';
        inputBuffer = '';
      }
      
      lastRenderTime = Date.now();
    });
  }
  
  // Main loop
  while (iterations < CONFIG.iterations) {
    // Skip iteration if paused, but still render to show paused state
    if (!paused && !showingHelp && !awaitingInput) {
      const now = Date.now();
      const elapsed = now - lastTime;
      lastTime = now;
      
      const sysInfo = getSystemInfo();
      sysInfo.cpuUsage = getCpuUsage();
      const gwUptime = getGatewayUptime();
      
      let sessions = [];
      let error = null;
      try {
        sessions = await fetchSessions(config);
      } catch (err) {
        error = err.message;
      }
      
      sessions = sessions.map(s => {
        const prev = prevSessions.find(ps => ps.key === s.key);
        s._cpu = calculateCpuUsage(s, prev, elapsed);
        return s;
      });
      
      sessions = sortSessions(sessions, CONFIG.sortBy, CONFIG.reverse).slice(0, CONFIG.maxSessions);
      prevSessions = sessions;
      
      render(sysInfo, gwUptime, sessions.length, sessions, error, CONFIG.delay);
      iterations++;
    } else if (paused || showingHelp || awaitingInput) {
      // Still render to show state
      const sysInfo = getSystemInfo();
      sysInfo.cpuUsage = getCpuUsage();
      const gwUptime = getGatewayUptime();
      render(sysInfo, gwUptime, prevSessions.length, prevSessions, null, CONFIG.delay);
    }
    
    // Calculate sleep time - use shorter interval when paused/input
    const sleepTime = (paused || showingHelp || awaitingInput) ? 500 : CONFIG.delay * 1000;
    await new Promise(resolve => setTimeout(resolve, sleepTime));
  }
  
  console.log(C.gray + '\nCompleted ' + CONFIG.iterations + ' iterations.' + C.reset);
}

main().catch(err => {
  console.error(C.red + 'Fatal error: ' + err.message + C.reset);
  process.exit(1);
});
