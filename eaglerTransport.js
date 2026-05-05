/**
 * EaglerHost / Eaglercraft WebSocket transport for mineflayer.
 *
 * EaglerHost servers (e.g. wss://eaglerwars.eagler.host/) speak the standard
 * Minecraft protocol but framed inside binary WebSocket messages instead of
 * raw TCP. EaglerXBungee on the server side bridges that to a real Minecraft
 * proxy. By providing mineflayer with a custom `connect` callback that hands
 * it a Duplex stream wrapping a WebSocket, the rest of the bot pipeline
 * (login, chat, anti-AFK, /server transfers) just works.
 */

const { Duplex } = require("stream");
const WebSocket = require("ws");

/**
 * Normalize a user-provided EaglerHost URL into a proper ws/wss URL.
 *  - "eaglerwars.eagler.host" -> "wss://eaglerwars.eagler.host/"
 *  - "wss://foo/"             -> unchanged
 *  - "ws://localhost:8080"    -> "ws://localhost:8080/"
 */
function normalizeEaglerUrl(input) {
  if (!input) return null;
  let url = String(input).trim();
  if (!/^wss?:\/\//i.test(url)) url = "wss://" + url.replace(/^\/+/, "");
  if (!/\/$/.test(url) && !/\?/.test(url)) url += "/";
  return url;
}

/**
 * Wraps a WebSocket in a Duplex stream so mineflayer / minecraft-protocol
 * can read and write Minecraft packet bytes through it.
 */
function wsToDuplex(ws) {
  const duplex = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      if (ws.readyState !== WebSocket.OPEN) return cb(new Error("ws closed"));
      try {
        ws.send(chunk, { binary: true }, (err) => cb(err || null));
      } catch (e) {
        cb(e);
      }
    },
    final(cb) {
      try { ws.close(); } catch {}
      cb();
    },
  });

  ws.on("message", (data) => {
    const buf = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
      ? Buffer.concat(data.map((d) => (Buffer.isBuffer(d) ? d : Buffer.from(d))))
      : Buffer.from(data);
    duplex.push(buf);
  });

  ws.on("close", () => {
    duplex.push(null);
    duplex.emit("end");
  });

  ws.on("error", (err) => {
    duplex.destroy(err);
  });

  // mineflayer/minecraft-protocol calls .end() when quitting
  duplex.on("close", () => { try { ws.close(); } catch {} });

  return duplex;
}

/**
 * mineflayer connect-callback factory.
 * Pass the result as `connect` in createBot opts.
 */
function makeEaglerConnect(rawUrl) {
  const url = normalizeEaglerUrl(rawUrl);
  return function connect(client) {
    const ws = new WebSocket(url, {
      perMessageDeflate: false,
      handshakeTimeout: 20_000,
      headers: {
        // EaglerXBungee accepts standard browser-like origins; some configs
        // reject empty Origin headers.
        Origin: url.replace(/^ws/, "http").replace(/\/.*$/, ""),
        "User-Agent": "Mozilla/5.0 AFKCraft-Eagler",
      },
    });

    ws.on("open", () => {
      const stream = wsToDuplex(ws);
      // minecraft-protocol's Client has setSocket(stream) — feed our duplex in.
      try {
        client.setSocket(stream);
        client.emit("connect");
      } catch (e) {
        client.emit("error", e);
      }
    });

    ws.on("error", (err) => {
      try { client.emit("error", err); } catch {}
    });
  };
}

module.exports = { makeEaglerConnect, normalizeEaglerUrl };
