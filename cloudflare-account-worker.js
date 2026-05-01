var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    // GET → only allowed for certain endpoints
    if (request.method === "GET") {
      if (path === "/pending") {
        return handlePending(env);
      }
      if (path === "/user/imgbb-key") {
        return handleGetImgBBKey(request, env);
      }
      if (path === "/user/room-passwords") {
        return handleGetRoomPasswords(request, env);
      }
      if (path === "/claimed-chats") {
        return handleGetClaimedChats(request, env);
      }
      // NEW: Explore endpoint
      if (path === "/explore" || url.pathname === "/explore") {
        return handleGetExplore(request, env);
      }
      return new Response("Use POST/GET for this endpoint", { status: 405 });
    }

    // DELETE → support deleting stored key or room password
    if (request.method === "DELETE") {
      if (path === "/user/imgbb-key") {
        return handleDeleteImgBBKey(request, env);
      }
      if (path === "/user/room-passwords") {
        return handleDeleteRoomPassword(request, env);
      }
      return new Response("Use POST/GET/DELETE", { status: 405 });
    }

    // All other endpoints use POST
    if (request.method !== "POST") {
      return new Response("Use POST/GET/DELETE/OPTIONS", { status: 405 });
    }

    // parse JSON body safely for POST handlers that need it
    let data = null;
    try {
      data = await request.json().catch(()=>null);
    } catch (e) {
      data = null;
    }

    // login / create require username + password
    if (path === "/login" || path === "/create") {
      const { username, password } = data || {};
      if (!username || !password) {
        return json({ success: false, error: "missing fields" });
      }
      if (path === "/login") return handleLogin(env, username, password);
      if (path === "/create") return handleCreate(env, username, password);
    }

    // approve requires username + admin key
    if (path === "/approve") {
      return handleApprove(env, data.username, request.headers.get("x-admin-key"));
    }

    // imgbb key endpoints
    if (path === "/user/imgbb-key") {
      return handlePostImgBBKey(request, env, data);
    }

    // per-user room-passwords (POST = save/update)
    if (path === "/user/room-passwords") {
      return handlePostRoomPassword(request, env, data);
    }

    // claim/unclaim/update claimed chats
    if (path === "/user/claim-chat") {
      return handleClaimChat(request, env, data);
    }
    if (path === "/user/unclaim-chat") {
      return handleUnclaimChat(request, env, data);
    }
    if (path === "/user/update-claim-password") {
      return handleUpdateClaimPassword(request, env, data);
    }

    // POST /user/room-proof -> mint short-lived proof for DO
    if (path === "/user/room-proof") {
      return handlePostRoomProof(request, env, data);
    }

    // NEW: POST /room-activity (internal from DO) — record activity
    if (path === "/room-activity") {
      return handlePostRoomActivity(request, env, data);
    }

    return json({ error: "Unknown endpoint" }, 404);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(json, "json");

// --- helpers (password hashing + token creation) ---
async function hashPassword(password) {
  const encoded = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = [...new Uint8Array(hashBuffer)];
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashPassword, "hashPassword");

async function makeToken(env, username) {
  const expiry = Date.now() + 7 * 24 * 60 * 60 * 1e3;
  const payload = `${username}:${expiry}`;
  const sig = await hmacSha256B64(env.SECRET_KEY, payload);
  return btoa(`${payload}:${sig}`);
}
__name(makeToken, "makeToken");

async function handleLogin(env, username, password) {
  const user = await env.dolesecurity.prepare(
    "SELECT username, password_hash FROM users WHERE username = ?"
  ).bind(username).first();
  
  if (!user) return json({ success: false, error: "User not found" });

  const hashed = await hashPassword(password);
  if (hashed !== user.password_hash)
    return json({ success: false, error: "Incorrect password" });

  const token = await makeToken(env, username);
  return json({ success: true, token });
}
__name(handleLogin, "handleLogin");

async function handleCreate(env, username, password) {
  const exists = await env.dolesecurity.prepare(
    "SELECT username FROM users WHERE username = ?"
  ).bind(username).first();
  
  if (exists) return json({ success: false, error: "Username already taken" });

  const pending = await env.dolesecurity.prepare(
    "SELECT username FROM pending_users WHERE username = ?"
  ).bind(username).first();
  
  if (pending) return json({ success: false, error: "Request already pending" });

  const hashed = await hashPassword(password);

  await env.dolesecurity.prepare(
    "INSERT INTO pending_users (username, password_hash) VALUES (?, ?)"
  ).bind(username, hashed).run();

  return json({ success: true });
}
__name(handleCreate, "handleCreate");

async function handlePending(env) {
  const result = await env.dolesecurity.prepare(
    "SELECT username FROM pending_users"
  ).all();

  const users = result.results.map(r => r.username);

  return json({ success: true, users });
}
__name(handlePending, "handlePending");

async function handleApprove(env, username, adminKey) {
  if (!username) return json({ success: false, error: "Missing username" });

  if (adminKey !== env.ADMIN_KEY) {
    return json({ success: false, error: "Invalid admin key" });
  }

  // Fetch pending user’s password hash
  const pending = await env.dolesecurity.prepare(
    "SELECT username, password_hash FROM pending_users WHERE username = ?"
  ).bind(username).first();

  if (!pending) {
    return json({ success: false, error: "User not in pending list" });
  }

  // Move to approved users table
  await env.dolesecurity.prepare(
    "INSERT INTO users (username, password_hash) VALUES (?, ?)"
  ).bind(username, pending.password_hash).run();

  // Remove from pending list
  await env.dolesecurity.prepare(
    "DELETE FROM pending_users WHERE username = ?"
  ).bind(username).run();

  return json({ success: true });
}
__name(handleApprove, "handleApprove");

// ----------------- New: token verification helper -----------------
async function verifyTokenAndGetUsername(env, token) {
  if (!token) return null;
  try {
    const decoded = atob(token);
    const parts = decoded.split(":");
    if (parts.length < 3) return null;
    const username = parts[0];
    const expiry = Number(parts[1]);
    const sig = parts.slice(2).join(":");
    if (!username || !expiry || !sig) return null;
    if (Date.now() > expiry) return null;
    const expectedSig = await hmacSha256B64(env.SECRET_KEY, `${username}:${expiry}`);
    if (expectedSig !== sig) return null;
    return username;
  } catch (e) {
    return null;
  }
}
__name(verifyTokenAndGetUsername, "verifyTokenAndGetUsername");

// ----------------- New: encryption helpers (AES-GCM via PBKDF2) -----------------
// Note: requires env.SECRET_KEY to be set.
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
__name(bufToB64, "bufToB64");

function b64ToBuf(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
__name(b64ToBuf, "b64ToBuf");

async function deriveAesKeyFromSecret(secret, saltBuffer) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBuffer, iterations: 100000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  return key;
}
__name(deriveAesKeyFromSecret, "deriveAesKeyFromSecret");

async function encryptTextWithSecret(env, plaintext) {
  if (!env.SECRET_KEY) throw new Error("Server SECRET_KEY not configured");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKeyFromSecret(env.SECRET_KEY, salt.buffer);
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer }, key, enc.encode(plaintext));
  return JSON.stringify({
    salt: bufToB64(salt.buffer),
    iv: bufToB64(iv.buffer),
    ct: bufToB64(ct)
  });
}
__name(encryptTextWithSecret, "encryptTextWithSecret");

async function decryptTextWithSecret(env, blobStr) {
  if (!env.SECRET_KEY) throw new Error("Server SECRET_KEY not configured");
  if (!blobStr) return null;
  let obj;
  try { obj = JSON.parse(blobStr); } catch (e) { return null; }
  if (!obj || !obj.salt || !obj.iv || !obj.ct) return null;
  const saltBuf = b64ToBuf(obj.salt);
  const ivBuf = b64ToBuf(obj.iv);
  const ctBuf = b64ToBuf(obj.ct);
  const key = await deriveAesKeyFromSecret(env.SECRET_KEY, saltBuf);
  try {
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuf }, key, ctBuf);
    const decStr = new TextDecoder().decode(dec);
    return decStr;
  } catch (e) {
    return null;
  }
}
__name(decryptTextWithSecret, "decryptTextWithSecret");

// ----------------- New: HMAC helper (for room proof signing) -----------------
async function hmacSha256B64(secret, message) {
  // returns base64(signature)
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return bufToB64(sig);
}
__name(hmacSha256B64, "hmacSha256B64");

// ----------------- handlers for imgbb key endpoints -----------------

async function handlePostImgBBKey(request, env, data) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth && auth.trim() ? auth.trim() : null;
  const username = await verifyTokenAndGetUsername(env, token);
  if (!username) return json({ success: false, error: "Unauthorized" }, 401);

  const keyPlain = data && data.key ? String(data.key).trim() : null;
  if (!keyPlain) return json({ success: false, error: "Missing 'key' in body" }, 400);

  try {
    const blob = await encryptTextWithSecret(env, keyPlain);
    await env.dolesecurity.prepare(
      "UPDATE user_keys SET key_blob = ? WHERE username = ?"
    ).bind(blob, username).run();

    const exists = await env.dolesecurity.prepare(
      "SELECT username FROM user_keys WHERE username = ?"
    ).bind(username).first();

    if (!exists) {
      await env.dolesecurity.prepare(
        "INSERT INTO user_keys (username, key_blob) VALUES (?, ?)"
      ).bind(username, blob).run();
    }

    return json({ success: true });
  } catch (e) {
    return json({ success: false, error: "Failed to store key" }, 500);
  }
}
__name(handlePostImgBBKey, "handlePostImgBBKey");

async function handleGetImgBBKey(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth && auth.trim() ? auth.trim() : null;
  const username = await verifyTokenAndGetUsername(env, token);
  if (!username) return json({ success: false, error: "Unauthorized" }, 401);

  try {
    const row = await env.dolesecurity.prepare(
      "SELECT key_blob FROM user_keys WHERE username = ?"
    ).bind(username).first();

    if (!row || !row.key_blob) {
      return json({ success: true, key: null });
    }

    const decrypted = await decryptTextWithSecret(env, row.key_blob);
    if (decrypted === null) {
      return json({ success: true, key: null, note: "Stored key present but could not be decrypted on server" });
    }

    return json({ success: true, key: decrypted });
  } catch (e) {
    return json({ success: false, error: "Failed to read key" }, 500);
  }
}
__name(handleGetImgBBKey, "handleGetImgBBKey");

async function handleDeleteImgBBKey(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth && auth.trim() ? auth.trim() : null;
  const username = await verifyTokenAndGetUsername(env, token);
  if (!username) return json({ success: false, error: "Unauthorized" }, 401);

  try {
    await env.dolesecurity.prepare("DELETE FROM user_keys WHERE username = ?").bind(username).run();
    return json({ success: true });
  } catch (e) {
    return json({ success: false, error: "Failed to delete key" }, 500);
  }
}
__name(handleDeleteImgBBKey, "handleDeleteImgBBKey");

// ----------------- per-user room-passwords handlers -----------------
async function handlePostRoomPassword(request, env, data) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth && auth.trim() ? auth.trim() : null;
  const username = await verifyTokenAndGetUsername(env, token);
  if (!username) return json({ success: false, error: "Unauthorized" }, 401);

  const room = data && data.room ? String(data.room).trim() : null;
  const password = data && data.password ? String(data.password) : null;
  if (!room || !password) return json({ success: false, error: "Missing room or password" }, 400);

  try {
    const blob = await encryptTextWithSecret(env, password);
    await env.dolesecurity.prepare(
      "UPDATE user_room_passwords SET password_blob = ?, saved_at = ? WHERE username = ? AND room = ?"
    ).bind(blob, Date.now(), username, room).run();

    const exists = await env.dolesecurity.prepare(
      "SELECT username FROM user_room_passwords WHERE username = ? AND room = ?"
    ).bind(username, room).first();

    if (!exists) {
      await env.dolesecurity.prepare(
        "INSERT INTO user_room_passwords (username, room, password_blob, saved_at) VALUES (?, ?, ?, ?)"
      ).bind(username, room, blob, Date.now()).run();
    }

    return json({ success: true });
  } catch (e) {
    return json({ success: false, error: "Failed to save room password" }, 500);
  }
}
__name(handlePostRoomPassword, "handlePostRoomPassword");

async function handleGetRoomPasswords(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth && auth.trim() ? auth.trim() : null;
  const username = await verifyTokenAndGetUsername(env, token);
  if (!username) return json({ success: false, error: "Unauthorized" }, 401);

  try {
    const result = await env.dolesecurity.prepare(
      "SELECT room, password_blob FROM user_room_passwords WHERE username = ?"
    ).bind(username).all();

    const rows = result.results || [];
    const out = {};
    for (const r of rows) {
      const decrypted = await decryptTextWithSecret(env, r.password_blob);
      out[r.room] = decrypted === null ? null : decrypted;
    }
    return json({ success: true, passwords: out });
  } catch (e) {
    return json({ success: false, error: "Failed to read room passwords" }, 500);
  }
}
__name(handleGetRoomPasswords, "handleGetRoomPasswords");

async function handleDeleteRoomPassword(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth && auth.trim() ? auth.trim() : null;
  const username = await verifyTokenAndGetUsername(env, token);
  if (!username) return json({ success: false, error: "Unauthorized" }, 401);

  let data = null;
  try { data = await request.json().catch(()=>null); } catch (e) { data = null; }
  const room = data && data.room ? String(data.room).trim() : null;
  if (!room) return json({ success: false, error: "Missing room" }, 400);

  try {
    await env.dolesecurity.prepare(
      "DELETE FROM user_room_passwords WHERE username = ? AND room = ?"
    ).bind(username, room).run();
    return json({ success: true });
  } catch (e) {
    return json({ success: false, error: "Failed to delete room password" }, 500);
  }
}
__name(handleDeleteRoomPassword, "handleDeleteRoomPassword");

// ----------------- claimed chats handlers -----------------
async function handleGetClaimedChats(request, env) {
  const adminKey = request.headers.get("x-admin-key") || "";
  const isAdmin = adminKey && adminKey === env.ADMIN_KEY;

  try {
    const result = await env.dolesecurity.prepare(
      "SELECT chat_name, claimed_by, password_blob, created_at, claimed_at FROM claimed_chats"
    ).all();

    const rows = result.results || [];
    const out = [];
    for (const r of rows) {
      const item = { chat_name: r.chat_name, claimed_by: r.claimed_by || null, created_at: r.created_at || null, claimed_at: r.claimed_at || null };
      if (isAdmin && r.password_blob) {
        const decrypted = await decryptTextWithSecret(env, r.password_blob);
        item.password = decrypted === null ? null : decrypted;
      }
      out.push(item);
    }
    return json({ success: true, claimed: out });
  } catch (e) {
    return json({ success: false, error: "Failed to read claimed chats" }, 500);
  }
}
__name(handleGetClaimedChats, "handleGetClaimedChats");

async function handleClaimChat(request, env, data) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth && auth.trim() ? auth.trim() : null;
  const username = await verifyTokenAndGetUsername(env, token);
  if (!username) return json({ success: false, error: "Unauthorized" }, 401);

  const chat_name = data && data.chat_name ? String(data.chat_name).trim() : null;
  const password = data && data.password ? String(data.password) : null;
  if (!chat_name || !password) return json({ success: false, error: "Missing chat_name or password" }, 400);

  try {
    // Check claim limit
    const cntRow = await env.dolesecurity.prepare(
      "SELECT COUNT(*) AS c FROM claimed_chats WHERE claimed_by = ?"
    ).bind(username).first();
    const count = (cntRow && typeof cntRow.c === "number") ? cntRow.c : Number(cntRow && cntRow.c) || 0;
    if (count >= 3) {
      return json({ success: false, error: "Claim limit reached (max 3)" }, 403);
    }

    // Check if already claimed by someone else
    const existing = await env.dolesecurity.prepare(
      "SELECT chat_name, claimed_by FROM claimed_chats WHERE chat_name = ?"
    ).bind(chat_name).first();

    if (existing && existing.claimed_by && existing.claimed_by !== username) {
      return json({ success: false, error: "Chat already claimed" }, 409);
    }

    // Upsert claim
    const blob = await encryptTextWithSecret(env, password);
    const now = Date.now();

    await env.dolesecurity.prepare(
      "INSERT INTO claimed_chats (chat_name, claimed_by, password_blob, created_at, claimed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_name) DO UPDATE SET claimed_by = excluded.claimed_by, password_blob = excluded.password_blob, claimed_at = excluded.claimed_at"
    ).bind(chat_name, username, blob, now, now).run();

    // Upsert user's own saved password for this room
    await env.dolesecurity.prepare(
      "INSERT INTO user_room_passwords (username, room, password_blob, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT(username, room) DO UPDATE SET password_blob = excluded.password_blob, saved_at = excluded.saved_at"
    ).bind(username, chat_name, blob, now).run();

    return json({ success: true });
  } catch (e) {
    return json({ success: false, error: "Failed to claim chat" }, 500);
  }
}
__name(handleClaimChat, "handleClaimChat");

async function handleUnclaimChat(request, env, data) {
  const adminKey = request.headers.get("x-admin-key") || "";
  const isAdmin = adminKey && adminKey === env.ADMIN_KEY;

  const auth = request.headers.get("Authorization") || "";
  const token = auth && auth.trim() ? auth.trim() : null;
  const username = await verifyTokenAndGetUsername(env, token);
  if (!username && !isAdmin) return json({ success: false, error: "Unauthorized" }, 401);

  const chat_name = data && data.chat_name ? String(data.chat_name).trim() : null;
  if (!chat_name) return json({ success: false, error: "Missing chat_name" }, 400);

  try {
    const existing = await env.dolesecurity.prepare(
      "SELECT chat_name, claimed_by FROM claimed_chats WHERE chat_name = ?"
    ).bind(chat_name).first();

    if (!existing) return json({ success: false, error: "Chat not claimed" }, 404);

    if (!isAdmin && existing.claimed_by !== username) {
      return json({ success: false, error: "Only claimer or admin can unclaim" }, 403);
    }

    await env.dolesecurity.prepare(
      "DELETE FROM claimed_chats WHERE chat_name = ?"
    ).bind(chat_name).run();

    return json({ success: true });
  } catch (e) {
    return json({ success: false, error: "Failed to unclaim chat" }, 500);
  }
}
__name(handleUnclaimChat, "handleUnclaimChat");

async function handleUpdateClaimPassword(request, env, data) {
  const adminKey = request.headers.get("x-admin-key") || "";
  const isAdmin = adminKey && adminKey === env.ADMIN_KEY;

  const auth = request.headers.get("Authorization") || "";
  const token = auth && auth.trim() ? auth.trim() : null;
  const username = await verifyTokenAndGetUsername(env, token);
  if (!username && !isAdmin) return json({ success: false, error: "Unauthorized" }, 401);

  const chat_name = data && data.chat_name ? String(data.chat_name).trim() : null;
  const newPassword = data && data.password ? String(data.password) : null;
  if (!chat_name || !newPassword) return json({ success: false, error: "Missing chat_name or password" }, 400);

  try {
    const existing = await env.dolesecurity.prepare(
      "SELECT chat_name, claimed_by FROM claimed_chats WHERE chat_name = ?"
    ).bind(chat_name).first();

    if (!existing) return json({ success: false, error: "Chat not claimed" }, 404);

    if (!isAdmin && existing.claimed_by !== username) {
      return json({ success: false, error: "Only claimer or admin can update password" }, 403);
    }

    const blob = await encryptTextWithSecret(env, newPassword);
    const now = Date.now();

    await env.dolesecurity.prepare(
      "UPDATE claimed_chats SET password_blob = ?, claimed_at = ? WHERE chat_name = ?"
    ).bind(blob, now, chat_name).run();

    if (!isAdmin) {
      await env.dolesecurity.prepare(
        "UPDATE user_room_passwords SET password_blob = ?, saved_at = ? WHERE username = ? AND room = ?"
      ).bind(blob, now, username, chat_name).run();

      const existsP = await env.dolesecurity.prepare(
        "SELECT username FROM user_room_passwords WHERE username = ? AND room = ?"
      ).bind(username, chat_name).first();

      if (!existsP) {
        await env.dolesecurity.prepare(
          "INSERT INTO user_room_passwords (username, room, password_blob, saved_at) VALUES (?, ?, ?, ?)"
        ).bind(username, chat_name, blob, now).run();
      }
    }

    return json({ success: true });
  } catch (e) {
    return json({ success: false, error: "Failed to update claim password" }, 500);
  }
}
__name(handleUpdateClaimPassword, "handleUpdateClaimPassword");

// ----------------- POST /user/room-proof -----------------
async function handlePostRoomProof(request, env, data) {
  const adminKey = request.headers.get("x-admin-key") || "";
  const isAdmin = adminKey && adminKey === env.ADMIN_KEY;

  const auth = request.headers.get("Authorization") || "";
  const token = auth && auth.trim() ? auth.trim() : null;
  let username = null;

  if (!isAdmin) {
    username = await verifyTokenAndGetUsername(env, token);
    if (!username) return json({ success: false, error: "Unauthorized" }, 401);
  } else {
    username = (data && data.username) ? String(data.username).trim() : "admin";
  }

  const room = data && data.room ? String(data.room).trim() : null;
  if (!room) return json({ success: false, error: "Missing 'room' in body" }, 400);

  try {
    const claimedRow = await env.dolesecurity.prepare(
      "SELECT chat_name, claimed_by, password_blob FROM claimed_chats WHERE chat_name = ?"
    ).bind(room).first();

    if (!claimedRow || !claimedRow.claimed_by) {
      // unclaimed room — anyone can get a proof
    } else {
      const claimedBy = claimedRow.claimed_by;

      if (isAdmin) {
        // admin always allowed
      } else if (claimedBy === username) {
        // claimer always allowed
      } else {
        // non-claimer: must have the correct password saved
        const pwRow = await env.dolesecurity.prepare(
          "SELECT password_blob FROM user_room_passwords WHERE username = ? AND room = ?"
        ).bind(username, room).first();

        if (!pwRow || !pwRow.password_blob) {
          return json({ success: false, error: "Not authorized for this claimed room" }, 403);
        }

        const userPassword = await decryptTextWithSecret(env, pwRow.password_blob);
        if (userPassword === null) {
          return json({ success: false, error: "Stored password not available (decrypt failed)" }, 403);
        }

        // Fetch and decrypt the actual claimed room password to compare
        if (!claimedRow.password_blob) {
          return json({ success: false, error: "Claimed room has no password set" }, 403);
        }

        const claimPassword = await decryptTextWithSecret(env, claimedRow.password_blob);
        if (claimPassword === null || userPassword !== claimPassword) {
          return json({ success: false, error: "Incorrect password for this room" }, 403);
        }
      }
    }

    const TTL_MS = 60 * 1000;
    const expiry = Date.now() + TTL_MS;
    const payload = `${username}:${room}:${expiry}`;
    const sigB64 = await hmacSha256B64(env.SECRET_KEY, payload);
    const proofRaw = `${payload}:${sigB64}`;
    const proof = btoa(proofRaw);

    return json({ success: true, proof, expires: expiry });
  } catch (e) {
    return json({ success: false, error: "Failed to mint proof" }, 500);
  }
}
__name(handlePostRoomProof, "handlePostRoomProof");

// ----------------- NEW: POST /room-activity -----------------
// Trusted internal endpoint used by DO to upsert activity metrics
async function handlePostRoomActivity(request, env, data) {
  const internalKey = request.headers.get("x-internal-key") || "";
  if (!internalKey || internalKey !== env.INTERNAL_KEY) {
    return json({ success: false, error: "Unauthorized internal call" }, 401);
  }

  const room = data && data.room ? String(data.room).trim() : null;
  const increment = (data && Number.isInteger(data.increment)) ? data.increment : (data && Number(data.increment)) || 0;
  const lastActivity = (data && Number(data.last_activity)) || Date.now();
  if (!room) return json({ success: false, error: "Missing room" }, 400);

  try {
    const existing = await env.dolesecurity.prepare(
      "SELECT room, message_count FROM room_activity WHERE room = ?"
    ).bind(room).first();

    if (existing) {
      const newCount = (existing.message_count || 0) + (increment || 0);
      await env.dolesecurity.prepare(
        "UPDATE room_activity SET last_activity = ?, message_count = ? WHERE room = ?"
      ).bind(lastActivity, newCount, room).run();
    } else {
      await env.dolesecurity.prepare(
        "INSERT INTO room_activity (room, last_activity, message_count) VALUES (?, ?, ?)"
      ).bind(room, lastActivity, increment || 0).run();
    }
    return json({ success: true });
  } catch (e) {
    return json({ success: false, error: "Failed to record activity" }, 500);
  }
}
__name(handlePostRoomActivity, "handlePostRoomActivity");

// ----------------- NEW: GET /explore -----------------
// Public endpoint returning top rooms by last_activity or message_count
async function handleGetExplore(request, env) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams;
    const limit = Math.min(200, Math.max(1, Number(q.get("limit") || 20)));
    const sort = (q.get("sort") === "message_count") ? "message_count" : "last_activity";

    const stmt = `SELECT room, last_activity, message_count FROM room_activity ORDER BY ${sort} DESC LIMIT ?`;
    const result = await env.dolesecurity.prepare(stmt).bind(limit).all();
    const rows = result && result.results ? result.results : [];
    return json({ success: true, rooms: rows });
  } catch (e) {
    return json({ success: false, error: "Failed to read explore data" }, 500);
  }
}
__name(handleGetExplore, "handleGetExplore");

// ----------------- End of new handlers -----------------

export { index_default as default };
