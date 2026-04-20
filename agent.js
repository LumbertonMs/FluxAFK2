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

/** botId -> { bot, config, intervals[], reconnectAttempts, manualStop } */
const running = new Map();

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

function stopBot(botId, reason = "stopped") {
  const entry = running.get(botId);
  if (!entry) return;
  entry.manualStop = true;
  entry.intervals.forEach(clearInterval);
  try { entry.bot.quit(reason); } catch {}
  try { entry.bot.end(); } catch {}
  running.delete(botId);
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
  };
  if (config.minecraft_version) opts.version = config.minecraft_version;

  let bot;
  try {
    bot = mineflayer.createBot(opts);
  } catch (e) {
    heartbeat(config.id, "error", `Failed to start: ${e.message}`, null);
    return;
  }

  const entry = { bot, config, intervals: [], manualStop: false };
  running.set(config.id, entry);

  let uptimeStart = null;

  bot.on("login", () => {
    console.log(`[${config.name}] logged in`);
  });

  bot.on("spawn", () => {
    uptimeStart = new Date().toISOString();
    heartbeat(config.id, "online", "Connected", uptimeStart);

    // Run on_join commands + send messages once
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
    console.log(`[${config.name}] kicked:`, reason);
    heartbeat(config.id, "error", `Kicked: ${String(reason).slice(0, 200)}`, null);
  });

  bot.on("error", (err) => {
    console.log(`[${config.name}] error:`, err.message);
    heartbeat(config.id, "error", err.message, null);
  });

  bot.on("end", (reason) => {
    console.log(`[${config.name}] disconnected:`, reason);
    entry.intervals.forEach(clearInterval);
    running.delete(config.id);
    if (!entry.manualStop) {
      heartbeat(config.id, "offline", `Disconnected: ${reason}`, null);
    }
    // Auto-reconnect handled by next poll cycle when desired_state is still "running"
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

  // Start bots that should be running but aren't
  for (const b of bots) {
    if (!running.has(b.id)) {
      // Honor auto_reconnect: if last attempt errored and auto_reconnect is false, skip until user toggles
      if (!b.auto_reconnect && b.reported_status === "error") continue;
      startBot(b);
    }
  }
}

console.log(`AFKCraft agent starting. Polling ${API_BASE} every ${POLL_MS}ms`);
poll();
setInterval(poll, POLL_MS);
