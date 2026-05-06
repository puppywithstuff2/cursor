var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var index_default = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: cors() });
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "room" && parts[1]) {
        const roomName = parts[1];
        const id = env.CHAT_ROOM.idFromName(roomName);
        const stub = env.CHAT_ROOM.get(id);
        return await stub.fetch(request);
      }
      return new Response("Chat worker online", { headers: cors() });
    } catch (err) {
      return new Response("Worker error: " + err.toString(), { status: 500, headers: cors() });
    }
  }
};

var ChatRoom = class {
  static { __name(this, "ChatRoom"); }

  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async _hmacSha256Base64(secret, msg) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
    return bufToB64(sig);
  }

  async _verifyProof(proofHeader, expectedRoom) {
    if (!proofHeader) return { ok: false, status: 401, reason: "missing-proof" };
    let raw;
    try { raw = atob(proofHeader); } catch (e) {
      return { ok: false, status: 401, reason: "invalid-proof-format" };
    }
    const parts = raw.split(":");
    if (parts.length < 4) return { ok: false, status: 401, reason: "invalid-proof-parts" };
    const signatureB64 = parts.pop();
    const expiryStr = parts.pop();
    const room = parts.pop();
    const username = parts.join(":");
    const expiry = Number(expiryStr);
    if (!username || !room || !expiry || !signatureB64)
      return { ok: false, status: 401, reason: "invalid-proof-values" };
    if (expectedRoom && room !== expectedRoom)
      return { ok: false, status: 403, reason: "room-mismatch" };
    if (Date.now() > expiry)
      return { ok: false, status: 401, reason: "expired" };
    const payload = `${username}:${room}:${expiry}`;
    try {
      const expectedSigB64 = await this._hmacSha256Base64(this.env.SECRET_KEY, payload);
      if (!this._constTimeEq(expectedSigB64, signatureB64))
        return { ok: false, status: 403, reason: "bad-signature" };
      return { ok: true, username, room, expiry };
    } catch (e) {
      return { ok: false, status: 500, reason: "hmac-failure" };
    }
  }

  _constTimeEq(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let res = 0;
    for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return res === 0;
  }

  _broadcast(roomName, data, excludeWs = null) {
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    for (const ws of this.state.getWebSockets(roomName)) {
      if (ws === excludeWs) continue;
      try { ws.send(msg); } catch (e) {}
    }
  }

  _sendToUser(roomName, targetUsername, data, excludeWs = null) {
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    for (const ws of this.state.getWebSockets(roomName)) {
      if (ws === excludeWs) continue;
      const att = ws.deserializeAttachment();
      if (att && att.username === targetUsername) {
        try { ws.send(msg); } catch (e) {}
      }
    }
  }

  _broadcastPresence(roomName) {
    const users = Array.from(new Set(
      this.state.getWebSockets(roomName)
        .map(ws => { const a = ws.deserializeAttachment(); return a && a.username; })
        .filter(Boolean)
    ));
    this._broadcast(roomName, { type: "presence", users, room: roomName });
  }

  _trimMessages(messages) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return messages.filter(m => Number(m.time || m.ts || m.timestamp || 0) > cutoff);
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

      const adminKeyHdr = request.headers.get("x-admin-key");
      const isAdmin = adminKeyHdr && adminKeyHdr === this.env.ADMIN_KEY;

      const parts = url.pathname.split("/").filter(Boolean);
      const roomName = (parts[0] === "room" && parts[1]) ? parts[1] : null;

      if (request.headers.get("Upgrade") === "websocket") {
        if (!roomName) return new Response("Room required", { status: 400 });

        let wsUsername = "anonymous";
        if (!isAdmin) {
          const proofHeader = request.headers.get("X-Room-Auth") || request.headers.get("x-room-auth");
          const proofParam = url.searchParams.get("proof");
          const proof = proofHeader || proofParam;
          const proofRes = await this._verifyProof(proof, roomName);
          if (!proofRes.ok) return new Response("Unauthorized: " + proofRes.reason, { status: proofRes.status || 403 });
          wsUsername = proofRes.username;
        } else {
          wsUsername = "admin";
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.serializeAttachment({ username: wsUsername, room: roomName });
        this.state.acceptWebSocket(server, [roomName]);
        this._broadcastPresence(roomName);

        return new Response(null, { status: 101, webSocket: client });
      }

      const isRead = url.pathname.endsWith("/messages");
      const isWrite = url.pathname.endsWith("/send");
      if (isRead || isWrite) {
        if (!isAdmin) {
          const proofHeader = request.headers.get("X-Room-Auth") || request.headers.get("x-room-auth");
          const proofRes = await this._verifyProof(proofHeader, roomName);
          if (!proofRes.ok) return json({ error: "Not authorized: " + (proofRes.reason || "forbidden") }, proofRes.status || 403);
          request.__proof = proofRes;
        } else {
          request.__proof = { ok: true, username: "admin", room: roomName, expiry: Infinity };
        }
      }

      if (url.pathname.endsWith("/messages")) {
        let messages = await this.state.storage.get("messages") || [];
        messages = this._trimMessages(messages);
        await this.state.storage.put("messages", messages);
        return json({ messages });
      }

      if (url.pathname.endsWith("/send")) {
        const body = await request.json().catch(() => null);
        if (!body || !body.text) return json({ error: "Missing text" }, 400);
        const writer = (request.__proof && request.__proof.username) ? request.__proof.username : "anonymous";
        let messages = await this.state.storage.get("messages") || [];
        const now = Date.now();
        messages.push({ username: writer, text: body.text, time: now });
        messages = this._trimMessages(messages);
        await this.state.storage.put("messages", messages);
        this._broadcast(roomName, { type: "chat", username: writer, text: body.text, time: now, room: roomName });
        this._notifyActivity(roomName, now);
        return json({ success: true });
      }

      return json({ error: "Unknown endpoint" }, 404);
    } catch (err) {
      return new Response("DO error: " + err.toString(), { status: 500, headers: cors() });
    }
  }

  async webSocketMessage(ws, message) {
    try {
      const att = ws.deserializeAttachment();
      if (!att) return;
      const { username, room } = att;

      let msg;
      try { msg = JSON.parse(message); } catch (e) { return; }

      // 1:1 signaling only
      if (msg.type && msg.type.startsWith("call-")) {
        const target = msg.to ? String(msg.to) : null;
        if (!target) return;
        msg._from = username;
        msg.room = room;
        this._sendToUser(room, target, msg, ws);
        return;
      }

      if (msg.type === "chat" && msg.text) {
        let messages = await this.state.storage.get("messages") || [];
        const now = Date.now();
        messages.push({ username, text: msg.text, time: now });
        messages = this._trimMessages(messages);
        await this.state.storage.put("messages", messages);
        this._broadcast(room, { type: "chat", username, text: msg.text, time: now, room });
        this._notifyActivity(room, now);
      }
    } catch (e) {
      console.error("webSocketMessage error:", e);
    }
  }

  async webSocketClose(ws, code, reason) {
    try {
      const att = ws.deserializeAttachment();
      if (!att || !att.room) return;
      this._broadcastPresence(att.room);
    } catch (e) {}
  }

  webSocketError(ws, error) {
    try {
      const att = ws.deserializeAttachment();
      if (att && att.room) this._broadcastPresence(att.room);
    } catch (e) {}
  }

  _notifyActivity(roomName, now) {
    (async () => {
      try {
        const accountBase = this.env.ACCOUNT_BASE || "https://account-worker.anonymousguy.workers.dev";
        const internalKey = this.env.INTERNAL_KEY || "";
        if (!internalKey) return;
        await fetch(`${accountBase}/room-activity`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-key": internalKey },
          body: JSON.stringify({ room: roomName, last_activity: now, increment: 1 })
        }).catch(() => {});
      } catch (e) {}
    })();
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };
}
__name(cors, "cors");

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors(), "Content-Type": "application/json" }
  });
}
__name(json, "json");

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
__name(bufToB64, "bufToB64");

export { ChatRoom, index_default as default };
