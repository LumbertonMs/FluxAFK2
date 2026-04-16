"use strict";

const { addLog, getLogs } = require("./logger");
const mineflayer = require("mineflayer");
const { Movements, pathfinder, goals } = require("mineflayer-pathfinder");
const { GoalBlock } = goals;
const config = require("./settings.json");
const express = require("express");
const http = require("http");
const https = require("https");

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive
// ============================================================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 5000;

// Bot state tracking
let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
  wasThrottled: false,
};

// Health check endpoint for monitoring
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} — Command Center</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
        <style>

          :root {
            --bg-deep: #06080d;
            --bg-surface: #0c1017;
            --bg-card: #111721;
            --bg-card-hover: #171e2b;
            --bg-elevated: #1a2235;
            --bg-glass: rgba(17,23,33,0.7);
            --border-subtle: rgba(255,255,255,0.04);
            --border-accent: rgba(255,255,255,0.08);
            --border-glow: rgba(99,102,241,0.3);
            --text-primary: #eef2ff;
            --text-secondary: #94a3b8;
            --text-muted: #475569;
            --accent: #818cf8;
            --accent-dim: #6366f1;
            --accent-glow: rgba(129,140,248,0.12);
            --accent-bg: rgba(129,140,248,0.06);
            --green: #34d399;
            --green-dim: #10b981;
            --green-glow: rgba(52,211,153,0.12);
            --green-bg: rgba(52,211,153,0.06);
            --red: #f87171;
            --red-dim: #ef4444;
            --red-glow: rgba(248,113,113,0.12);
            --red-bg: rgba(248,113,113,0.06);
            --amber: #fbbf24;
            --amber-bg: rgba(251,191,36,0.06);
            --blue: #60a5fa;
            --blue-bg: rgba(96,165,250,0.06);
            --radius: 16px;
            --radius-sm: 10px;
            --radius-xs: 6px;
            --shadow-card: 0 4px 32px rgba(0,0,0,0.4);
            --shadow-float: 0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);
            --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace;
          }
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-deep);
            color: var(--text-primary);
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
          }
          @keyframes fadeInUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
          @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
          @keyframes pulse-ring { 0% { transform:scale(1); opacity:0.6; } 100% { transform:scale(1.8); opacity:0; } }
          @keyframes pulse-dot { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
          @keyframes gradient-shift { 0% { background-position:0% 50%; } 50% { background-position:100% 50%; } 100% { background-position:0% 50%; } }
          @keyframes float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
          @keyframes shimmer { 0% { background-position:-200% 0; } 100% { background-position:200% 0; } }

          body { padding: 0; }

          .app-shell { display: flex; min-height: 100vh; }

          /* ——— Sidebar ——— */
          .sidebar {
            width: 260px; flex-shrink: 0;
            background: var(--bg-surface);
            border-right: 1px solid var(--border-subtle);
            display: flex; flex-direction: column;
            padding: 28px 0;
            position: fixed; top: 0; left: 0; bottom: 0; z-index: 50;
          }
          .sidebar-brand {
            padding: 0 24px; margin-bottom: 36px;
            display: flex; align-items: center; gap: 12px;
          }
          .brand-icon {
            width: 40px; height: 40px; border-radius: 12px;
            background: linear-gradient(135deg, var(--accent), var(--green));
            display: flex; align-items: center; justify-content: center;
            font-size: 18px; font-weight: 900; color: #fff;
            box-shadow: 0 0 20px var(--accent-glow);
          }
          .brand-name { font-size: 17px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.3px; }
          .brand-tag { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

          .nav-section { padding: 0 14px; margin-bottom: 8px; }
          .nav-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-muted); padding: 0 10px; margin-bottom: 8px; }
          .nav-item {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 14px; border-radius: var(--radius-sm);
            font-size: 13.5px; font-weight: 500; color: var(--text-secondary);
            text-decoration: none; transition: all 0.2s;
            margin-bottom: 2px;
          }
          .nav-item:hover { background: rgba(255,255,255,0.04); color: var(--text-primary); }
          .nav-item.active {
            background: var(--accent-bg); color: var(--accent);
            font-weight: 600; border: 1px solid rgba(129,140,248,0.12);
          }
          .nav-icon { font-size: 16px; width: 20px; text-align: center; }

          .sidebar-footer { margin-top: auto; padding: 0 24px; }
          .sidebar-status {
            background: var(--bg-card); border: 1px solid var(--border-subtle);
            border-radius: var(--radius-sm); padding: 14px; font-size: 12px;
          }
          .sidebar-status-label { color: var(--text-muted); margin-bottom: 6px; }
          .sidebar-status-value { color: var(--text-primary); font-weight: 600; font-family: var(--font-mono); font-size: 11px; }

          /* ——— Main ——— */
          .main-content { flex: 1; margin-left: 260px; padding: 32px 40px; }

          .page-header { margin-bottom: 32px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
          .page-title { font-size: 28px; font-weight: 900; letter-spacing: -0.7px; color: var(--text-primary); }
          .page-subtitle { font-size: 14px; color: var(--text-muted); margin-top: 4px; }

          .header-actions { display: flex; gap: 10px; }

          /* ——— Status Banner ——— */
          .status-banner {
            border-radius: var(--radius); padding: 24px 28px;
            display: flex; align-items: center; gap: 20px;
            margin-bottom: 28px; transition: all 0.5s ease;
            position: relative; overflow: hidden;
            animation: fadeInUp 0.5s ease-out;
          }
          .status-banner::before {
            content: ''; position: absolute; inset: 0; opacity: 0.4;
            background: linear-gradient(135deg, transparent 40%, currentColor);
            pointer-events: none;
          }
          .status-banner.online {
            background: var(--green-bg); border: 1px solid rgba(52,211,153,0.15);
            color: var(--green);
          }
          .status-banner.offline {
            background: var(--red-bg); border: 1px solid rgba(248,113,113,0.15);
            color: var(--red);
          }
          .status-indicator { position: relative; width: 52px; height: 52px; flex-shrink: 0; }
          .status-dot {
            width: 52px; height: 52px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 22px; font-weight: 800; position: relative; z-index: 2;
          }
          .status-dot.online { background: rgba(52,211,153,0.15); color: var(--green); }
          .status-dot.offline { background: rgba(248,113,113,0.15); color: var(--red); }
          .status-ring {
            position: absolute; inset: -4px; border-radius: 50%;
            border: 2px solid currentColor; opacity: 0.3;
            animation: pulse-ring 2s ease-out infinite;
          }
          .status-info h2 { font-size: 20px; font-weight: 800; line-height: 1.2; }
          .status-info p { font-size: 13px; opacity: 0.7; margin-top: 2px; }

          /* ——— Stats Grid ——— */
          .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 28px; }
          .stat-tile {
            background: var(--bg-card); border: 1px solid var(--border-subtle);
            border-radius: var(--radius); padding: 22px 24px;
            transition: all 0.3s ease;
            animation: fadeInUp 0.5s ease-out backwards;
          }
          .stat-tile:nth-child(1) { animation-delay: 0.08s; }
          .stat-tile:nth-child(2) { animation-delay: 0.14s; }
          .stat-tile:nth-child(3) { animation-delay: 0.20s; }
          .stat-tile:nth-child(4) { animation-delay: 0.26s; }
          .stat-tile:hover {
            background: var(--bg-card-hover); border-color: var(--border-accent);
            transform: translateY(-2px); box-shadow: var(--shadow-card);
          }
          .stat-icon { font-size: 20px; margin-bottom: 14px; }
          .stat-label {
            font-size: 11px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 8px;
          }
          .stat-value { font-size: 22px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.3px; }
          .stat-sub { font-size: 11px; color: var(--text-muted); margin-top: 6px; }

          /* ——— Module Cards ——— */
          .section-title { font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
          .section-badge { font-size: 11px; background: var(--accent-bg); color: var(--accent); padding: 3px 10px; border-radius: 20px; font-weight: 600; }

          .modules-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 28px; }
          .module-card {
            background: var(--bg-card); border: 1px solid var(--border-subtle);
            border-radius: var(--radius-sm); padding: 16px 18px;
            display: flex; align-items: center; gap: 12px;
            transition: all 0.2s;
          }
          .module-card:hover { border-color: var(--border-accent); }
          .module-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
          .module-dot.on { background: var(--green); box-shadow: 0 0 8px var(--green-glow); animation: pulse-dot 2s infinite; }
          .module-dot.off { background: var(--text-muted); }
          .module-name { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
          .module-status { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }

          /* ——— Controls ——— */
          .controls-row { display: flex; gap: 12px; flex-wrap: wrap; }
          .btn {
            height: 48px; border-radius: var(--radius-sm);
            font-size: 13.5px; font-weight: 700;
            cursor: pointer; font-family: inherit;
            border: 1.5px solid transparent;
            transition: all 0.25s ease;
            display: inline-flex; align-items: center; justify-content: center; gap: 8px;
            padding: 0 24px; position: relative; overflow: hidden;
          }
          .btn::after {
            content: ''; position: absolute; inset: 0;
            background: linear-gradient(135deg, rgba(255,255,255,0.06), transparent);
            opacity: 0; transition: opacity 0.25s;
          }
          .btn:hover::after { opacity: 1; }
          .btn:hover { transform: translateY(-1px); }
          .btn:active { transform: scale(0.97); }
          .btn-start { border-color: rgba(52,211,153,0.3); background: var(--green-bg); color: var(--green); }
          .btn-start:hover { box-shadow: 0 4px 24px var(--green-glow); }
          .btn-stop { border-color: rgba(248,113,113,0.3); background: var(--red-bg); color: var(--red); }
          .btn-stop:hover { box-shadow: 0 4px 24px var(--red-glow); }
          .btn-ghost {
            border-color: var(--border-subtle); background: var(--bg-card);
            color: var(--text-secondary); text-decoration: none;
          }
          .btn-ghost:hover { background: var(--bg-elevated); color: var(--text-primary); border-color: var(--border-accent); }

          .control-grid {
            display: grid;
            grid-template-columns: 1.3fr 0.7fr;
            gap: 16px;
            margin-bottom: 28px;
          }
          .control-card {
            background: var(--bg-card); border: 1px solid var(--border-subtle);
            border-radius: var(--radius); padding: 24px;
            box-shadow: var(--shadow-card);
          }
          .control-card-header { margin-bottom: 18px; }
          .control-card-header h3 { margin: 0 0 4px; font-size: 16px; font-weight: 800; }
          .control-card-header p { margin: 0; font-size: 12px; color: var(--text-muted); }
          .control-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
          .chat-panel { margin-top: 14px; }
          .chat-label { display: block; color: var(--text-secondary); font-size: 12px; margin-bottom: 10px; }
          .chat-input {
            width: 100%; min-height: 110px; background: var(--bg-surface);
            border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
            color: var(--text-primary); padding: 14px 16px;
            font-family: var(--font-mono); font-size: 13px; resize: vertical;
          }
          .chat-actions {
            display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px;
          }
          .status-grid {
            display: grid; grid-template-columns: 1fr 1fr;
            gap: 14px; margin-top: 18px;
          }
          .status-item {
            background: var(--bg-surface); border: 1px solid var(--border-subtle);
            border-radius: var(--radius-sm); padding: 14px;
          }
          .status-item .status-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.7px; }
          .status-item strong { display: block; margin-top: 8px; font-size: 20px; color: var(--text-primary); }
          .control-note { margin-top: 18px; color: var(--text-muted); font-size: 13px; line-height: 1.6; }

          .modal-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.55);
            display: flex; align-items: center; justify-content: center;
            opacity: 0; pointer-events: none; transition: opacity 0.2s ease;
          }
          .modal-overlay.visible { opacity: 1; pointer-events: auto; }
          .modal {
            width: min(520px, calc(100% - 40px)); background: var(--bg-card);
            border: 1px solid var(--border-accent); border-radius: var(--radius);
            padding: 26px 28px; box-shadow: var(--shadow-card);
          }
          .modal h3 { margin: 0 0 10px; font-size: 18px; }
          .modal p { margin: 0 0 22px; color: var(--text-secondary); line-height: 1.7; }
          .modal-actions { display: flex; justify-content: flex-end; gap: 12px; flex-wrap: wrap; }

          .toast {
            position: fixed; right: 22px; bottom: 22px; min-width: 240px;
            padding: 14px 18px; border-radius: 16px;
            font-size: 13px; font-weight: 600; color: #fff;
            opacity: 0; transform: translateY(12px); transition: opacity 0.2s ease, transform 0.2s ease;
            z-index: 999;
          }
          .toast.success { background: rgba(52,211,153,0.95); }
          .toast.error { background: rgba(248,113,113,0.95); }
          .toast.visible { opacity: 1; transform: translateY(0); }

          /* ——— Responsive ——— */
          @media (max-width: 768px) {
            .sidebar { display: none; }
            .main-content { margin-left: 0; padding: 20px; }
            .stats-grid { grid-template-columns: 1fr 1fr; }
            .modules-grid { grid-template-columns: 1fr 1fr; }
          }
        </style>
      </head>
      <body>
        <div class="app-shell">

          <nav class="sidebar">
            <div class="sidebar-brand">
              <div class="brand-icon">F</div>
              <div>
                <div class="brand-name">FluxAFK</div>
                <div class="brand-tag">Command Center</div>
              </div>
            </div>

            <div class="nav-section">
              <div class="nav-label">Navigation</div>
              <a href="/" class="nav-item active"><span class="nav-icon">◈</span> Dashboard</a>
              <a href="/logs" class="nav-item"><span class="nav-icon">▤</span> Live Logs</a>
              <a href="/tutorial" class="nav-item"><span class="nav-icon">◎</span> Setup Guide</a>
            </div>

            <div class="sidebar-footer">
              <div class="sidebar-status">
                <div class="sidebar-status-label">Server</div>
                <div class="sidebar-status-value">${config.server.ip}:${config.server.port}</div>
              </div>
            </div>
          </nav>

          <main class="main-content" role="main">

            <div class="page-header">
              <div>
                <h1 class="page-title">Dashboard</h1>
                <p class="page-subtitle">Real-time bot monitoring &amp; control</p>
              </div>
              <div class="header-actions">
                <button class="btn btn-start" onclick="startBot()">▶ Start</button>
                <button class="btn btn-stop" onclick="stopBot()">■ Stop</button>
              </div>
            </div>

            <section id="status-banner" class="status-banner offline" role="status" aria-live="polite">
              <div class="status-indicator">
                <div id="status-dot" class="status-dot offline">✗</div>
                <div class="status-ring"></div>
              </div>
              <div class="status-info">
                <h2 id="status-label">Connecting…</h2>
                <p id="status-detail">Establishing connection to server</p>
              </div>
            </section>

            <div class="stats-grid">
              <div class="stat-tile">
                <div class="stat-icon">⏱</div>
                <div class="stat-label">Uptime</div>
                <div class="stat-value" id="uptime-text">—</div>
                <div class="stat-sub">Since last connection</div>
              </div>
              <div class="stat-tile">
                <div class="stat-icon">📍</div>
                <div class="stat-label">Position</div>
                <div class="stat-value" id="coords-text">Searching…</div>
                <div class="stat-sub">Current coordinates</div>
              </div>
              <div class="stat-tile">
                <div class="stat-icon">🤖</div>
                <div class="stat-label">Bots</div>
                <div class="stat-value" id="connected-bots-text">${getConnectedBotCount()}</div>
                <div class="stat-sub" id="bot-count-sub">of ${getTotalBotCount()} connected</div>
              </div>
              <div class="stat-tile">
                <div class="stat-icon">💾</div>
                <div class="stat-label">Memory</div>
                <div class="stat-value" id="memory-text">—</div>
                <div class="stat-sub">Heap usage</div>
              </div>
            </div>

            <div class="section-title">Bot Control <span class="section-badge">${getConnectedBotCount()}/${getTotalBotCount()} active</span></div>
            <div class="control-grid">
              <div class="control-card">
                <div class="control-card-header">
                  <h3>Quick Controls</h3>
                  <p>Start, stop and send text or commands to your bot(s).</p>
                </div>
                <div class="control-actions">
                  <button class="btn btn-start" onclick="showConfirm('start')">▶ Start Bot(s)</button>
                  <button class="btn btn-stop" onclick="showConfirm('stop')">■ Stop Bot(s)</button>
                </div>
                <label class="chat-label" for="chat-input">Send chat / command</label>
                <div class="chat-panel">
                  <textarea id="chat-input" class="chat-input" placeholder="Type a command or chat message…"></textarea>
                  <div class="chat-actions">
                    <button type="button" class="btn btn-ghost" onclick="sendDashboardCommand('/help')">/help</button>
                    <button type="button" class="btn btn-ghost" onclick="sendDashboardCommand('/status')">/status</button>
                    <button type="button" class="btn btn-ghost" onclick="sendDashboardCommand('/pos')">/pos</button>
                    <button type="button" class="btn btn-start" onclick="sendDashboardText()">Send</button>
                  </div>
                </div>
              </div>
              <div class="control-card status-card">
                <div class="control-card-header">
                  <h3>Bot Summary</h3>
                  <p>Live connection information for your current bot pool.</p>
                </div>
                <div class="status-grid">
                  <div class="status-item">
                    <span class="status-label">Total bots</span>
                    <strong id="total-bots-text">${getTotalBotCount()}</strong>
                  </div>
                  <div class="status-item">
                    <span class="status-label">Connected</span>
                    <strong id="connected-bots-status">${getConnectedBotCount()}</strong>
                  </div>
                  <div class="status-item">
                    <span class="status-label">Last activity</span>
                    <strong id="last-activity-text">—</strong>
                  </div>
                  <div class="status-item">
                    <span class="status-label">Server version</span>
                    <strong>${config.server.version || 'auto'}</strong>
                  </div>
                </div>
                <p class="control-note">Multi-bot mode works best with offline/noauth accounts. Adjust <code>server.count</code> in settings.json.</p>
              </div>
            </div>

            <div class="section-title">Active Modules <span class="section-badge">${Object.values(config.modules).filter(Boolean).length} enabled</span></div>
            <div class="modules-grid">
              <div class="module-card">
                <div class="module-dot ${config.modules.avoidMobs ? 'on' : 'off'}"></div>
                <div><div class="module-name">Mob Avoidance</div><div class="module-status">${config.modules.avoidMobs ? 'Active' : 'Off'}</div></div>
              </div>
              <div class="module-card">
                <div class="module-dot ${config.modules.combat ? 'on' : 'off'}"></div>
                <div><div class="module-name">Combat</div><div class="module-status">${config.modules.combat ? 'Active' : 'Off'}</div></div>
              </div>
              <div class="module-card">
                <div class="module-dot ${config.modules.chat ? 'on' : 'off'}"></div>
                <div><div class="module-name">Chat Response</div><div class="module-status">${config.modules.chat ? 'Active' : 'Off'}</div></div>
              </div>
              <div class="module-card">
                <div class="module-dot ${config.modules.beds ? 'on' : 'off'}"></div>
                <div><div class="module-name">Bed Module</div><div class="module-status">${config.modules.beds ? 'Active' : 'Off'}</div></div>
              </div>
              <div class="module-card">
                <div class="module-dot ${config.movement.enabled ? 'on' : 'off'}"></div>
                <div><div class="module-name">Movement</div><div class="module-status">${config.movement.enabled ? 'Active' : 'Off'}</div></div>
              </div>
              <div class="module-card">
                <div class="module-dot ${config.utils['anti-afk'].enabled ? 'on' : 'off'}"></div>
                <div><div class="module-name">Anti-AFK</div><div class="module-status">${config.utils['anti-afk'].enabled ? 'Active' : 'Off'}</div></div>
              </div>
            </div>

            <div class="section-title">Quick Links</div>
            <div class="controls-row">
              <a href="/logs" class="btn btn-ghost">▤ Live Logs</a>
              <a href="/tutorial" class="btn btn-ghost">◎ Setup Guide</a>
            </div>

          </main>
        </div>

        <div id="confirm-modal" class="modal-overlay" onclick="if (event.target === this) hideConfirm()">
          <div class="modal" role="dialog" aria-modal="true">
            <h3 id="confirm-title">Confirm action</h3>
            <p id="confirm-text">Are you sure you want to continue?</p>
            <input type="hidden" id="confirm-action" value="">
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" onclick="hideConfirm()">Cancel</button>
              <button type="button" id="confirm-submit" class="btn btn-start" onclick="submitConfirm()">Confirm</button>
            </div>
          </div>
        </div>

        <div id="toast" class="toast"></div>

        <script>
          function formatUptime(s) {
            var h = Math.floor(s / 3600);
            var m = Math.floor((s % 3600) / 60);
            var sec = s % 60;
            if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
            if (m > 0) return m + 'm ' + sec + 's';
            return sec + 's';
          }

          async function update() {
            try {
              var r = await fetch('/health');
              var data = await r.json();
              var online = data.status === 'connected';

              var banner = document.getElementById('status-banner');
              var dot    = document.getElementById('status-dot');
              var label  = document.getElementById('status-label');
              var detail = document.getElementById('status-detail');

              banner.className = 'status-banner ' + (online ? 'online' : 'offline');
              dot.className    = 'status-dot '    + (online ? 'online' : 'offline');
              dot.textContent  = online ? '✓' : '✗';
              label.textContent = online ? 'Connected' : 'Disconnected';
              detail.textContent = online
                ? data.connectedBots + '/' + data.totalBots + ' bots active'
                : 'Attempting to reconnect…';

              document.getElementById('total-bots-text').textContent = data.totalBots;
              document.getElementById('connected-bots-text').textContent = data.connectedBots;
              document.getElementById('connected-bots-status').textContent = data.connectedBots;
              document.getElementById('bot-count-sub').textContent = 'of ' + data.totalBots + ' connected';
              document.getElementById('last-activity-text').textContent = data.lastActivity
                ? formatUptime(Math.floor((Date.now() - data.lastActivity) / 1000))
                : '—';

              document.getElementById('uptime-text').textContent = formatUptime(data.uptime);
              document.getElementById('reconnect-text').textContent = data.reconnectAttempts || '0';
              document.getElementById('memory-text').textContent = (data.memoryUsage || 0).toFixed(1) + ' MB';

              if (data.coords) {
                var x = Math.floor(data.coords.x);
                var y = Math.floor(data.coords.y);
                var z = Math.floor(data.coords.z);
                document.getElementById('coords-text').textContent = x + ', ' + y + ', ' + z;
              } else {
                document.getElementById('coords-text').textContent = 'Searching…';
              }
            } catch (e) {
              document.getElementById('status-label').textContent = 'Unreachable';
            }
          }

          function showToast(message, type) {
            var toast = document.getElementById('toast');
            if (!toast) return;
            toast.textContent = message;
            toast.className = 'toast visible ' + (type === 'error' ? 'error' : 'success');
            clearTimeout(window._toastTimer);
            window._toastTimer = setTimeout(function () {
              toast.className = 'toast';
            }, 3200);
          }

          function showConfirm(action) {
            var modal = document.getElementById('confirm-modal');
            var title = document.getElementById('confirm-title');
            var text = document.getElementById('confirm-text');
            var button = document.getElementById('confirm-submit');
            document.getElementById('confirm-action').value = action;
            modal.classList.add('visible');
            if (action === 'start') {
              title.textContent = 'Start Bot(s)';
              text.textContent = 'Start all configured bot instances and connect to the server.';
              button.textContent = 'Start';
              button.className = 'btn btn-start';
            } else {
              title.textContent = 'Stop Bot(s)';
              text.textContent = 'Stop all running bots and clear their current session.';
              button.textContent = 'Stop';
              button.className = 'btn btn-stop';
            }
          }

          function hideConfirm() {
            document.getElementById('confirm-modal').classList.remove('visible');
          }

          async function submitConfirm() {
            var action = document.getElementById('confirm-action').value;
            var button = document.getElementById('confirm-submit');
            button.disabled = true;
            var response = await fetch(action === 'start' ? '/start' : '/stop', {
              method: 'POST',
            });
            var data = await response.json();
            showToast(data.success ? (action === 'start' ? 'Starting bot(s)...' : 'Stopping bot(s)...') : data.msg, data.success ? 'success' : 'error');
            hideConfirm();
            button.disabled = false;
            update();
          }

          async function sendCommand(text) {
            if (!text) {
              showToast('Type a command or chat message first.', 'error');
              return;
            }
            var response = await fetch('/command', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ command: text }),
            });
            var data = await response.json();
            showToast(data.success ? 'Sent to bot(s)' : data.msg, data.success ? 'success' : 'error');
          }

          function sendDashboardCommand(command) {
            document.getElementById('chat-input').value = command;
            sendDashboardText();
          }

          function sendDashboardText() {
            var input = document.getElementById('chat-input');
            var text = input.value.trim();
            if (!text) {
              showToast('Type a message or command first.', 'error');
              return;
            }
            input.value = '';
            sendCommand(text);
          }

          setInterval(update, 5000);
          update();
        </script>
      </body>
    </html>
  `);
});


app.get("/tutorial", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} — Setup Guide</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
        <style>

          :root {
            --bg-deep: #06080d;
            --bg-surface: #0c1017;
            --bg-card: #111721;
            --bg-card-hover: #171e2b;
            --bg-elevated: #1a2235;
            --bg-glass: rgba(17,23,33,0.7);
            --border-subtle: rgba(255,255,255,0.04);
            --border-accent: rgba(255,255,255,0.08);
            --border-glow: rgba(99,102,241,0.3);
            --text-primary: #eef2ff;
            --text-secondary: #94a3b8;
            --text-muted: #475569;
            --accent: #818cf8;
            --accent-dim: #6366f1;
            --accent-glow: rgba(129,140,248,0.12);
            --accent-bg: rgba(129,140,248,0.06);
            --green: #34d399;
            --green-dim: #10b981;
            --green-glow: rgba(52,211,153,0.12);
            --green-bg: rgba(52,211,153,0.06);
            --red: #f87171;
            --red-dim: #ef4444;
            --red-glow: rgba(248,113,113,0.12);
            --red-bg: rgba(248,113,113,0.06);
            --amber: #fbbf24;
            --amber-bg: rgba(251,191,36,0.06);
            --blue: #60a5fa;
            --blue-bg: rgba(96,165,250,0.06);
            --radius: 16px;
            --radius-sm: 10px;
            --radius-xs: 6px;
            --shadow-card: 0 4px 32px rgba(0,0,0,0.4);
            --shadow-float: 0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);
            --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace;
          }
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-deep);
            color: var(--text-primary);
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
          }
          @keyframes fadeInUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
          @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
          @keyframes pulse-ring { 0% { transform:scale(1); opacity:0.6; } 100% { transform:scale(1.8); opacity:0; } }
          @keyframes pulse-dot { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
          @keyframes gradient-shift { 0% { background-position:0% 50%; } 50% { background-position:100% 50%; } 100% { background-position:0% 50%; } }
          @keyframes float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
          @keyframes shimmer { 0% { background-position:-200% 0; } 100% { background-position:200% 0; } }

          body { padding: 40px 24px; }
          main { width: 100%; max-width: 640px; margin: 0 auto; animation: fadeInUp 0.5s ease-out; }

          .back-link {
            display: inline-flex; align-items: center; gap: 8px;
            font-size: 13px; font-weight: 600; color: var(--text-secondary);
            text-decoration: none; padding: 10px 18px;
            background: var(--bg-card); border: 1px solid var(--border-subtle);
            border-radius: var(--radius-sm); margin-bottom: 36px;
            transition: all 0.25s;
          }
          .back-link:hover { background: var(--bg-elevated); color: var(--text-primary); transform: translateX(-3px); }

          header { margin-bottom: 40px; }
          header h1 { font-size: 32px; font-weight: 900; letter-spacing: -0.7px; }
          header p { font-size: 14px; color: var(--text-muted); margin-top: 8px; }

          .timeline { position: relative; padding-left: 36px; }
          .timeline::before {
            content: ''; position: absolute; left: 15px; top: 4px; bottom: 4px;
            width: 2px; background: linear-gradient(to bottom, var(--accent), var(--green), var(--blue));
            border-radius: 2px; opacity: 0.3;
          }
          .timeline-step {
            position: relative; margin-bottom: 32px;
            animation: fadeInUp 0.5s ease-out backwards;
          }
          .timeline-step:nth-child(1) { animation-delay: 0.1s; }
          .timeline-step:nth-child(2) { animation-delay: 0.2s; }
          .timeline-step:nth-child(3) { animation-delay: 0.3s; }

          .timeline-dot {
            position: absolute; left: -36px; top: 4px;
            width: 32px; height: 32px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 13px; font-weight: 800; z-index: 2;
          }
          .timeline-step:nth-child(1) .timeline-dot { background: var(--accent-bg); color: var(--accent); border: 2px solid rgba(129,140,248,0.25); }
          .timeline-step:nth-child(2) .timeline-dot { background: var(--green-bg); color: var(--green); border: 2px solid rgba(52,211,153,0.25); }
          .timeline-step:nth-child(3) .timeline-dot { background: var(--blue-bg); color: var(--blue); border: 2px solid rgba(96,165,250,0.25); }

          .step-card {
            background: var(--bg-card); border: 1px solid var(--border-subtle);
            border-radius: var(--radius); padding: 28px;
            transition: all 0.3s;
          }
          .step-card:hover { border-color: var(--border-accent); box-shadow: var(--shadow-card); transform: translateY(-2px); }
          .step-card h2 { font-size: 18px; font-weight: 800; margin-bottom: 18px; letter-spacing: -0.3px; }

          .step-list { list-style: none; display: flex; flex-direction: column; gap: 12px; }
          .step-list li {
            font-size: 14px; color: var(--text-secondary); line-height: 1.7;
            padding-left: 24px; position: relative;
          }
          .step-list li::before { content: '→'; position: absolute; left: 2px; color: var(--accent); font-weight: 700; }
          .step-list li strong { color: var(--text-primary); font-weight: 600; }

          code {
            background: var(--bg-elevated); border: 1px solid var(--border-accent);
            padding: 3px 8px; border-radius: var(--radius-xs);
            font-family: var(--font-mono); font-size: 12px; color: var(--accent);
          }

          footer { margin-top: 48px; text-align: center; }
          footer p { font-size: 11px; color: var(--text-muted); opacity: 0.4; }
        </style>
      </head>
      <body>
        <main>
          <a href="/" class="back-link">← Dashboard</a>

          <header>
            <h1>Setup Guide</h1>
            <p>Get your AFK bot running in under 15 minutes</p>
          </header>

          <div class="timeline">
            <div class="timeline-step">
              <div class="timeline-dot">1</div>
              <div class="step-card">
                <h2>Configure Aternos</h2>
                <ol class="step-list">
                  <li>Go to <strong>Aternos</strong> and open your server.</li>
                  <li>Install <strong>Paper/Bukkit</strong> as your server software.</li>
                  <li>Enable <strong>Cracked</strong> mode using the green switch.</li>
                  <li>Install plugins: <code>ViaVersion</code>, <code>ViaBackwards</code>, <code>ViaRewind</code></li>
                </ol>
              </div>
            </div>

            <div class="timeline-step">
              <div class="timeline-dot">2</div>
              <div class="step-card">
                <h2>GitHub Setup</h2>
                <ol class="step-list">
                  <li>Download this project as a ZIP and extract it.</li>
                  <li>Edit <code>settings.json</code> with your server IP and port.</li>
                  <li>Upload all files to a new <strong>GitHub Repository</strong>.</li>
                </ol>
              </div>
            </div>

            <div class="timeline-step">
              <div class="timeline-dot">3</div>
              <div class="step-card">
                <h2>Deploy on Replit</h2>
                <ol class="step-list">
                  <li>Import your GitHub repo into <strong>Replit</strong>.</li>
                  <li>Set the run command to <code>npm start</code>.</li>
                  <li>Hit <strong>Run</strong> — the bot connects automatically.</li>
                  <li>The bot pings itself every 10 minutes to stay alive.</li>
                </ol>
              </div>
            </div>
          </div>

          <footer><p>FluxAFK &middot; ${config.name}</p></footer>
        </main>
      </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: botState.connected ? "connected" : "disconnected",
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: getAnyBotCoords(),
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
    totalBots: getTotalBotCount(),
    connectedBots: getConnectedBotCount(),
  });
});

app.get("/ping", (req, res) => res.send("pong"));


app.get("/logs", (req, res) => {
  const logs = getLogs();

  const escapeHTML = (str) =>
    str.replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );

  const logCount = logs.length;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} — Live Logs</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
        <style>

          :root {
            --bg-deep: #06080d;
            --bg-surface: #0c1017;
            --bg-card: #111721;
            --bg-card-hover: #171e2b;
            --bg-elevated: #1a2235;
            --bg-glass: rgba(17,23,33,0.7);
            --border-subtle: rgba(255,255,255,0.04);
            --border-accent: rgba(255,255,255,0.08);
            --border-glow: rgba(99,102,241,0.3);
            --text-primary: #eef2ff;
            --text-secondary: #94a3b8;
            --text-muted: #475569;
            --accent: #818cf8;
            --accent-dim: #6366f1;
            --accent-glow: rgba(129,140,248,0.12);
            --accent-bg: rgba(129,140,248,0.06);
            --green: #34d399;
            --green-dim: #10b981;
            --green-glow: rgba(52,211,153,0.12);
            --green-bg: rgba(52,211,153,0.06);
            --red: #f87171;
            --red-dim: #ef4444;
            --red-glow: rgba(248,113,113,0.12);
            --red-bg: rgba(248,113,113,0.06);
            --amber: #fbbf24;
            --amber-bg: rgba(251,191,36,0.06);
            --blue: #60a5fa;
            --blue-bg: rgba(96,165,250,0.06);
            --radius: 16px;
            --radius-sm: 10px;
            --radius-xs: 6px;
            --shadow-card: 0 4px 32px rgba(0,0,0,0.4);
            --shadow-float: 0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);
            --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace;
          }
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-deep);
            color: var(--text-primary);
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
          }
          @keyframes fadeInUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
          @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
          @keyframes pulse-ring { 0% { transform:scale(1); opacity:0.6; } 100% { transform:scale(1.8); opacity:0; } }
          @keyframes pulse-dot { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
          @keyframes gradient-shift { 0% { background-position:0% 50%; } 50% { background-position:100% 50%; } 100% { background-position:0% 50%; } }
          @keyframes float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
          @keyframes shimmer { 0% { background-position:-200% 0; } 100% { background-position:200% 0; } }

          body { padding: 32px 24px; }
          main { width: 100%; max-width: 860px; margin: 0 auto; animation: fadeInUp 0.5s ease-out; }

          .top-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; flex-wrap: wrap; gap: 12px; }
          .back-link {
            display: inline-flex; align-items: center; gap: 8px;
            font-size: 13px; font-weight: 600; color: var(--text-secondary);
            text-decoration: none; padding: 10px 18px;
            background: var(--bg-card); border: 1px solid var(--border-subtle);
            border-radius: var(--radius-sm);
            transition: all 0.25s;
          }
          .back-link:hover { background: var(--bg-elevated); color: var(--text-primary); transform: translateX(-3px); }

          .badge {
            font-size: 12px; font-weight: 700; color: var(--accent);
            background: var(--accent-bg); border: 1px solid rgba(129,140,248,0.15);
            border-radius: 20px; padding: 6px 16px;
          }

          .page-header { margin-bottom: 24px; }
          .page-header h1 { font-size: 28px; font-weight: 900; letter-spacing: -0.5px; }
          .page-header p { font-size: 14px; color: var(--text-muted); margin-top: 4px; }

          .terminal {
            background: var(--bg-surface); border: 1px solid var(--border-subtle);
            border-radius: var(--radius); overflow: hidden;
            box-shadow: var(--shadow-float);
          }
          .terminal-bar {
            background: var(--bg-card); border-bottom: 1px solid var(--border-subtle);
            padding: 14px 20px; display: flex; align-items: center; gap: 8px;
          }
          .term-dot { width: 12px; height: 12px; border-radius: 50%; }
          .term-dot-r { background: #ff5f57; }
          .term-dot-y { background: #ffbd2e; }
          .term-dot-g { background: #28c840; }
          .term-title { font-size: 12px; font-weight: 500; color: var(--text-muted); margin-left: 8px; font-family: var(--font-mono); }

          .log-body {
            padding: 20px; max-height: 520px; overflow-y: auto;
            font-family: var(--font-mono); font-size: 12.5px; line-height: 1.9;
          }
          .log-body::-webkit-scrollbar { width: 5px; }
          .log-body::-webkit-scrollbar-track { background: transparent; }
          .log-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
          .log-body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }

          .log-entry { display: block; padding: 1px 0; white-space: pre-wrap; word-break: break-all; }
          .log-entry.error { color: var(--red); }
          .log-entry.warn { color: var(--amber); }
          .log-entry.success { color: var(--green); }
          .log-entry.control { color: var(--accent); }
          .log-entry.default { color: var(--text-secondary); }

          .empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); font-size: 13px; font-family: inherit; }
          .empty-state span { font-size: 32px; display: block; margin-bottom: 12px; opacity: 0.3; }

          .console-row {
            display: flex; align-items: center;
            border-top: 1px solid var(--border-subtle);
            background: var(--bg-deep); padding: 14px 20px; gap: 12px;
          }
          .console-prompt {
            font-family: var(--font-mono); font-size: 15px;
            color: var(--accent); font-weight: 800; flex-shrink: 0; user-select: none;
          }
          .console-input {
            flex: 1; background: transparent; border: none; outline: none;
            font-family: var(--font-mono); font-size: 13px;
            color: var(--text-primary); caret-color: var(--accent);
          }
          .console-input::placeholder { color: var(--text-muted); }
          .console-send {
            background: var(--accent-bg); border: 1px solid rgba(129,140,248,0.25);
            color: var(--accent); font-size: 12px; font-weight: 700;
            padding: 8px 18px; border-radius: var(--radius-sm); cursor: pointer;
            font-family: inherit; transition: all 0.25s; flex-shrink: 0;
          }
          .console-send:hover { background: rgba(129,140,248,0.12); box-shadow: 0 2px 16px var(--accent-glow); }
          .console-send:disabled { opacity: 0.3; cursor: default; }

          .console-wrap { position: relative; }
          .cmd-suggestions {
            display: none; position: absolute; bottom: calc(100% + 8px);
            left: 12px; right: 12px;
            background: var(--bg-card); border: 1px solid var(--border-accent);
            border-radius: var(--radius-sm); overflow: hidden;
            box-shadow: 0 12px 40px rgba(0,0,0,0.6); z-index: 10;
          }
          .cmd-suggestions.visible { display: block; animation: fadeIn 0.15s ease-out; }
          .cmd-item {
            display: flex; align-items: baseline; gap: 14px;
            padding: 10px 18px; cursor: pointer;
            transition: background 0.15s; border-bottom: 1px solid var(--border-subtle);
          }
          .cmd-item:last-child { border-bottom: none; }
          .cmd-item:hover, .cmd-item.active { background: var(--bg-elevated); }
          .cmd-name { font-family: var(--font-mono); font-size: 12.5px; font-weight: 700; color: var(--accent); flex-shrink: 0; min-width: 90px; }
          .cmd-desc { font-size: 12px; color: var(--text-muted); }

          .refresh-bar {
            display: flex; align-items: center; justify-content: space-between;
            margin-top: 16px; font-size: 12px; color: var(--text-muted); gap: 8px;
          }
          .refresh-indicator { display: flex; align-items: center; gap: 6px; }
          .refresh-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse-dot 2s infinite; }

          footer { margin-top: 40px; text-align: center; }
          footer p { font-size: 11px; color: var(--text-muted); opacity: 0.3; }
        </style>
      </head>
      <body>
        <main>
          <div class="top-bar">
            <a href="/" class="back-link">← Dashboard</a>
            <span class="badge">${logCount} ${logCount === 1 ? 'entry' : 'entries'}</span>
          </div>

          <div class="page-header">
            <h1>Live Logs</h1>
            <p>Real-time output from the AFK bot</p>
          </div>

          <div class="terminal">
            <div class="terminal-bar">
              <span class="term-dot term-dot-r"></span>
              <span class="term-dot term-dot-y"></span>
              <span class="term-dot term-dot-g"></span>
              <span class="term-title">bot.log</span>
            </div>
            <div class="log-body" id="log-body">
              ${logCount === 0
                ? '<div class="empty-state"><span>◇</span>No log entries yet.<br>Start the bot to see output.</div>'
                : logs.map(l => {
                    const escaped = escapeHTML(l);
                    const lower = escaped.toLowerCase();
                    let cls = 'default';
                    if (lower.includes('error') || lower.includes('kicked') || lower.includes('fail')) cls = 'error';
                    else if (lower.includes('warn') || lower.includes('throttl')) cls = 'warn';
                    else if (lower.includes('success') || lower.includes('spawned') || lower.includes('connected') || lower.includes('[+]')) cls = 'success';
                    else if (lower.includes('[console]') || lower.includes('[control]')) cls = 'control';
                    return '<span class="log-entry ' + cls + '">' + escaped + '</span>';
                  }).join('\n')
              }
            </div>
            <div class="console-wrap">
              <div id="cmd-suggestions" class="cmd-suggestions"></div>
              <div class="console-row">
                <span class="console-prompt">❯</span>
                <input id="console-input" class="console-input" placeholder="Type a command… ( /help for list )" autocomplete="off" spellcheck="false">
                <button id="console-send" class="console-send">Send</button>
              </div>
            </div>
          </div>

          <div class="refresh-bar">
            <div class="refresh-indicator">
              <span class="refresh-dot"></span>
              <span id="refresh-label">Auto-refreshing every 5s</span>
            </div>
          </div>

          <footer><p>FluxAFK &middot; ${config.name}</p></footer>
        </main>

        <script>
          (function() {
            var COMMANDS = [
              { name: '/help',   desc: 'Show available commands' },
              { name: '/pos',    desc: 'Show bot coordinates' },
              { name: '/status', desc: 'Show connection status' },
              { name: '/list',   desc: 'Ask server for player list' },
              { name: '/say',    desc: 'Send a chat message in-game' }
            ];

            var logBody   = document.getElementById('log-body');
            var input     = document.getElementById('console-input');
            var sendBtn   = document.getElementById('console-send');
            var sugBox    = document.getElementById('cmd-suggestions');
            var label     = document.getElementById('refresh-label');
            var refreshTimer, typing = false, activeIdx = -1;

            function scrollBottom() { if (logBody) logBody.scrollTop = logBody.scrollHeight; }
            function scheduleRefresh() {
              clearTimeout(refreshTimer);
              if (!typing) refreshTimer = setTimeout(function() { location.reload(); }, 5000);
            }
            function appendLocalEntry(text, cls) {
              var span = document.createElement('span');
              span.className = 'log-entry ' + (cls || 'control');
              span.textContent = text;
              logBody.appendChild(span);
              scrollBottom();
            }
            function hideSuggestions() { sugBox.classList.remove('visible'); sugBox.innerHTML = ''; activeIdx = -1; }
            function setActive(idx) {
              sugBox.querySelectorAll('.cmd-item').forEach(function(el, i) { el.classList.toggle('active', i === idx); });
              activeIdx = idx;
            }
            function showSuggestions(val) {
              var q = val.toLowerCase();
              var matches = COMMANDS.filter(function(c) { return c.name.startsWith(q); });
              if (!matches.length) { hideSuggestions(); return; }
              sugBox.innerHTML = matches.map(function(c) {
                return '<div class="cmd-item" data-cmd="' + c.name + '"><span class="cmd-name">' + c.name + '</span><span class="cmd-desc">' + c.desc + '</span></div>';
              }).join('');
              sugBox.querySelectorAll('.cmd-item').forEach(function(el) {
                el.addEventListener('mousedown', function(e) { e.preventDefault(); input.value = el.dataset.cmd + ' '; hideSuggestions(); input.focus(); });
              });
              activeIdx = -1;
              sugBox.classList.add('visible');
            }

            input.addEventListener('input', function() {
              if (input.value.startsWith('/')) showSuggestions(input.value); else hideSuggestions();
            });
            input.addEventListener('keydown', function(e) {
              var items = sugBox.querySelectorAll('.cmd-item');
              if (sugBox.classList.contains('visible') && items.length) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIdx + 1, items.length - 1)); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); return; }
                if (e.key === 'Tab' || (e.key === 'Enter' && activeIdx >= 0)) { e.preventDefault(); input.value = items[activeIdx >= 0 ? activeIdx : 0].dataset.cmd + ' '; hideSuggestions(); return; }
                if (e.key === 'Escape') { hideSuggestions(); return; }
              }
              if (e.key === 'Enter') sendCommand();
            });

            function sendCommand() {
              var cmd = input.value.trim();
              if (!cmd) return;
              hideSuggestions(); input.value = ''; sendBtn.disabled = true;
              appendLocalEntry('> ' + cmd, 'control');
              fetch('/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) })
                .then(function(r) { return r.json(); })
                .then(function(data) { if (data.msg) data.msg.split('\\n').forEach(function(l) { appendLocalEntry(l, data.success ? 'default' : 'error'); }); })
                .catch(function() { appendLocalEntry('Failed to send command.', 'error'); })
                .finally(function() { sendBtn.disabled = false; input.focus(); scheduleRefresh(); });
            }

            sendBtn.addEventListener('click', sendCommand);
            input.addEventListener('focus', function() { typing = true; clearTimeout(refreshTimer); label.textContent = 'Paused while typing'; });
            input.addEventListener('blur', function() { setTimeout(function() { hideSuggestions(); typing = false; label.textContent = 'Auto-refreshing every 5s'; scheduleRefresh(); }, 150); });

            scrollBottom();
            scheduleRefresh();
          })();
        </script>
      </body>
    </html>
  `);
});

let botRunning = true;

app.post("/start", (req, res) => {
  if (botRunning) return res.json({ success: false, msg: "Already running" });

  botRunning = true;
  createBot();
  addLog("[Control] Bot started");

  res.json({ success: true });
});

app.post("/stop", (req, res) => {
  if (!botRunning) return res.json({ success: false, msg: "Already stopped" });

  botRunning = false;
  stopAllBots();

  clearAllIntervals();
  addLog("[Control] Bot stopped");

  res.json({ success: true });
});

app.post("/command", express.json(), (req, res) => {
  const cmd = (req.body.command || "").trim();
  if (!cmd) return res.json({ success: false, msg: "Empty command." });

  addLog(`[Console] > ${cmd}`);

  const activeBots = bots.filter((bot) => bot && bot.isConnected && typeof bot.chat === "function");

  if (cmd === "/help") {
    const lines = [
      "Available commands:",
      "  /help          - Show this help message",
      "  /pos           - Show bot's current coordinates",
      "  /status        - Show bot connection status",
      "  /list          - Ask server for player list",
      "  /say <message> - Send a chat message in-game",
      "  /<anything>    - Send any Minecraft command directly",
      "  <text>         - Send plain chat (no slash needed)",
    ];
    lines.forEach((l) => addLog(`[Console] ${l}`));
    return res.json({ success: true, msg: lines.join("\n") });
  }

  if (cmd === "/pos" || cmd === "/coords") {
    const connectedBots = bots.filter((bot) => bot && bot.isConnected && bot.entity);
    if (!connectedBots.length) {
      const msg = "Position unavailable (bot not spawned).";
      addLog(`[Console] ${msg}`);
      return res.json({ success: false, msg });
    }

    const lines = connectedBots.map((bot) => {
      const pos = bot.entity.position;
      return `${bot.__slotLabel}: X=${Math.floor(pos.x)} Y=${Math.floor(pos.y)} Z=${Math.floor(pos.z)}`;
    });
    const msg = `Position:\n${lines.join("\n")}`;
    addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (cmd === "/status") {
    const connected = getConnectedBotCount();
    const total = getTotalBotCount();
    const uptime = Math.floor((Date.now() - botState.startTime) / 1000);
    const msg = `Status: ${connected}/${total} bots connected | Uptime: ${uptime}s | Reconnects: ${botState.reconnectAttempts}`;
    addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (!activeBots.length) {
    const msg = "Bot is not running or still connecting.";
    addLog(`[Console] ${msg}`);
    return res.json({ success: false, msg });
  }

  const results = activeBots.map((bot) => {
    try {
      bot.chat(cmd);
      return `${bot.__slotLabel}: Sent`;
    } catch (err) {
      return `${bot.__slotLabel}: ${err.message}`;
    }
  });

  const error = results.some((line) => line.includes("Error"));
  const message = results.join("\n");
  if (!error) addLog(`[Console] Sent to ${activeBots.length} bot(s): ${cmd}`);

  return res.json({ success: !error, msg: message });
});

// ============================================================
//                    END OF WEB TOOLS
//============================================================

// FIX: handle port conflict gracefully - try next port if taken
const server = app.listen(PORT, "0.0.0.0", () => {
  addLog(`[Server] HTTP server started on port ${server.address().port} `);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const fallbackPort = PORT + 1;
    addLog(`[Server] Port ${PORT} in use - trying port ${fallbackPort} `);
    server.listen(fallbackPort, "0.0.0.0");
  } else {
    addLog(`[Server] HTTP server error: ${err.message} `);
  }
});

// FIX: only one definition of formatUptime
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s} s`;
}

// ============================================================
// SELF-PING - Prevent Render from sleeping
// FIX: only ping if RENDER_EXTERNAL_URL is set (skip useless localhost ping)
// ============================================================
const SELF_PING_INTERVAL = 10 * 60 * 1000;

function startSelfPing() {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (!renderUrl) {
    addLog(
      "[KeepAlive] No RENDER_EXTERNAL_URL set - self-ping disabled (running locally)",
    );
    return;
  }
  setInterval(() => {
    const protocol = renderUrl.startsWith("https") ? https : http;
    protocol
      .get(`${renderUrl}/ping`, (res) => {
        // Silent success
      })
      .on("error", (err) => {
        addLog(`[KeepAlive] Self-ping failed: ${err.message}`);
      });
  }, SELF_PING_INTERVAL);
  addLog("[KeepAlive] Self-ping system started (every 10 min)");
}

startSelfPing();

// ============================================================
// MEMORY MONITORING
// ============================================================
setInterval(
  () => {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(2);
    addLog(`[Memory] Heap: ${heapMB} MB`);
  },
  5 * 60 * 1000,
);

// ============================================================
// BOT CREATION WITH RECONNECTION LOGIC
// ============================================================
// ============================================================
// RECONNECTION & TIMEOUT MANAGEMENT
// ============================================================
let bots = [];
let activeIntervals = [];
let reconnectTimeoutId = null;
let connectionTimeoutId = null;
let isReconnecting = false;

function getTotalBotCount() {
  return Math.max(1, Number(config.server.count) || 1);
}

function getConnectedBotCount() {
  return bots.filter((bot) => bot && bot.isConnected).length;
}

function getAnyBotCoords() {
  const activeBot = bots.find((bot) => bot && bot.isConnected && bot.entity);
  return activeBot ? activeBot.entity.position : null;
}

function stopAllBots() {
  bots.forEach((bot) => {
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (_) {
      /* ignore */
    }
  });
  bots = [];
  botState.connected = false;
}

function updateGlobalConnectionState() {
  botState.connected = getConnectedBotCount() > 0;
}

function clearBotTimeouts() {
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  if (connectionTimeoutId) {
    clearTimeout(connectionTimeoutId);
    connectionTimeoutId = null;
  }
}

// FIX: Discord rate limiting - track last send time
let lastDiscordSend = 0;
const DISCORD_RATE_LIMIT_MS = 5000; // min 5s between webhook calls

function clearAllIntervals() {
  addLog(`[Cleanup] Clearing ${activeIntervals.length} intervals`);
  activeIntervals.forEach((id) => clearInterval(id));
  activeIntervals = [];
}

function addInterval(callback, delay) {
  const id = setInterval(callback, delay);
  activeIntervals.push(id);
  return id;
}

function getReconnectDelay() {
  if (botState.wasThrottled) {
    botState.wasThrottled = false;
    const throttleDelay = 60000 + Math.floor(Math.random() * 60000);
    addLog(
      `[Bot] Throttle detected - using extended delay: ${throttleDelay / 1000}s`,
    );
    return throttleDelay;
  }

  // FIX: read auto-reconnect-delay from settings as base delay
  const baseDelay = config.utils["auto-reconnect-delay"] || 3000;
  const maxDelay = config.utils["max-reconnect-delay"] || 30000;
  const delay = Math.min(
    baseDelay * Math.pow(2, botState.reconnectAttempts),
    maxDelay,
  );
  const jitter = Math.floor(Math.random() * 2000);
  return delay + jitter;
}

function createBot() {
  if (isReconnecting) {
    addLog("[Bot] Already reconnecting, skipping...");
    return;
  }

  stopAllBots();
  clearAllIntervals();

  const totalBots = getTotalBotCount();
  const allowMultiBot =
    config["bot-account"].type === "offline" ||
    config["bot-account"].type === "noauth";
  const actualBotCount = totalBots > 1 && !allowMultiBot ? 1 : totalBots;

  if (totalBots > 1 && !allowMultiBot) {
    addLog(
      "[Bot] Multi-bot support requires offline auth or noauth. Starting one bot instead.",
    );
  }

  addLog(`[Bot] Creating ${actualBotCount} bot instance(s)...`);
  addLog(`[Bot] Connecting to ${config.server.ip}:${config.server.port}`);

  for (let slot = 1; slot <= actualBotCount; slot++) {
    createBotInstance(slot, actualBotCount);
  }
}

function createBotInstance(slot, totalBots) {
  // Cleanup previous instances before sliding into a new cluster.
  if (bots.some((bot) => bot && bot.__slot === slot && bot.isConnected)) {
    return;
  }

  const isMulti = totalBots > 1;
  const baseUsername = config["bot-account"].username;
  const username =
    isMulti && config["bot-account"].type === "offline"
      ? `${baseUsername}_${slot}`
      : baseUsername;

  const botVersion =
    config.server.version && config.server.version.trim() !== ""
      ? config.server.version
      : false;

  const bot = mineflayer.createBot({
    username: username,
    password: config["bot-account"].password || undefined,
    auth: config["bot-account"].type,
    host: config.server.ip,
    port: config.server.port,
    version: botVersion,
    hideErrors: false,
    checkTimeoutInterval: 600000,
  });

  bot.__slot = slot;
  bot.__slotLabel = isMulti ? `Bot ${slot}` : "Bot";
  bot.isConnected = false;
  bots.push(bot);

  bot.loadPlugin(pathfinder);

  clearBotTimeouts();
  connectionTimeoutId = setTimeout(() => {
    if (!botState.connected) {
      addLog("[Bot] Connection timeout - no spawn received");
      try {
        bot.removeAllListeners();
        bot.end();
      } catch (e) {
        /* ignore */
      }
      stopAllBots();
      scheduleReconnect();
    }
  }, 150000);

  let spawnHandled = false;

  bot.once("spawn", () => {
    if (spawnHandled) return;
    spawnHandled = true;

    clearBotTimeouts();
    bot.isConnected = true;
    updateGlobalConnectionState();
    botState.lastActivity = Date.now();
    botState.reconnectAttempts = 0;
    isReconnecting = false;

    addLog(
      `[${bot.__slotLabel}] [+] Successfully spawned on server! (Version: ${bot.version})`,
    );
    if (
      config.discord &&
      config.discord.events &&
      config.discord.events.connect
    ) {
      sendDiscordWebhook(
        `[+] **Connected** to \`${config.server.ip}\``,
        0x4ade80,
      );
    }

    const mcData = require("minecraft-data")(bot.version);
    const defaultMove = new Movements(bot, mcData);
    defaultMove.allowFreeMotion = false;
    defaultMove.canDig = false;
    defaultMove.liquidCost = 1000;
    defaultMove.fallDamageCost = 1000;

    initializeModules(bot, mcData, defaultMove);

    setTimeout(() => {
      if (bot && bot.isConnected && config.server["try-creative"]) {
        bot.chat("/gamemode creative");
        addLog("[INFO] Attempted to set creative mode (requires OP)");
      }
    }, 3000);

    bot.on("messagestr", (message) => {
      if (
        message.includes("commands.gamemode.success.self") ||
        message.includes("Set own game mode to Creative Mode")
      ) {
        addLog(`[${bot.__slotLabel}] [INFO] Bot is now in Creative Mode.`);
      }
    });
  });

  bot.on("kicked", (reason) => {
    const kickReason =
      typeof reason === "object" ? JSON.stringify(reason) : reason;
    addLog(`[${bot.__slotLabel}] Kicked: ${kickReason}`);
    bot.isConnected = false;
    updateGlobalConnectionState();
    botState.errors.push({
      type: "kicked",
      reason: kickReason,
      time: Date.now(),
    });

    const reasonStr = String(kickReason).toLowerCase();
    if (
      reasonStr.includes("throttl") ||
      reasonStr.includes("wait before reconnect") ||
      reasonStr.includes("too fast")
    ) {
      addLog(
        "[Bot] Throttle kick detected - will use extended reconnect delay",
      );
      botState.wasThrottled = true;
    }

    if (
      config.discord &&
      config.discord.events &&
      config.discord.events.disconnect
    ) {
      sendDiscordWebhook(`[!] **Kicked**: ${kickReason}`, 0xff0000);
    }
  });

  bot.on("end", (reason) => {
    addLog(`[${bot.__slotLabel}] Disconnected: ${reason || "Unknown reason"}`);
    bot.isConnected = false;
    updateGlobalConnectionState();
    spawnHandled = false;

    if (
      config.discord &&
      config.discord.events &&
      config.discord.events.disconnect
    ) {
      sendDiscordWebhook(
        `[-] **Disconnected**: ${reason || "Unknown"}`,
        0xf87171,
      );
    }

    if (getConnectedBotCount() === 0) {
      clearAllIntervals();
      scheduleReconnect();
    }
  });

  bot.on("error", (err) => {
    const msg = err.message || "";
    addLog(`[${bot.__slotLabel}] Error: ${msg}`);
    botState.errors.push({ type: "error", message: msg, time: Date.now() });
  });
}

function scheduleReconnect() {
  clearBotTimeouts();

  if (isReconnecting || getConnectedBotCount() > 0) {
    addLog(
      "[Bot] Reconnect skipped because a bot is already connected or reconnect is already scheduled.",
    );
    return;
  }

  isReconnecting = true;
  botState.reconnectAttempts++;

  const delay = getReconnectDelay();
  addLog(
    `[Bot] Reconnecting in ${delay / 1000}s (attempt #${botState.reconnectAttempts})`,
  );

  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    isReconnecting = false;
    createBot();
  }, delay);
}

// ============================================================
// MODULE INITIALIZATION
// ============================================================
function initializeModules(bot, mcData, defaultMove) {
  addLog("[Modules] Initializing all modules...");

  // ---------- AUTO AUTH (REACTIVE) ----------
  if (config.utils["auto-auth"] && config.utils["auto-auth"].enabled) {
    const password = config.utils["auto-auth"].password;
    let authHandled = false;

    const tryAuth = (type) => {
      if (authHandled || !bot || !bot.isConnected) return;
      authHandled = true;
      if (type === "register") {
        bot.chat(`/register ${password} ${password}`);
        addLog("[Auth] Detected register prompt - sent /register");
      } else {
        bot.chat(`/login ${password}`);
        addLog("[Auth] Detected login prompt - sent /login");
      }
    };

    bot.on("messagestr", (message) => {
      if (authHandled) return;
      const msg = message.toLowerCase();
      if (
        msg.includes("/register") ||
        msg.includes("register ") ||
        msg.includes("지정된 비밀번호")
      ) {
        tryAuth("register");
      } else if (
        msg.includes("/login") ||
        msg.includes("login ") ||
        msg.includes("로그인")
      ) {
        tryAuth("login");
      }
    });

    // Failsafe: if no prompt after 10s, try login anyway
    setTimeout(() => {
      if (!authHandled && bot && bot.isConnected) {
        addLog(
          "[Auth] No prompt detected after 10s, sending /login as failsafe",
        );
        bot.chat(`/login ${password}`);
        authHandled = true;
      }
    }, 10000);
  }

  // ---------- CHAT MESSAGES ----------
  if (config.utils["chat-messages"] && config.utils["chat-messages"].enabled) {
    const messages = config.utils["chat-messages"].messages;
    if (config.utils["chat-messages"].repeat) {
      let i = 0;
      addInterval(() => {
          if (bot && bot.isConnected) {
            bot.chat(messages[i]);
            botState.lastActivity = Date.now();
            i = (i + 1) % messages.length;
          }
        }, config.utils["chat-messages"]["repeat-delay"] * 1000);
      } else {
        messages.forEach((msg, idx) => {
          setTimeout(() => {
            if (bot && bot.isConnected) bot.chat(msg);
          }, idx * ((config.utils["chat-messages"]["repeat-delay"] || 5) * 1000));
        });
      }
  }

  // ---------- MOVE TO POSITION ----------
  // FIX: only use position goal if circle-walk is NOT enabled (they fight over pathfinder)
  if (
    config.position &&
    config.position.enabled &&
    !(
      config.movement &&
      config.movement["circle-walk"] &&
      config.movement["circle-walk"].enabled
    )
  ) {
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(
      new GoalBlock(config.position.x, config.position.y, config.position.z),
    );
    addLog("[Position] Navigating to configured position...");
  }

  // ---------- ANTI-AFK ----------
  if (config.utils["anti-afk"] && config.utils["anti-afk"].enabled) {
    // Arm swinging
    addInterval(
      () => {
        if (!bot || !bot.isConnected) return;
        try {
          bot.swingArm();
        } catch (e) {}
      },
      10000 + Math.floor(Math.random() * 50000),
    );

    // Hotbar cycling
    addInterval(
      () => {
        if (!bot || !bot.isConnected) return;
        try {
          const slot = Math.floor(Math.random() * 9);
          bot.setQuickBarSlot(slot);
        } catch (e) {}
      },
      30000 + Math.floor(Math.random() * 90000),
    );

    // Teabagging
    addInterval(
      () => {
        if (
          !bot ||
          !bot.isConnected ||
          typeof bot.setControlState !== "function"
        )
          return;
        if (Math.random() > 0.9) {
          let count = 2 + Math.floor(Math.random() * 4);
          const doTeabag = () => {
            if (count <= 0 || !bot || typeof bot.setControlState !== "function")
              return;
            try {
              bot.setControlState("sneak", true);
              setTimeout(() => {
                if (bot && typeof bot.setControlState === "function")
                  bot.setControlState("sneak", false);
                count--;
                setTimeout(doTeabag, 150);
              }, 150);
            } catch (e) {}
          };
          doTeabag();
        }
      },
      120000 + Math.floor(Math.random() * 180000),
    );

    // FIX: micro-walk only when circle-walk is NOT running, to avoid interrupting pathfinder
    if (
      !(
        config.movement &&
        config.movement["circle-walk"] &&
        config.movement["circle-walk"].enabled
      )
    ) {
      addInterval(
        () => {
          if (
            !bot ||
            !bot.isConnected ||
            typeof bot.setControlState !== "function"
          )
            return;
          try {
            const yaw = Math.random() * Math.PI * 2;
            bot.look(yaw, 0, true);
            bot.setControlState("forward", true);
            setTimeout(
              () => {
                if (bot && typeof bot.setControlState === "function")
                  bot.setControlState("forward", false);
              },
              500 + Math.floor(Math.random() * 1500),
            );
            botState.lastActivity = Date.now();
          } catch (e) {
            addLog("[AntiAFK] Walk error:", e.message);
          }
        },
        120000 + Math.floor(Math.random() * 360000),
      );
    }

    if (config.utils["anti-afk"].sneak) {
      try {
        if (typeof bot.setControlState === "function")
          bot.setControlState("sneak", true);
      } catch (e) {}
    }
  }

  // ---------- MOVEMENT MODULES ----------
  // FIX: check top-level movement.enabled flag
  if (config.movement && config.movement.enabled !== false) {
    // FIX: circle-walk and random-jump both jump - only run one jumping mechanism
    // random-jump is skipped if anti-afk jump is handled elsewhere; we only use random-jump here
    if (
      config.movement["circle-walk"] &&
      config.movement["circle-walk"].enabled
    ) {
      startCircleWalk(bot, defaultMove);
    }
    // FIX: only run random-jump if circle-walk is NOT running (circle-walk also keeps bot moving)
    if (
      config.movement["random-jump"] &&
      config.movement["random-jump"].enabled &&
      !(
        config.movement["circle-walk"] && config.movement["circle-walk"].enabled
      )
    ) {
      startRandomJump(bot);
    }
    if (
      config.movement["look-around"] &&
      config.movement["look-around"].enabled
    ) {
      startLookAround(bot);
    }
  }

  // ---------- CUSTOM MODULES ----------
  // FIX: avoidMobs AND combatModule conflict - if combat is enabled, don't run avoidMobs at the same time
  if (config.modules.avoidMobs && !config.modules.combat) {
    avoidMobs(bot);
  }
  if (config.modules.combat) {
    combatModule(bot, mcData);
  }
  if (config.modules.beds) {
    bedModule(bot, mcData);
  }
  if (config.modules.chat) {
    chatModule(bot);
  }

  addLog("[Modules] All modules initialized!");
}

// ============================================================
// MOVEMENT HELPERS
// ============================================================
function startCircleWalk(bot, defaultMove) {
  const radius = config.movement["circle-walk"].radius;
  let angle = 0;
  let lastPathTime = 0;

  addInterval(() => {
    if (!bot || !bot.isConnected) return;
    const now = Date.now();
    if (now - lastPathTime < 2000) return;
    lastPathTime = now;
    try {
      const x = bot.entity.position.x + Math.cos(angle) * radius;
      const z = bot.entity.position.z + Math.sin(angle) * radius;
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(
        new GoalBlock(
          Math.floor(x),
          Math.floor(bot.entity.position.y),
          Math.floor(z),
        ),
      );
      angle += Math.PI / 4;
      botState.lastActivity = Date.now();
    } catch (e) {
      addLog("[CircleWalk] Error:", e.message);
    }
  }, config.movement["circle-walk"].speed);
}

function startRandomJump(bot) {
  addInterval(() => {
    if (
      !bot ||
      !bot.isConnected ||
      typeof bot.setControlState !== "function"
    )
      return;
    try {
      bot.setControlState("jump", true);
      setTimeout(() => {
        if (bot && typeof bot.setControlState === "function")
          bot.setControlState("jump", false);
      }, 300);
      botState.lastActivity = Date.now();
    } catch (e) {
      addLog("[RandomJump] Error:", e.message);
    }
  }, config.movement["random-jump"].interval);
}

function startLookAround(bot) {
  addInterval(() => {
    if (!bot || !bot.isConnected) return;
    try {
      const yaw = Math.random() * Math.PI * 2 - Math.PI;
      const pitch = (Math.random() * Math.PI) / 2 - Math.PI / 4;
      bot.look(yaw, pitch, false);
      botState.lastActivity = Date.now();
    } catch (e) {
      addLog("[LookAround] Error:", e.message);
    }
  }, config.movement["look-around"].interval);
}

// ============================================================
// CUSTOM MODULES
// ============================================================

// Avoid mobs/players
// FIX: e.username only exists on players; use e.name for mobs - now handled properly
function avoidMobs(bot) {
  const safeDistance = 5;
  addInterval(() => {
    if (
      !bot ||
      !bot.isConnected ||
      typeof bot.setControlState !== "function"
    )
      return;
    try {
      const entities = Object.values(bot.entities).filter(
        (e) =>
          e.type === "mob" ||
          (e.type === "player" && e.username !== bot.username),
      );
      for (const e of entities) {
        if (!e.position) continue;
        const distance = bot.entity.position.distanceTo(e.position);
        if (distance < safeDistance) {
          bot.setControlState("back", true);
          setTimeout(() => {
            if (bot && typeof bot.setControlState === "function")
              bot.setControlState("back", false);
          }, 500);
          break;
        }
      }
    } catch (e) {
      addLog("[AvoidMobs] Error:", e.message);
    }
  }, 2000);
}

// Combat module
// FIX: attack cooldown for 1.9+ (600ms minimum between attacks)
// FIX: lock onto a target for multiple ticks instead of randomly switching every tick
// FIX: autoEat - use i.foodPoints directly (mineflayer item property) instead of broken mcData lookup
function combatModule(bot, mcData) {
  let lastAttackTime = 0;
  let lockedTarget = null;
  let lockedTargetExpiry = 0;

  // FIX: use physicsTick (not the deprecated physicTick)
  bot.on("physicsTick", () => {
    if (!bot || !bot.isConnected) return;
    if (!config.combat["attack-mobs"]) return;

    const now = Date.now();
    // FIX: 1.9+ attack cooldown - respect at least 600ms between swings
    if (now - lastAttackTime < 620) return;

    try {
      // FIX: only pick a new target if current one is gone or lock expired
      if (
        lockedTarget &&
        now < lockedTargetExpiry &&
        bot.entities[lockedTarget.id] &&
        lockedTarget.position
      ) {
        const dist = bot.entity.position.distanceTo(lockedTarget.position);
        if (dist < 4) {
          bot.attack(lockedTarget);
          lastAttackTime = now;
          return;
        } else {
          lockedTarget = null;
        }
      }

      // Pick a new target
      const mobs = Object.values(bot.entities).filter(
        (e) =>
          e.type === "mob" &&
          e.position &&
          bot.entity.position.distanceTo(e.position) < 4,
      );
      if (mobs.length > 0) {
        lockedTarget = mobs[0];
        lockedTargetExpiry = now + 3000; // stick to same mob for 3 seconds
        bot.attack(lockedTarget);
        lastAttackTime = now;
      }
    } catch (e) {
      addLog("[Combat] Error:", e.message);
    }
  });

  // FIX: autoEat - check foodPoints property on the item directly (works reliably)
  bot.on("health", () => {
    if (!config.combat["auto-eat"]) return;
    try {
      if (bot.food < 14) {
        const food = bot.inventory
          .items()
          .find((i) => i.foodPoints && i.foodPoints > 0);
        if (food) {
          bot
            .equip(food, "hand")
            .then(() => bot.consume())
            .catch((e) => addLog("[AutoEat] Error:", e.message));
        }
      }
    } catch (e) {
      addLog("[AutoEat] Error:", e.message);
    }
  });
}

// Bed module
// FIX: bot.isSleeping can be stale; use a local isTryingToSleep guard to prevent double-sleep errors
// FIX: place-night was false in default settings - documentation note added
function bedModule(bot, mcData) {
  let isTryingToSleep = false;

  addInterval(async () => {
    if (!bot || !bot.isConnected) return;
    if (!config.beds["place-night"]) return; // FIX: check flag (was always skipping before)

    try {
      const isNight =
        bot.time.timeOfDay >= 12500 && bot.time.timeOfDay <= 23500;

      // FIX: use local guard instead of stale bot.isSleeping
      if (isNight && !isTryingToSleep) {
        const bedBlock = bot.findBlock({
          matching: (block) => block.name.includes("bed"),
          maxDistance: 8,
        });

        if (bedBlock) {
          isTryingToSleep = true;
          try {
            await bot.sleep(bedBlock);
            addLog("[Bed] Sleeping...");
          } catch (e) {
            // Can't sleep - maybe not night enough or monsters nearby
          } finally {
            isTryingToSleep = false;
          }
        }
      }
    } catch (e) {
      isTryingToSleep = false;
      addLog("[Bed] Error:", e.message);
    }
  }, 10000);
}

// Chat module
// FIX: wire up discord.events.chat flag
function chatModule(bot) {
  bot.on("chat", (username, message) => {
    if (!bot || username === bot.username) return;

    try {
      // FIX: send chat events to Discord if enabled
      if (
        config.discord &&
        config.discord.enabled &&
        config.discord.events &&
        config.discord.events.chat
      ) {
        sendDiscordWebhook(`💬 **${username}**: ${message}`, 0x7289da);
      }

      if (config.chat && config.chat.respond) {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes("hello") || lowerMsg.includes("hi")) {
          bot.chat(`Hello, ${username}!`);
        }
        if (message.startsWith("!tp ")) {
          const target = message.split(" ")[1];
          if (target) bot.chat(`/tp ${target}`);
        }
      }
    } catch (e) {
      addLog("[Chat] Error:", e.message);
    }
  });
}

// ============================================================
// CONSOLE COMMANDS
// ============================================================
const readline = require("readline");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", (line) => {
  if (getConnectedBotCount() === 0) {
    addLog("[Console] Bot not connected");
    return;
  }

  const trimmed = line.trim();
  if (trimmed.startsWith("say ")) {
    bot.chat(trimmed.slice(4));
  } else if (trimmed.startsWith("cmd ")) {
    bot.chat("/" + trimmed.slice(4));
  } else if (trimmed === "status") {
    addLog(
      `Connected: ${getConnectedBotCount()}/${getTotalBotCount()}, Uptime: ${formatUptime(Math.floor((Date.now() - botState.startTime) / 1000))}`,
    );
  } else {
    bot.chat(trimmed);
  }
});

// ============================================================
// DISCORD WEBHOOK INTEGRATION
// FIX: use Buffer.byteLength for Content-Length (handles non-ASCII usernames correctly)
// FIX: rate limiting to avoid spam when bot is flapping
// ============================================================
function sendDiscordWebhook(content, color = 0x0099ff) {
  if (
    !config.discord ||
    !config.discord.enabled ||
    !config.discord.webhookUrl ||
    config.discord.webhookUrl.includes("YOUR_DISCORD")
  )
    return;

  // FIX: Discord rate limiting - skip if sent too recently
  const now = Date.now();
  if (now - lastDiscordSend < DISCORD_RATE_LIMIT_MS) {
    addLog("[Discord] Rate limited - skipping webhook");
    return;
  }
  lastDiscordSend = now;

  const protocol = config.discord.webhookUrl.startsWith("https") ? https : http;
  const urlParts = new URL(config.discord.webhookUrl);

  const payload = JSON.stringify({
    username: config.name,
    embeds: [
      {
        description: content,
        color: color,
        timestamp: new Date().toISOString(),
        footer: { text: "Slobos AFK Bot" },
      },
    ],
  });

  const options = {
    hostname: urlParts.hostname,
    port: 443,
    path: urlParts.pathname + urlParts.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // FIX: use Buffer.byteLength instead of payload.length - handles non-ASCII (e.g. usernames with accents/emoji)
      "Content-Length": Buffer.byteLength(payload, "utf8"),
    },
  };

  const req = protocol.request(options, (res) => {
    // Silent success
  });

  req.on("error", (e) => {
    addLog(`[Discord] Error sending webhook: ${e.message}`);
  });

  req.write(payload);
  req.end();
}

// ============================================================
// CRASH RECOVERY - IMMORTAL MODE
// FIX: guard against uncaughtException stacking reconnects when isReconnecting is already true
// ============================================================
process.on("uncaughtException", (err) => {
  const msg = err.message || "Unknown";
  addLog(`[FATAL] Uncaught Exception: ${msg}`);
  botState.errors.push({ type: "uncaught", message: msg, time: Date.now() });

  // Cap errors array to prevent memory leak over long uptimes
  if (botState.errors.length > 100) {
    botState.errors = botState.errors.slice(-50);
  }

  const isNetworkError =
    msg.includes("PartialReadError") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("timed out") ||
    msg.includes("write after end") ||
    msg.includes("This socket has been ended");

  if (isNetworkError) {
    addLog("[FATAL] Known network/protocol error - recovering gracefully...");
  }

  // ALWAYS recover — bot must never stay disconnected
  clearAllIntervals();
  botState.connected = false;

  // FIX: reset isReconnecting if it was stuck, then schedule reconnect
  if (isReconnecting) {
    addLog(
      "[FATAL] isReconnecting was stuck - resetting before crash recovery",
    );
    isReconnecting = false;
    // BUG FIX: was referencing non-existent 'reconnectTimeout' — correct name is 'reconnectTimeoutId'
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
  }

  setTimeout(
    () => {
      scheduleReconnect();
    },
    isNetworkError ? 5000 : 10000,
  );
});

process.on("unhandledRejection", (reason) => {
  const msg = String(reason);
  addLog(`[FATAL] Unhandled Rejection: ${reason}`);
  botState.errors.push({ type: "rejection", message: msg, time: Date.now() });
  if (botState.errors.length > 100) {
    botState.errors = botState.errors.slice(-50);
  }

  const isNetworkError =
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("timed out") ||
    msg.includes("PartialReadError");

  if (isNetworkError && !isReconnecting) {
    addLog("[FATAL] Network rejection — triggering reconnect...");
    clearAllIntervals();
    botState.connected = false;
    if (bot) {
      try { bot.end(); } catch (_) {}
      bot = null;
    }
    scheduleReconnect();
  }
});

process.on("SIGTERM", () => {
  addLog("[System] SIGTERM received — ignoring, bot will stay alive.");
});

process.on("SIGINT", () => {
  addLog("[System] SIGINT received — ignoring, bot will stay alive.");
});

// =============================
//===============================
// START THE BOT
// ============================================================
addLog("=".repeat(50));
addLog("  Minecraft AFK Bot v2.5 - Bug-Fixed Edition");
addLog("=".repeat(50));
addLog(`Server: ${config.server.ip}:${config.server.port}`);
addLog(`Version: ${config.server.version}`);
addLog(
  `Auto-Reconnect: ${config.utils["auto-reconnect"] ? "Enabled" : "Disabled"}`,
);
addLog("=".repeat(50));

createBot();
