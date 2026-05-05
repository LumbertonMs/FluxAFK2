/**
 * AFKCraft Agent — runs on Render (or your own PC).
 * Polls the website API, manages all Mineflayer bots for every user,
 * and streams chat / system / error logs back for the live console.
 *
 * ENV (set in Render dashboard):
 *   API_BASE       e.g. https://your-project.lovable.app
 *   AGENT_TOKEN    same value you set in Lovable Cloud secrets
 *   POLL_MS        (optional) default 10000
 */

const mineflayer = require("mineflayer");
const { makeEaglerConnect, normalizeEaglerUrl } = require("./eaglerTransport");

const API_BASE = process.env.API_BASE;
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const POLL_MS = parseInt(process.env.POLL_MS || "10000", 10);

if (!API_BASE || !AGENT_TOKEN) {
  console.error("Missing API_BASE or AGENT_TOKEN env vars");
  process.exit(1);
}

const auth = { Authorization: `Bearer ${AGENT_TOKEN}` };

/**
 * botId -> {
 *   bot, config, intervals[], reconnectAttempts, manualStop,
 *   reconnectTimer, transferring, transferDeadline, uptimeStart,
 *   autoReplyCooldowns: Map<ruleId, lastFiredMs>,
 *   scheduleLastMinute: Map<scheduleId, "YYYY-MM-DDTHH:MM">,
 *   freeAdLastSentMs: number,
 * }
 */
const running = new Map();

// === Free-plan forced advertisement ===
// Sent every FREE_AD_INTERVAL_MS by bots whose owner is on the "free" plan.
// Cannot be disabled — upgrade to Pro to remove.
const FREE_AD_INTERVAL_MS = 5 * 60 * 1000;
const FREE_AD_MESSAGE = "I'm AFK with MinecraftAFK.lovable.app — free 24/7 Minecraft AFK bots!";

// === Tiny cron evaluator (5-field: m h dom mon dow, all UTC) ===
// Supports: *, */N, comma lists, ranges a-b, single numbers.
// dow: 0=Sun..6=Sat. Uses UTC to keep behavior predictable across hosts.
function parseCronField(field, min, max) {
  const result = new Set();
  for (const part of String(field).split(",")) {
    let step = 1;
    let range = part;
    if (part.includes("/")) {
      const [r, s] = part.split("/");
      range = r || "*";
      step = parseInt(s, 10) || 1;
    }
    let lo = min, hi = max;
    if (range !== "*") {
      if (range.includes("-")) {
        const [a, b] = range.split("-");
        lo = parseInt(a, 10);
        hi = parseInt(b, 10);
      } else {
        lo = hi = parseInt(range, 10);
      }
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    for (let v = lo; v <= hi; v += step) result.add(v);
  }
  return result;
}

function cronMatches(expr, date) {
  try {
    const parts = String(expr).trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const [mF, hF, domF, monF, dowF] = parts;
    const m = date.getUTCMinutes();
    const h = date.getUTCHours();
    const dom = date.getUTCDate();
    const mon = date.getUTCMonth() + 1;
    const dow = date.getUTCDay();
    return (
      parseCronField(mF, 0, 59).has(m) &&
      parseCronField(hF, 0, 23).has(h) &&
      parseCronField(domF, 1, 31).has(dom) &&
      parseCronField(monF, 1, 12).has(mon) &&
      parseCronField(dowF, 0, 6).has(dow)
    );
  } catch {
    return false;
  }
}

function minuteKey(date) {
  return date.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
}

// Phrases that hint a disconnect was a proxy transfer rather than a real kick.
// Conservative — we only use this OUTSIDE of an active transfer window.
const TRANSFER_HINTS = [
  "server", "transfer", "moved", "switching", "redirect",
  "reconnect", "socketclosed", "endofstream", "read econnreset",
  "connection closed", "connection reset", "unknownpacket",
  "unhandled packet", "invalid bundle",
];

function looksLikeTransfer(reason) {
  if (!reason) return false;
  const s = String(reason).toLowerCase();
  return TRANSFER_HINTS.some((h) => s.includes(h));
}

/**
 * Render a Mineflayer kick / chat reason (which is often a chat-component
 * object) into a readable string. Without this we end up writing
 * "Kicked: [object Object]" to the DB.
 */
function readableReason(reason) {
  if (reason == null) return "unknown";
  if (typeof reason === "string") return reason;
  try {
    if (typeof reason.toString === "function" && reason.toString !== Object.prototype.toString) {
      const s = reason.toString();
      if (s && s !== "[object Object]") return s;
    }
    if (typeof reason.text === "string" && reason.text) return reason.text;
    if (Array.isArray(reason.extra)) {
      const parts = reason.extra.map((p) => (typeof p === "string" ? p : (p && p.text) || "")).join("");
      if (parts) return parts;
    }
    if (typeof reason.translate === "string") return reason.translate;
    return JSON.stringify(reason).slice(0, 300);
  } catch {
    return String(reason);
  }
}

async function heartbeat(bot_id, status, status_message = null, uptime_started_at) {
  try {
    await fetch(`${API_BASE}/api/agent/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ bot_id, status, status_message, uptime_started_at }),
    });
  } catch (e) {
    console.error("heartbeat failed", bot_id, e.message);
  }
}

// Buffered log push so we don't spam the API on busy servers
const logQueue = [];
let logFlushTimer = null;

function pushLog(bot_id, level, message) {
  if (!bot_id || !message) return;
  // Strip Minecraft formatting codes (§a, §c, etc.) for cleaner output
  const clean = String(message).replace(/§[0-9a-fk-or]/gi, "").slice(0, 1000);
  if (!clean) return;
  logQueue.push({ bot_id, level, message: clean, at: new Date().toISOString() });
  if (!logFlushTimer) logFlushTimer = setTimeout(flushLogs, 750);
}

async function flushLogs() {
  logFlushTimer = null;
  if (!logQueue.length) return;
  const batch = logQueue.splice(0, logQueue.length);
  try {
    const res = await fetch(`${API_BASE}/api/agent/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ logs: batch }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`log push HTTP ${res.status}:`, txt.slice(0, 200));
    }
  } catch (e) {
    console.error("log push failed:", e.message);
  }
}

function clearEntryTimers(entry) {
  entry.intervals.forEach(clearInterval);
  entry.intervals = [];
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }
}

function stopBot(botId, reason = "stopped") {
  const entry = running.get(botId);
  if (!entry) return;
  entry.manualStop = true;
  clearEntryTimers(entry);
  pushLog(botId, "system", `Bot stopped: ${reason}`);
  try { entry.bot.quit(reason); } catch {}
  try { entry.bot.end(); } catch {}
  running.delete(botId);
}

function isTransferring(entry) {
  if (!entry) return false;
  if (!entry.transferDeadline) return false;
  return Date.now() < entry.transferDeadline;
}

function markTransfer(entry, windowMs = 60_000) {
  entry.transferring = true;
  entry.transferDeadline = Date.now() + windowMs;
}

function scheduleReconnect(botId, delayMs, reason) {
  const entry = running.get(botId);
  if (!entry || entry.manualStop) return;
  const cfg = entry.config;
  console.log(`[${cfg.name}] scheduling reconnect in ${delayMs}ms (${reason})`);
  pushLog(botId, "system", `Reconnecting in ${Math.round(delayMs / 1000)}s — ${reason}`);
  heartbeat(cfg.id, "connecting", `Reconnecting: ${reason}`, null);
  entry.reconnectTimer = setTimeout(() => {
    running.delete(botId);
    startBot(cfg);
  }, delayMs);
}

function startBot(config) {
  if (running.has(config.id)) return;

  const isEagler = config.server_type === "eagler";
  const eaglerUrl = isEagler ? normalizeEaglerUrl(config.server_url || config.server_ip) : null;
  const target = isEagler
    ? eaglerUrl
    : `${config.server_ip}:${config.server_port || 25565}`;

  console.log(`[${config.name}] connecting to ${target}`);
  pushLog(config.id, "system", `Connecting to ${target}…`);
  heartbeat(config.id, "connecting", "Spawning bot…", null);

  const opts = {
    username: config.bot_username || "AFKBot",
    auth: "offline",
    checkTimeoutInterval: 60_000,
    hideErrors: true,
    keepAlive: true,
  };
  if (isEagler) {
    // EaglerXBungee servers are 1.8.x — default to that unless user overrode it.
    opts.version = config.minecraft_version || "1.8.9";
    opts.host = "eagler";   // placeholder — connect callback handles real transport
    opts.port = 0;
    opts.connect = makeEaglerConnect(eaglerUrl);
  } else {
    opts.host = config.server_ip;
    opts.port = config.server_port || 25565;
    if (config.minecraft_version) opts.version = config.minecraft_version;
  }

  let bot;
  try {
    bot = mineflayer.createBot(opts);
  } catch (e) {
    pushLog(config.id, "error", `Failed to start: ${e.message}`);
    heartbeat(config.id, "error", `Failed to start: ${e.message}`, null);
    return;
  }

  const entry = {
    bot,
    config,
    intervals: [],
    manualStop: false,
    reconnectTimer: null,
    reconnectAttempts: 0,
    transferring: false,
    transferDeadline: 0,
    uptimeStart: null,
    autoReplyCooldowns: new Map(),
    scheduleLastMinute: new Map(),
    freeAdLastSentMs: 0,
  };
  running.set(config.id, entry);

  // Wrap bot.chat so we know when the user (or auto-command) issues a /server
  // and can mark the bot as "transferring" so we don't treat the resulting
  // disconnect as a real kick that should bounce us back to the lobby.
  const originalChat = bot.chat.bind(bot);
  bot.chat = (msg) => {
    try {
      if (typeof msg === "string") {
        const trimmed = msg.trim();
        // Match /server, /lobby, /hub, /play, /go — common proxy transfer commands
        if (/^\/(server|lobby|hub|play|go|join)(\s|$)/i.test(trimmed)) {
          markTransfer(entry, 60_000);
          pushLog(config.id, "system", `Transfer command sent: ${trimmed}`);
        }
        pushLog(config.id, "chat", `→ ${trimmed}`);
      }
    } catch {}
    return originalChat(msg);
  };

  bot.on("login", () => {
    console.log(`[${config.name}] logged in`);
    pushLog(config.id, "system", "Logged in");
  });

  bot.on("spawn", () => {
    const wasTransferring = isTransferring(entry);
    if (wasTransferring) {
      entry.transferring = false;
      entry.transferDeadline = 0;
      pushLog(config.id, "system", "Re-spawned after server transfer");
      // After a proxy transfer the same TCP connection is reused, so we skip
      // re-running on_join commands and message intervals (they are already set).
      heartbeat(config.id, "online", "Connected", entry.uptimeStart || new Date().toISOString());
      return;
    }

    pushLog(config.id, "system", "Spawned in world");
    entry.reconnectAttempts = 0;
    entry.uptimeStart = entry.uptimeStart || new Date().toISOString();
    heartbeat(config.id, "online", "Connected", entry.uptimeStart);

    setTimeout(() => {
      if (config.login_password) {
        try { bot.chat(`/login ${config.login_password}`); } catch {}
      }
      (config.commands || [])
        .filter((c) => c.trigger === "on_join")
        .forEach((c) => { try { bot.chat(c.command); } catch {} });

      (config.messages || []).forEach((m) => {
        try { bot.chat(m.content); } catch {}
        if (m.repeat && m.repeat_delay_seconds > 0) {
          const id = setInterval(() => {
            try { bot.chat(m.content); } catch {}
          }, m.repeat_delay_seconds * 1000);
          entry.intervals.push(id);
        }
      });

      (config.commands || [])
        .filter((c) => c.trigger === "interval" && c.interval_seconds > 0)
        .forEach((c) => {
          const id = setInterval(() => {
            try { bot.chat(c.command); } catch {}
          }, c.interval_seconds * 1000);
          entry.intervals.push(id);
        });

      // Anti-AFK loops
      if (config.anti_afk_enabled) {
        if (config.anti_afk_jump_seconds && config.anti_afk_jump_seconds > 0) {
          const id = setInterval(() => {
            try {
              bot.setControlState("jump", true);
              setTimeout(() => { try { bot.setControlState("jump", false); } catch {} }, 250);
            } catch {}
          }, Math.max(2, config.anti_afk_jump_seconds) * 1000);
          entry.intervals.push(id);
        }
        if (config.anti_afk_sneak) {
          let sneaking = false;
          const id = setInterval(() => {
            try {
              sneaking = !sneaking;
              bot.setControlState("sneak", sneaking);
            } catch {}
          }, 4000);
          entry.intervals.push(id);
        }
        if (config.anti_afk_look_around) {
          const id = setInterval(() => {
            try {
              const yaw = (Math.random() * Math.PI * 2) - Math.PI;
              const pitch = (Math.random() * 0.6) - 0.3;
              bot.look(yaw, pitch, false);
            } catch {}
          }, 8000);
          entry.intervals.push(id);
        }
        pushLog(config.id, "system", "Anti-AFK active");
      }

      // === 30s tick: cron schedules + forced free-plan ad ===
      const tickerId = setInterval(() => {
        const cur = running.get(config.id);
        if (!cur || !cur.bot) return;
        const cfg = cur.config;
        const now = new Date();

        // Cron-style scheduled commands (UTC)
        for (const sched of cfg.schedules || []) {
          if (!sched.enabled || !sched.cron_expression || !sched.command) continue;
          if (!cronMatches(sched.cron_expression, now)) continue;
          const key = minuteKey(now);
          if (cur.scheduleLastMinute.get(sched.id) === key) continue;
          cur.scheduleLastMinute.set(sched.id, key);
          try {
            bot.chat(sched.command);
            pushLog(config.id, "system", `Scheduled: ${sched.command}`);
          } catch {}
        }

        // Forced free-plan advertisement (every 5 minutes, cannot be disabled)
        if ((cfg.owner_plan || "free") === "free") {
          if (Date.now() - (cur.freeAdLastSentMs || 0) >= FREE_AD_INTERVAL_MS) {
            cur.freeAdLastSentMs = Date.now();
            try { bot.chat(FREE_AD_MESSAGE); } catch {}
          }
        }
      }, 30_000);
      entry.intervals.push(tickerId);

      // Send the free-plan ad shortly after spawn so it's visible right away.
      if ((config.owner_plan || "free") === "free") {
        setTimeout(() => {
          const cur = running.get(config.id);
          if (!cur || !cur.bot) return;
          cur.freeAdLastSentMs = Date.now();
          try { cur.bot.chat(FREE_AD_MESSAGE); } catch {}
        }, 15_000);
      }
    }, 2000);
  });

  bot.on("messagestr", (msg) => {
    pushLog(config.id, "chat", msg);
    const lower = msg.toLowerCase();
    const cfg = entry.config;

    // Legacy on_chat_match commands
    (cfg.commands || [])
      .filter((c) => c.trigger === "on_chat_match" && c.chat_match)
      .forEach((c) => {
        if (lower.includes(c.chat_match.toLowerCase())) {
          try { bot.chat(c.command); } catch {}
        }
      });

    // Auto-reply rules (with per-rule cooldown)
    const nowMs = Date.now();
    for (const rule of cfg.auto_replies || []) {
      if (!rule.enabled || !rule.pattern || !rule.reply) continue;
      if (!lower.includes(String(rule.pattern).toLowerCase())) continue;
      const last = entry.autoReplyCooldowns.get(rule.id) || 0;
      const cd = Math.max(1, rule.cooldown_seconds || 5) * 1000;
      if (nowMs - last < cd) continue;
      entry.autoReplyCooldowns.set(rule.id, nowMs);
      try { bot.chat(rule.reply); } catch {}
    }
  });

  bot.on("kicked", (reason) => {
    const reasonStr = readableReason(reason);
    console.log(`[${config.name}] kicked:`, reasonStr);

    // If we recently fired a /server (or similar) command, treat ANY kick
    // within the transfer window as part of the proxy transfer — many proxies
    // disconnect-and-reconnect under the hood. Mineflayer will then either
    // re-spawn (good) or fully end (handled below).
    if (isTransferring(entry)) {
      pushLog(config.id, "system", `Transfer in progress (${reasonStr.slice(0, 100)})`);
      heartbeat(config.id, "connecting", "Transferring server…", null);
      return;
    }

    pushLog(config.id, "warn", `Kicked: ${reasonStr.slice(0, 240)}`);

    if (looksLikeTransfer(reasonStr)) {
      markTransfer(entry, 30_000);
      heartbeat(config.id, "connecting", `Server transfer: ${reasonStr.slice(0, 120)}`, null);
    } else {
      heartbeat(config.id, "error", `Kicked: ${reasonStr.slice(0, 200)}`, null);
    }
  });

  bot.on("error", (err) => {
    const msg = err && err.message ? err.message : readableReason(err);
    console.log(`[${config.name}] error:`, msg);

    if (isTransferring(entry)) {
      pushLog(config.id, "system", `Transfer hiccup: ${msg.slice(0, 160)}`);
      heartbeat(config.id, "connecting", "Transferring server…", null);
      return;
    }

    pushLog(config.id, "error", msg);
    if (looksLikeTransfer(msg)) {
      heartbeat(config.id, "connecting", `Network blip: ${msg.slice(0, 160)}`, null);
    } else {
      heartbeat(config.id, "error", msg, null);
    }
  });

  bot.on("end", (reason) => {
    const reasonStr = readableReason(reason);
    console.log(`[${config.name}] disconnected:`, reasonStr);
    clearEntryTimers(entry);

    if (entry.manualStop) {
      pushLog(config.id, "system", `Disconnected: ${reasonStr}`);
      running.delete(config.id);
      return;
    }

    const wasTransferring = isTransferring(entry);
    const isTransfer = wasTransferring || looksLikeTransfer(reasonStr);

    if (wasTransferring) {
      // Proxy transfer fully closed the socket — reconnect quickly to the
      // SAME server IP. The proxy will route us to whichever sub-server we
      // were transferred to (some networks remember last-server).
      pushLog(config.id, "system", `Server transfer — reconnecting to proxy…`);
      // Keep uptimeStart so dashboard doesn't reset on transfer
      scheduleReconnect(config.id, 1500, "server transfer");
      return;
    }

    pushLog(config.id, "system", `Disconnected: ${reasonStr}`);

    if (!isTransfer) {
      entry.uptimeStart = null;
      heartbeat(config.id, "offline", `Disconnected: ${reasonStr}`, null);
    }

    if (config.auto_reconnect !== false) {
      entry.reconnectAttempts += 1;
      const base = isTransfer ? 1500 : 3000;
      const delay = Math.min(base * Math.max(1, entry.reconnectAttempts), 30_000);
      scheduleReconnect(config.id, delay, isTransfer ? "server transfer" : reasonStr.slice(0, 80));
    } else {
      running.delete(config.id);
    }
  });
}

async function poll() {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/agent/bots`, { headers: auth });
  } catch (e) {
    console.error("poll failed:", e.message);
    return;
  }
  if (!res.ok) {
    console.error("poll http", res.status, await res.text().catch(() => ""));
    return;
  }
  const { bots } = await res.json();
  const desiredIds = new Set(bots.map((b) => b.id));

  for (const id of running.keys()) {
    if (!desiredIds.has(id)) stopBot(id, "user requested stop");
  }

  for (const b of bots) {
    if (!running.has(b.id)) {
      if (!b.auto_reconnect && b.reported_status === "error") continue;
      startBot(b);
    } else {
      const entry = running.get(b.id);
      entry.config = b;
    }
    // Deliver any queued chat input from the website
    const pending = b.pending_chat || [];
    if (pending.length) {
      const entry = running.get(b.id);
      if (entry && entry.bot) {
        for (const line of pending) {
          try {
            entry.bot.chat(line);
          } catch (e) {
            pushLog(b.id, "error", `Failed to send chat: ${e.message}`);
          }
        }
      }
    }
  }
}

console.log(`AFKCraft agent starting. Polling ${API_BASE} every ${POLL_MS}ms`);
poll();
setInterval(poll, POLL_MS);
setInterval(flushLogs, 2000);
