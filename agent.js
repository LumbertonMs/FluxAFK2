/**
 * AFKCraft Agent — runs on Render (or your own PC).
 * Polls the website API, manages all Mineflayer bots for every user.
 *
 * ENV (set in Render dashboard):
 *   API_BASE       e.g. https://your-project.lovable.app
 *   AGENT_TOKEN    same value you set in Lovable Cloud secrets
 *   POLL_MS        (optional) default 10000
 */

const mineflayer = require("mineflayer");

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
 *   reconnectTimer, transferring, uptimeStart
 * }
 */
const running = new Map();

// Reasons that indicate the bot should immediately try to reconnect
// (proxy server switch, normal network blip), not give up.
const TRANSFER_HINTS = [
  "server", "transfer", "moved", "switching", "redirect",
  "reconnect", "socketclosed", "endofstream", "read econnreset",
  "spam", "rate limit", "too many messages", "flood", "kicked for",
];

function looksLikeTransfer(reason) {
  if (!reason) return false;
  const s = String(reason).toLowerCase();
  return TRANSFER_HINTS.some((h) => s.includes(h));
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
  try { entry.bot.quit(reason); } catch {}
  try { entry.bot.end(); } catch {}
  running.delete(botId);
}

function scheduleReconnect(botId, delayMs, reason) {
  const entry = running.get(botId);
  if (!entry || entry.manualStop) return;
  const cfg = entry.config;
  console.log(`[${cfg.name}] scheduling reconnect in ${delayMs}ms (${reason})`);
  heartbeat(cfg.id, "connecting", `Reconnecting: ${reason}`, null);
  entry.reconnectTimer = setTimeout(() => {
    // Drop the dead entry, then spin up fresh
    running.delete(botId);
    startBot(cfg);
  }, delayMs);
}

function startBot(config) {
  if (running.has(config.id)) return;

  console.log(`[${config.name}] connecting to ${config.server_ip}:${config.server_port}`);
  heartbeat(config.id, "connecting", "Spawning bot…", null);

  const opts = {
    host: config.server_ip,
    port: config.server_port || 25565,
    username: config.bot_username || "AFKBot",
    auth: "offline",
    // Be permissive about server type — covers BungeeCord/Velocity proxies
    // that send unusual chat/transfer packets when /server is used.
    checkTimeoutInterval: 60_000,
    hideErrors: true,
    keepAlive: true,
  };
  if (config.minecraft_version) opts.version = config.minecraft_version;

  let bot;
  try {
    bot = mineflayer.createBot(opts);
  } catch (e) {
    heartbeat(config.id, "error", `Failed to start: ${e.message}`, null);
    return;
  }

  if (!bot.chat) {
    console.log(`[${config.name}] bot.chat not available, aborting`);
    heartbeat(config.id, "error", "Bot chat method not available", null);
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
    uptimeStart: null,
  };
  running.set(config.id, entry);

  // Patch chat to detect outgoing /server commands so we can treat the
  // expected disconnect as a proxy transfer, not an error.
  const originalChat = bot.chat.bind(bot);
  bot.chat = (msg) => {
    try {
      if (typeof msg === "string" && /^\/server(\s|$)/i.test(msg.trim())) {
        entry.transferring = true;
        // Safety: clear the flag if the transfer never finishes
        setTimeout(() => { entry.transferring = false; }, 15_000);
      }
    } catch {}
    return originalChat(msg);
  };

  bot.on("login", () => {
    console.log(`[${config.name}] logged in`);
  });

  bot.on("spawn", () => {
    // A spawn after a transfer means we're on the new backend server.
    // Reset the transferring flag and refresh uptime.
    if (entry.transferring) {
      entry.transferring = false;
      console.log(`[${config.name}] re-spawned after /server transfer`);
    }
    entry.reconnectAttempts = 0;
    entry.uptimeStart = entry.uptimeStart || new Date().toISOString();
    heartbeat(config.id, "online", "Connected", entry.uptimeStart);

    // Run on_join + initial messages once per fresh connection
    setTimeout(() => {
      const messagesToSend = [];

      if (config.login_password) {
        messagesToSend.push(`/login ${config.login_password}`);
      }

      (config.commands || [])
        .filter((c) => c.trigger === "on_join")
        .forEach((c) => messagesToSend.push(c.command));

      (config.messages || []).forEach((m) => {
        messagesToSend.push(m.content);
        if (m.repeat && m.repeat_delay_seconds > 0) {
          const id = setInterval(() => {
            try { bot.chat(m.content); } catch {}
          }, m.repeat_delay_seconds * 1000);
          entry.intervals.push(id);
        }
      });

      // Send messages with delay to avoid spamming
      messagesToSend.forEach((msg, index) => {
        setTimeout(() => {
          try { bot.chat(msg); } catch {}
        }, index * 1000); // 1 second delay between each
      });

      // Interval commands
      (config.commands || [])
        .filter((c) => c.trigger === "interval" && c.interval_seconds > 0)
        .forEach((c) => {
          const id = setInterval(() => {
            try { bot.chat(c.command); } catch {}
          }, c.interval_seconds * 1000);
          entry.intervals.push(id);
        });
    }, 2000);
  });

  // Chat-match commands. mineflayer emits 'messagestr' with plain text.
  bot.on("messagestr", (msg) => {
    const lower = msg.toLowerCase();
    (config.commands || [])
      .filter((c) => c.trigger === "on_chat_match" && c.chat_match)
      .forEach((c) => {
        if (lower.includes(c.chat_match.toLowerCase())) {
          try { bot.chat(c.command); } catch {}
        }
      });
  });

  bot.on("kicked", (reason) => {
    const reasonStr = typeof reason === "string" ? reason : JSON.stringify(reason);
    console.log(`[${config.name}] kicked:`, reasonStr);

    // Proxy /server transfers sometimes surface as a kick with a transfer-y
    // reason. Don't mark as error in that case — let 'end' trigger reconnect.
    if (entry.transferring || looksLikeTransfer(reasonStr)) {
      heartbeat(config.id, "connecting", `Server transfer: ${reasonStr.slice(0, 120)}`, null);
    } else {
      heartbeat(config.id, "error", `Kicked: ${reasonStr.slice(0, 200)}`, null);
    }
  });

  bot.on("error", (err) => {
    const msg = err && err.message ? err.message : String(err);
    console.log(`[${config.name}] error:`, msg);
    // ECONNRESET / socket hangup are common during /server — keep status as
    // connecting so the UI doesn't flash red on every transfer.
    if (entry.transferring || looksLikeTransfer(msg)) {
      heartbeat(config.id, "connecting", `Network blip: ${msg.slice(0, 160)}`, null);
    } else {
      heartbeat(config.id, "error", msg, null);
    }
  });

  bot.on("end", (reason) => {
    const reasonStr = String(reason || "unknown");
    console.log(`[${config.name}] disconnected:`, reasonStr);
    clearEntryTimers(entry);

    if (entry.manualStop) {
      running.delete(config.id);
      return;
    }

    const isTransfer = entry.transferring || looksLikeTransfer(reasonStr);

    // Reset uptime on a real disconnect; preserve on quick proxy transfer
    if (!isTransfer) {
      entry.uptimeStart = null;
      heartbeat(config.id, "offline", `Disconnected: ${reasonStr}`, null);
    }

    if (config.auto_reconnect !== false) {
      // Fast reconnect for proxy transfers, exponential-ish for real failures
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

  // Stop bots no longer desired
  for (const id of running.keys()) {
    if (!desiredIds.has(id)) stopBot(id, "user requested stop");
  }

  // Start bots that should be running but aren't (and aren't already
  // mid-reconnect in our internal map)
  for (const b of bots) {
    if (!running.has(b.id)) {
      // Honor auto_reconnect: if last attempt errored and auto_reconnect is false, skip until user toggles
      if (!b.auto_reconnect && b.reported_status === "error") continue;
      startBot(b);
    } else {
      // Update the live config so messages/commands/auto_reconnect changes
      // take effect on next reconnect without a manual restart.
      const entry = running.get(b.id);
      entry.config = b;
    }
  }
}

console.log(`AFKCraft agent starting. Polling ${API_BASE} every ${POLL_MS}ms`);
poll();
setInterval(poll, POLL_MS);
