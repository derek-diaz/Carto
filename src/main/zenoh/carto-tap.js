"use strict";

const { randomBytes } = require("crypto");
const { createInterface } = require("readline");

const rl = createInterface({ input: process.stdin });

const subscriptions = new Map();
let connected = false;

// Mock generator to keep the UI usable without native Zenoh bindings.
const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const buildCapabilities = () => ({
  driver: "carto-tap-mock",
  features: ["subscribe", "recent-keys", "pause", "publish"],
  info: {
    note: "Mock generator. Replace with real Zenoh logic in carto-tap."
  }
});

const sendStatus = (error) => {
  send({
    type: "status",
    payload: {
      connected,
      error: error ? error : undefined,
      capabilities: buildCapabilities()
    }
  });
};

const startSubscription = (subscriptionId, keyexpr) => {
  const entry = {
    keyexpr,
    paused: false,
    count: 0,
    timer: setInterval(() => {
      const current = subscriptions.get(subscriptionId);
      if (!current || current.paused) return;
      const payload = generatePayload(current.count);
      const key = current.keyexpr;
      send({
        type: "message",
        payload: {
          subscriptionId,
          key,
          payloadBase64: Buffer.from(payload).toString("base64"),
          ts: Date.now()
        }
      });
      current.count += 1;
    }, 400)
  };

  subscriptions.set(subscriptionId, entry);
};

const stopSubscription = (subscriptionId) => {
  const entry = subscriptions.get(subscriptionId);
  if (!entry) return;
  clearInterval(entry.timer);
  subscriptions.delete(subscriptionId);
};

const generatePayload = (count) => {
  const roll = Math.random();
  if (roll < 0.4) {
    const data = {
      seq: count,
      tag: "mock",
      at: new Date().toISOString(),
      value: Math.round(Math.random() * 1000)
    };
    return Buffer.from(JSON.stringify(data));
  }
  if (roll < 0.7) {
    return Buffer.from(`mock-${count}-payload`);
  }
  return randomBytes(16);
};

const matchesKeyexpr = (pattern, key) => {
  if (pattern === "*" || pattern === "**") return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexPattern = escaped.replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, "[^/]*");
  try {
    return new RegExp(`^${regexPattern}$`).test(key);
  } catch {
    return false;
  }
};

const publishToSubscribers = (key, payloadBase64) => {
  for (const [subscriptionId, entry] of subscriptions.entries()) {
    if (entry.paused) continue;
    if (!matchesKeyexpr(entry.keyexpr, key)) continue;
    send({
      type: "message",
      payload: {
        subscriptionId,
        key,
        payloadBase64,
        ts: Date.now()
      }
    });
  }
};

rl.on("line", (line) => {
  if (!line.trim()) return;
  let data;
  try {
    data = JSON.parse(line);
  } catch (error) {
    send({
      id: "unknown",
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    });
    return;
  }

  const id = data.id ? data.id : "unknown";
  const type = data.type;
  if (!type) {
    send({ id, ok: false, error: "Missing type" });
    return;
  }

  switch (type) {
    case "connect":
      connected = true;
      send({ id, ok: true, payload: buildCapabilities() });
      sendStatus();
      break;
    case "disconnect":
      connected = false;
      for (const key of subscriptions.keys()) {
        stopSubscription(key);
      }
      send({ id, ok: true, payload: null });
      sendStatus();
      break;
    case "subscribe": {
      const subscriptionId = String(data.payload && data.payload.subscriptionId ? data.payload.subscriptionId : "");
      const keyexpr = String(data.payload && data.payload.keyexpr ? data.payload.keyexpr : "");
      if (!subscriptionId || !keyexpr) {
        send({ id, ok: false, error: "Missing subscriptionId or keyexpr" });
        break;
      }
      startSubscription(subscriptionId, keyexpr);
      send({ id, ok: true, payload: null });
      break;
    }
    case "unsubscribe": {
      const subscriptionId = String(data.payload && data.payload.subscriptionId ? data.payload.subscriptionId : "");
      stopSubscription(subscriptionId);
      send({ id, ok: true, payload: null });
      break;
    }
    case "pause": {
      const subscriptionId = String(data.payload && data.payload.subscriptionId ? data.payload.subscriptionId : "");
      const paused = Boolean(data.payload && data.payload.paused);
      const entry = subscriptions.get(subscriptionId);
      if (entry) {
        entry.paused = paused;
      }
      send({ id, ok: true, payload: null });
      break;
    }
    case "publish": {
      const keyexpr = String(data.payload && data.payload.keyexpr ? data.payload.keyexpr : "");
      const payloadBase64 = String(data.payload && data.payload.payloadBase64 ? data.payload.payloadBase64 : "");
      if (!keyexpr) {
        send({ id, ok: false, error: "Missing keyexpr" });
        break;
      }
      publishToSubscribers(keyexpr, payloadBase64);
      send({ id, ok: true, payload: null });
      break;
    }
    default:
      send({ id, ok: false, error: `Unknown command: ${type}` });
      break;
  }
});

sendStatus();
