  (function() {
(async () => {
  const CHAT_BASE = "https://dolegpt2.anonymousguy.workers.dev";
  const ACCOUNT_BASE = "https://account-worker.anonymousguy.workers.dev";
  const IMAGE_UPLOAD_WORKER = "https://dole-imagesupport.anonymousguy.workers.dev";

  let currentRoom = (function() {
    try { return localStorage.getItem("dole_chat_room") || "friends"; } catch (e) { return "friends"; }
  })();

  const ROOMS_LIST_KEY = "dole_chat_rooms";
  const REACT_PREFIX = "\u200B\u200D[react:";
  const REACT_SUFFIX = "]\u200D\u200B";
  const REACT_RE = /\u200B\u200D\[react:([^:]+):([^:]+):(\d+)\]\u200D\u200B/;
  const QUICK_EMOJIS = ["\ud83d\udc4d", "\u2764\ufe0f", "\ud83d\ude02", "\ud83d\ude2e", "\ud83d\ude22", "\ud83d\ude21", "\ud83d\ude4f", "\ud83d\udd25"];
  const IS_TOUCH_DEVICE = (("ontouchstart" in window) || (navigator.maxTouchPoints > 0) || window.matchMedia("(pointer: coarse)").matches);

  let sessionImgBBKey = null;
  let sessionRoomPasswords = {};
  let userRoomPasswords = {};
  let claimedChatsMap = {};
  let roomProofs = {};
  let createdEls = [];

  // --- DRAG ---
  function makeDraggable(el, options = {}) {
    const header = el.querySelector(":scope > div") || el;
    header.style.cursor = "grab";
    header.style.userSelect = "none";
    header.style.touchAction = "none";
    el.style.touchAction = "none";
    let dragging = false, moved = false, offsetX = 0, offsetY = 0, startX = 0, startY = 0;
    let activePointerId = null;
    let transformCleared = false;
    const origBg = header.style.background;
    const threshold = options.threshold || 6;

    function shouldIgnoreStart(target) {
      return !!target.closest("button, input, textarea, [contenteditable], #chatMessages");
    }
    function clearCenterTransform() {
      if (transformCleared) return;
      const t = el.style.transform || "";
      if (t && t.includes("translate")) {
        const rect = el.getBoundingClientRect();
        el.style.transform = "none";
        el.style.left = rect.left + "px";
        el.style.top = rect.top + "px";
      }
      transformCleared = true;
    }
    function start(e) {
      if (shouldIgnoreStart(e.target)) return;
      if (activePointerId !== null) return;
      clearCenterTransform();
      activePointerId = e.pointerId;
      dragging = false; moved = false;
      startX = e.clientX; startY = e.clientY;
      offsetX = e.clientX - el.getBoundingClientRect().left;
      offsetY = e.clientY - el.getBoundingClientRect().top;
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
    function move(e) {
      if (e.pointerId !== activePointerId) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < threshold) return;
        dragging = true;
        header.style.cursor = "grabbing";
        header.style.background = "rgba(0,0,0,0.18)";
        el.style.userSelect = "none";
      }
      const left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, e.clientX - offsetX));
      const top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, e.clientY - offsetY));
      el.style.left = left + "px";
      el.style.top = top + "px";
      e.preventDefault();
      moved = true;
    }
    function end(e) {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      if (!dragging && !moved) el.click();
      dragging = false;
      header.style.cursor = "grab";
      header.style.background = origBg || "";
      el.style.userSelect = "";
    }
    header.addEventListener("pointerdown", start);
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", end);
    header.addEventListener("pointercancel", end);
  }

  function registerEl(el) {
    try { el.dataset.bookmarklet = "true"; } catch (e) {}
    createdEls.push(el);
    makeDraggable(el);
  }
  function removeEl(el) {
    if (!el) return;
    el.remove();
    createdEls = createdEls.filter(e => e !== el);
  }

  // --- rooms list helpers ---
  function loadRoomsList() {
    try {
      const raw = localStorage.getItem(ROOMS_LIST_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(r => typeof r === "string" && r.trim().length > 0).map(r => r.trim());
      return [];
    } catch (e) { return []; }
  }
  function saveRoomsList(arr) {
    try {
      const dedup = Array.from(new Set((arr || []).map(r => String(r).trim()))).filter(r => r.length > 0);
      localStorage.setItem(ROOMS_LIST_KEY, JSON.stringify(dedup));
      return true;
    } catch (e) { return false; }
  }
  function addRoomToList(room) {
    if (!room || !room.trim()) return false;
    const list = loadRoomsList();
    if (!list.includes(room)) {
      list.unshift(room);
      if (list.length > 50) list.length = 50;
      saveRoomsList(list);
    }
    return true;
  }
  function removeRoomFromList(room) {
    saveRoomsList(loadRoomsList().filter(r => r !== room));
    return true;
  }

  // --- timestamp helpers ---
  function parseMessageTimestamp(m) {
    const candidates = [m.ts, m.timestamp, m.created_at, m.createdAt, m.time, m.date, m.when];
    let raw;
    for (const c of candidates) { if (c !== undefined && c !== null) { raw = c; break; } }
    if (raw === undefined) return null;
    if (typeof raw === "number") {
      if (raw > 1e12) return new Date(raw);
      if (raw > 1e9) return new Date(raw * 1000);
      return new Date(raw);
    }
    if (typeof raw === "string") {
      const n = Number(raw);
      if (!Number.isNaN(n)) {
        if (n > 1e12) return new Date(n);
        if (n > 1e9) return new Date(n * 1000);
      }
      const parsed = Date.parse(raw);
      if (!Number.isNaN(parsed)) return new Date(parsed);
    }
    return null;
  }
  function timeAgoShort(date) {
    if (!date) return "";
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 5) return "now";
    if (diff < 60) return `${diff}s ago`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function refreshTimestampsIn(container) {
    if (!container) return;
    const nodes = container.querySelectorAll && container.querySelectorAll("[data-ts]");
    if (!nodes || nodes.length === 0) return;
    for (const el of nodes) {
      const ms = Number(el.dataset.ts);
      if (!Number.isFinite(ms) || ms <= 0) { el.textContent = ""; el.title = ""; continue; }
      const d = new Date(ms);
      el.textContent = timeAgoShort(d);
      el.title = d.toLocaleString();
    }
  }

  // --- image detection ---
  const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i;
  function isImageUrl(text) {
    if (typeof text !== "string") return false;
    const t = text.trim();
    try {
      const u = new URL(t);
      if (!["http:", "https:"].includes(u.protocol)) return false;
      return IMG_EXT_RE.test(u.pathname);
    } catch (e) { return false; }
  }

  // --- fetch with timeout ---
  function fetchWithTimeout(url, opts = {}, timeout = 8000) {
    const controller = new AbortController();
    const o = Object.assign({}, opts, { signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), timeout);
    return fetch(url, o).finally(() => clearTimeout(timer));
  }

  // Try stricter then looser media constraints for school-managed devices.
  async function getPreferredLocalMedia() {
    const attempts = [
      {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
          facingMode: "user"
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      },
      { video: true, audio: true },
      { video: false, audio: true },
      { video: true, audio: false }
    ];
    let lastErr = null;
    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream && stream.getTracks().length > 0) return stream;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Could not access camera/microphone");
  }

  // --- account helpers ---
  async function fetchUserRoomPasswords(token) {
    if (!token) return {};
    try {
      const res = await fetchWithTimeout(`${ACCOUNT_BASE}/user/room-passwords`, { method: "GET", headers: { Authorization: token } }, 8000);
      if (!res.ok) return {};
      const j = await res.json().catch(() => null);
      if (!j || !j.success || !j.passwords) return {};
      return j.passwords || {};
    } catch (e) { return {}; }
  }
  async function fetchClaimedChats() {
    try {
      const res = await fetchWithTimeout(`${ACCOUNT_BASE}/claimed-chats`, { method: "GET" }, 8000);
      if (!res.ok) return {};
      const j = await res.json().catch(() => null);
      if (!j || !j.success || !Array.isArray(j.claimed)) return {};
      const map = {};
      for (const it of j.claimed) map[it.chat_name] = { claimed_by: it.claimed_by || null, created_at: it.created_at || null, claimed_at: it.claimed_at || null };
      return map;
    } catch (e) { return {}; }
  }
  async function postSaveRoomPassword(token, room, password) {
    try {
      const res = await fetchWithTimeout(`${ACCOUNT_BASE}/user/room-passwords`, {
        method: "POST", headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ room, password })
      }, 8000);
      const j = await res.json().catch(() => null);
      return !!(j && j.success);
    } catch (e) { return false; }
  }
  async function postDeleteRoomPassword(token, room) {
    try {
      const res = await fetchWithTimeout(`${ACCOUNT_BASE}/user/room-passwords`, {
        method: "DELETE", headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ room })
      }, 8000);
      const j = await res.json().catch(() => null);
      return !!(j && j.success);
    } catch (e) { return false; }
  }
  async function postClaimChat(token, chat_name, password) {
    try {
      const res = await fetchWithTimeout(`${ACCOUNT_BASE}/user/claim-chat`, {
        method: "POST", headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ chat_name, password })
      }, 8000);
      const j = await res.json().catch(() => null);
      return j || { success: false };
    } catch (e) { return { success: false, error: "network" }; }
  }
  async function postUnclaimChat(token, chat_name, adminKey) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = token;
      if (adminKey) headers["x-admin-key"] = adminKey;
      const res = await fetchWithTimeout(`${ACCOUNT_BASE}/user/unclaim-chat`, {
        method: "POST", headers, body: JSON.stringify({ chat_name })
      }, 8000);
      const j = await res.json().catch(() => null);
      return j || { success: false };
    } catch (e) { return { success: false, error: "network" }; }
  }
  async function postUpdateClaimPassword(token, chat_name, password, adminKey) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = token;
      if (adminKey) headers["x-admin-key"] = adminKey;
      const res = await fetchWithTimeout(`${ACCOUNT_BASE}/user/update-claim-password`, {
        method: "POST", headers, body: JSON.stringify({ chat_name, password })
      }, 8000);
      const j = await res.json().catch(() => null);
      return j || { success: false };
    } catch (e) { return { success: false, error: "network" }; }
  }
  async function fetchRoomProof(token, room) {
    try {
      const cached = roomProofs[room];
      if (cached && cached.proof && cached.expires && Date.now() < (cached.expires - 500)) return cached.proof;
      const res = await fetchWithTimeout(`${ACCOUNT_BASE}/user/room-proof`, {
        method: "POST", headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ room })
      }, 8000);
      const j = await res.json().catch(() => null);
      if (!j || !j.success || !j.proof || !j.expires) return null;
      roomProofs[room] = { proof: j.proof, expires: j.expires };
      return j.proof;
    } catch (e) { return null; }
  }
  async function fetchExplore(limit = 20, sort = "last_activity", q = "") {
    try {
      const url = new URL(`${ACCOUNT_BASE}/explore`);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("sort", sort);
      if (q) url.searchParams.set("q", q);
      const res = await fetchWithTimeout(url.toString(), {}, 8000);
      if (!res.ok) return [];
      const j = await res.json().catch(() => null);
      if (!j || !j.success || !Array.isArray(j.rooms)) return [];
      return j.rooms;
    } catch (e) { return []; }
  }

  // --- reaction helpers ---
  function makeReactMessage(emoji, targetUser, targetIndex) {
    return REACT_PREFIX + emoji + ":" + targetUser + ":" + targetIndex + REACT_SUFFIX;
  }
  function parseReaction(text) {
    if (typeof text !== "string") return null;
    const match = text.match(REACT_RE);
    if (!match) return null;
    return { emoji: match[1], targetUser: match[2], targetIndex: parseInt(match[3], 10) };
  }
  function isReactionMessage(m) {
    return parseReaction(String(m.text || "")) !== null;
  }

  // --- message rendering ---
  function appendMessageToContainer(container, m, i, allMessages, chatController, username) {
    const text = String(m.text || "");
    if (isReactionMessage(m)) return;

    const d = document.createElement("div");
    d.className = "dole-msg";
    d.dataset.msgIndex = String(i);
    d.dataset.msgUser = String(m.username || "unknown");
    Object.assign(d.style, {
      padding: "8px 12px", borderRadius: "10px", wordBreak: "break-word",
      fontSize: "14px", display: "flex", flexDirection: "column", gap: "4px",
      position: "relative", transition: "background 0.15s",
      animation: "dole-slideUp 0.2s ease",
    });
    d.style.touchAction = "manipulation";

    const topRow = document.createElement("div");
    Object.assign(topRow.style, { display: "flex", alignItems: "center", gap: "8px" });

    const avatar = document.createElement("div");
    const uname = String(m.username || "unknown");
    const hue = [...uname].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    Object.assign(avatar.style, {
      width: "28px", height: "28px", borderRadius: "50%",
      background: `hsl(${hue}, 55%, 45%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "13px", fontWeight: "700", color: "#fff", flexShrink: "0",
      textTransform: "uppercase",
    });
    avatar.textContent = uname.charAt(0);
    topRow.appendChild(avatar);

    const strong = document.createElement("strong");
    strong.textContent = uname;
    Object.assign(strong.style, { color: `hsl(${hue}, 70%, 75%)`, fontSize: "13px", fontWeight: "600" });
    topRow.appendChild(strong);

    const left = document.createElement("div");
    left.style.flex = "1 1 auto";
    left.style.minWidth = "0";

    const trimmed = text.trim();

    if (trimmed && isImageUrl(trimmed) && trimmed === text) {
      const wrapper = document.createElement("div");
      wrapper.style.display = "inline-flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "8px";

      const imgButton = document.createElement("button");
      imgButton.type = "button";
      Object.assign(imgButton.style, {
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        padding: "6px 8px", borderRadius: "8px", border: "none",
        background: "#5865f2", color: "#fff", cursor: "pointer", fontSize: "16px"
      });
      imgButton.title = "Show image";
      imgButton.textContent = "🖼️";
      imgButton.dataset.url = trimmed;

      let expanded = false, imgEl = null;
      function expand() {
        if (expanded) return;
        expanded = true;
        imgEl = document.createElement("img");
        imgEl.src = trimmed; imgEl.alt = "Image"; imgEl.loading = "lazy";
        Object.assign(imgEl.style, { maxWidth: "100%", maxHeight: "360px", borderRadius: "8px", display: "block", cursor: "pointer", boxShadow: "0 6px 18px rgba(0,0,0,0.4)" });
        imgEl.referrerPolicy = "no-referrer";
        imgEl.addEventListener("error", () => { if (imgEl && imgEl.parentNode) imgEl.replaceWith(imgButton); expanded = false; imgEl = null; });
        imgEl.addEventListener("click", collapse);
        imgButton.replaceWith(imgEl);
      }
      function collapse() {
        if (!expanded) return;
        expanded = false;
        if (imgEl && imgEl.parentNode) imgEl.replaceWith(imgButton);
        imgEl = null;
      }
      imgButton.addEventListener("click", expand);
      wrapper.appendChild(document.createTextNode(": "));
      wrapper.appendChild(imgButton);
      left.appendChild(wrapper);
    } else {
      const textSpan = document.createElement("span");
      textSpan.style.color = "#dcddde";
      textSpan.textContent = text;
      left.appendChild(textSpan);
    }

    const tsDate = parseMessageTimestamp(m);
    const timeEl = document.createElement("div");
    Object.assign(timeEl.style, { opacity: "0.45", fontSize: "11px", whiteSpace: "nowrap", flex: "0 0 auto" });
    if (tsDate) {
      timeEl.dataset.ts = String(tsDate.getTime());
      timeEl.textContent = timeAgoShort(tsDate);
      timeEl.title = tsDate.toLocaleString();
    }
    topRow.appendChild(timeEl);

    // Reaction trigger button
    if (chatController) {
      const reactTrigger = document.createElement("button");
      reactTrigger.className = "dole-react-trigger dole-btn";
      reactTrigger.textContent = "\ud83d\ude00";
      Object.assign(reactTrigger.style, {
        background: "rgba(255,255,255,0.06)", border: "none", padding: "2px 6px",
        borderRadius: "6px", cursor: "pointer", fontSize: "14px", color: "#fff",
        marginLeft: "auto", flexShrink: "0",
      });
      if (IS_TOUCH_DEVICE) {
        reactTrigger.style.opacity = "1";
        reactTrigger.style.padding = "8px 10px";
        reactTrigger.style.minWidth = "40px";
        reactTrigger.style.minHeight = "40px";
      }
      reactTrigger.addEventListener("click", (ev) => {
        ev.stopPropagation();
        showEmojiPicker(d, i, uname, chatController);
      });
      topRow.appendChild(reactTrigger);
    }

    if (chatController) {
      let holdTimer = null;
      let holdDone = false;
      const clearHold = () => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
      };
      d.addEventListener("pointerdown", (ev) => {
        if (ev.pointerType !== "touch") return;
        holdDone = false;
        clearHold();
        holdTimer = setTimeout(() => {
          holdDone = true;
          showEmojiPicker(d, i, uname, chatController);
        }, 380);
      });
      d.addEventListener("pointerup", clearHold);
      d.addEventListener("pointercancel", clearHold);
      d.addEventListener("pointerleave", clearHold);
      d.addEventListener("contextmenu", (ev) => {
        if (holdDone) ev.preventDefault();
      });
    }

    d.appendChild(topRow);
    d.appendChild(left);

    // Render reactions for this message
    if (allMessages) {
      const reactions = collectReactionsForMessage(allMessages, i, uname);
      if (reactions.size > 0) {
        const reactRow = document.createElement("div");
        Object.assign(reactRow.style, { display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "2px" });
        for (const [emoji, users] of reactions) {
          const badge = document.createElement("span");
          badge.className = "dole-reaction-badge" + (users.includes(username) ? " mine" : "");
          badge.textContent = emoji + " " + users.length;
          badge.title = users.join(", ");
          badge.addEventListener("click", () => {
            if (chatController) {
              const reactText = makeReactMessage(emoji, uname, i);
              chatController.sendMessage(reactText).catch(() => {});
            }
          });
          reactRow.appendChild(badge);
        }
        d.appendChild(reactRow);
      }
    }

    container.appendChild(d);
  }

  function collectReactionsForMessage(allMessages, targetIndex, targetUser) {
    const reactions = new Map();
    for (const m of allMessages) {
      const r = parseReaction(String(m.text || ""));
      if (!r) continue;
      if (r.targetIndex === targetIndex && r.targetUser === targetUser) {
        if (!reactions.has(r.emoji)) reactions.set(r.emoji, []);
        const list = reactions.get(r.emoji);
        const reactor = String(m.username || "unknown");
        if (!list.includes(reactor)) list.push(reactor);
      }
    }
    return reactions;
  }

  let activeEmojiPicker = null;
  function showEmojiPicker(msgEl, msgIndex, msgUser, chatController) {
    if (activeEmojiPicker) { activeEmojiPicker.remove(); activeEmojiPicker = null; }
    const picker = document.createElement("div");
    picker.className = "dole-emoji-picker";
    Object.assign(picker.style, {
      position: "absolute", top: "-4px", right: "8px", transform: "translateY(-100%)",
      background: "#1e2030", borderRadius: "12px", padding: "6px 8px",
      display: "flex", gap: "2px", zIndex: "100",
      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      border: "1px solid rgba(255,255,255,0.08)",
    });
    if (IS_TOUCH_DEVICE) {
      picker.style.padding = "8px 10px";
      picker.style.gap = "6px";
    }
    for (const emoji of QUICK_EMOJIS) {
      const btn = document.createElement("button");
      btn.className = "dole-btn";
      btn.textContent = emoji;
      Object.assign(btn.style, {
        background: "transparent", border: "none", fontSize: "20px",
        cursor: "pointer", padding: "4px 6px", borderRadius: "8px",
        transition: "background 0.12s, transform 0.12s",
      });
      if (IS_TOUCH_DEVICE) {
        btn.style.fontSize = "24px";
        btn.style.padding = "8px 10px";
        btn.style.minWidth = "44px";
        btn.style.minHeight = "44px";
      }
      btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(255,255,255,0.1)"; });
      btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; });
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const reactText = makeReactMessage(emoji, msgUser, msgIndex);
        chatController.sendMessage(reactText).catch(() => {});
        picker.remove();
        activeEmojiPicker = null;
      });
      picker.appendChild(btn);
    }
    msgEl.appendChild(picker);
    activeEmojiPicker = picker;
    const dismiss = (ev) => {
      if (!picker.contains(ev.target)) {
        picker.remove();
        activeEmojiPicker = null;
        document.removeEventListener("click", dismiss);
        document.removeEventListener("pointerdown", dismiss);
      }
    };
    setTimeout(() => {
      document.addEventListener("click", dismiss);
      document.addEventListener("pointerdown", dismiss);
    }, 10);
  }

  // --- Inject global styles ---
  const globalStyle = document.createElement("style");
  globalStyle.id = "dole-bookmarklet-styles";
  globalStyle.textContent = `
    @keyframes dole-fadeIn { from { opacity:0; transform:translateY(8px) scale(0.97); } to { opacity:1; transform:translateY(0) scale(1); } }
    @keyframes dole-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(1.4); } }
    @keyframes dole-spin { to { transform:rotate(360deg); } }
    @keyframes dole-slideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
    .dole-btn { transition: background 0.18s, transform 0.12s, box-shadow 0.18s; }
    .dole-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
    .dole-btn:active { transform: translateY(0) scale(0.97); }
    .dole-input { transition: border-color 0.2s, box-shadow 0.2s; }
    .dole-input:focus { border-color: #5865f2 !important; box-shadow: 0 0 0 3px rgba(88,101,242,0.25) !important; }
    .dole-msg:hover { background: rgba(255,255,255,0.04) !important; }
    .dole-msg:hover .dole-react-trigger { opacity:1 !important; }
    .dole-react-trigger { opacity:0; transition: opacity 0.15s; touch-action: manipulation; }
    .dole-emoji-picker { animation: dole-slideUp 0.15s ease; }
    .dole-reaction-badge { display:inline-flex; align-items:center; gap:3px; padding:2px 7px; border-radius:999px; font-size:13px; cursor:pointer; border:1px solid rgba(255,255,255,0.08); background:rgba(88,101,242,0.12); transition:background 0.15s,border-color 0.15s; user-select:none; }
    .dole-reaction-badge:hover { background:rgba(88,101,242,0.25); border-color:rgba(88,101,242,0.4); }
    .dole-reaction-badge.mine { border-color:rgba(88,101,242,0.5); background:rgba(88,101,242,0.2); }
  `;
  document.head.appendChild(globalStyle);

  // --- LOGIN UI ---
  const loginBox = document.createElement("div");
  Object.assign(loginBox.style, {
    position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
    width: "min(92vw, 360px)", background: "linear-gradient(165deg, #1e2030, #171923)", color: "#fff",
    zIndex: 999999, borderRadius: "20px", display: "flex",
    flexDirection: "column", overflow: "hidden",
    fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
    boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)",
    maxHeight: "90vh", animation: "dole-fadeIn 0.3s ease",
    backdropFilter: "blur(20px)",
  });

  loginBox.innerHTML = `
    <div style="padding:24px 20px 16px; text-align:center; position:relative;">
      <div style="font-size:36px; margin-bottom:8px;">\ud83d\udcac</div>
      <div style="font-weight:800; font-size:20px; color:#e6eefc; letter-spacing:-0.3px;">Welcome to Dole Chat</div>
      <div style="font-size:13px; color:#7289da; margin-top:4px; opacity:0.8;">Sign in or create an account</div>
      <button id="closeLogin" class="dole-btn" style="position:absolute; right:14px; top:14px; background:rgba(255,255,255,0.06); color:#9fb0e6; border:none; width:36px; height:36px; border-radius:10px; cursor:pointer; font-size:16px; display:flex; align-items:center; justify-content:center;">\u2715</button>
    </div>
    <div style="padding:4px 20px 24px; display:flex; flex-direction:column; gap:12px;">
      <input id="loginUser" class="dole-input" placeholder="Username" style="padding:14px 16px; border-radius:12px; border:1px solid rgba(255,255,255,0.08); outline:none; font-size:15px; background:rgba(0,0,0,0.3); color:#fff; font-family:inherit;">
      <input id="loginPass" class="dole-input" type="password" placeholder="Password" style="padding:14px 16px; border-radius:12px; border:1px solid rgba(255,255,255,0.08); outline:none; font-size:15px; background:rgba(0,0,0,0.3); color:#fff; font-family:inherit;">
      <div style="display:flex; gap:10px; margin-top:4px;">
        <button id="loginBtn" class="dole-btn" style="flex:1; padding:14px; border-radius:12px; border:none; background:linear-gradient(135deg,#5865f2,#4752c4); color:white; cursor:pointer; font-size:15px; font-weight:700; letter-spacing:0.3px;">Sign In</button>
        <button id="createBtn" class="dole-btn" style="flex:1; padding:14px; border-radius:12px; border:none; background:linear-gradient(135deg,#2f855a,#276749); color:white; cursor:pointer; font-size:15px; font-weight:700; letter-spacing:0.3px;">Sign Up</button>
      </div>
      <div id="loginMsg" style="color:#fc8181; font-size:13px; min-height:18px; text-align:center;"></div>
    </div>
  `;

  document.body.appendChild(loginBox);
  registerEl(loginBox);
  document.getElementById("closeLogin").onclick = () => removeEl(loginBox);

  const showMsg = (msg) => { const el = document.getElementById("loginMsg"); if (el) el.textContent = msg; };

  async function login() {
    const username = document.getElementById("loginUser").value.trim();
    const password = document.getElementById("loginPass").value.trim();
    if (!username || !password) return showMsg("Fill both fields");
    try {
      const res = await fetch(`${ACCOUNT_BASE}/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!data.success) return showMsg("Login failed: " + data.error);
      showMsg("Login successful!");
      removeEl(loginBox);
      initChat(data.token, username);
    } catch (e) { showMsg("Error: " + e); }
  }

  async function createAccount() {
    const username = document.getElementById("loginUser").value.trim();
    const password = document.getElementById("loginPass").value.trim();
    if (!username || !password) return showMsg("Fill both fields");
    try {
      const res = await fetch(`${ACCOUNT_BASE}/create`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!data.success) return showMsg("Request failed: " + data.error);
      showMsg("Request submitted! Wait for approval.");
    } catch (e) { showMsg("Error: " + e); }
  }

  document.getElementById("loginBtn").onclick = login;
  document.getElementById("createBtn").onclick = createAccount;

  // --- MAIN CHAT ---
  async function initChat(token, username) {
    userRoomPasswords = await fetchUserRoomPasswords(token);
    claimedChatsMap = await fetchClaimedChats();

    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed", top: "20px", right: "20px",
      width: "min(95vw, 380px)", height: "min(80vh, 640px)",
      background: "linear-gradient(180deg, #13141a, #0f1014)", color: "#ffffff", zIndex: 999999,
      borderRadius: "16px", display: "flex", flexDirection: "column",
      overflow: "hidden", fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
      boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05)",
      animation: "dole-fadeIn 0.3s ease",
    });

    box.innerHTML = `
      <div id="chatHeader" style="padding:12px 14px; background:linear-gradient(180deg,#16171f,#12131a); font-weight:600; position:relative; font-size:15px; display:flex; align-items:center; gap:8px; border-bottom:1px solid rgba(255,255,255,0.04);">
        <button id="minifyChat" title="Minimize" class="dole-btn" style="background:rgba(255,255,255,0.05); border:none; color:#9fb0e6; width:34px; height:34px; border-radius:10px; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">\u2014</button>
        <div style="flex:1; display:flex; align-items:center; gap:8px; justify-content:center; min-width:0;">
          <div id="wsIndicator" title="Connecting..." style="width:8px; height:8px; border-radius:50%; background:#fc8181; flex-shrink:0;"></div>
          <div style="font-weight:700; color:#e6eefc; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Dole Chat</div>
          <div id="book_username" style="font-weight:500; color:#7289da; font-size:12px; opacity:0.9;"></div>
        </div>
        <button id="callBtn" title="Call" class="dole-btn" style="background:linear-gradient(135deg,#2f855a,#276749); color:white; border:none; width:34px; height:34px; border-radius:10px; cursor:pointer; font-size:15px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">\ud83d\udcde</button>
        <button id="closeChat" class="dole-btn" style="background:rgba(255,107,107,0.15); color:#fc8181; border:none; width:34px; height:34px; border-radius:10px; cursor:pointer; font-size:13px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">\u2715</button>
      </div>

      <div style="padding:8px 12px; display:flex; gap:8px; align-items:center; background:rgba(0,0,0,0.15); border-bottom:1px solid rgba(255,255,255,0.03); flex-shrink:0;">
        <button id="openRoomsBtn" class="dole-btn" style="padding:7px 14px; border-radius:8px; border:none; background:rgba(47,133,90,0.2); color:#68d391; cursor:pointer; font-size:12px; font-weight:600; min-height:32px;">\ud83d\udce6 Rooms</button>
        <button id="openExploreBtn" class="dole-btn" style="padding:7px 14px; border-radius:8px; border:none; background:rgba(43,108,176,0.2); color:#63b3ed; cursor:pointer; font-size:12px; font-weight:600; min-height:32px;">\ud83d\udd0d Explore</button>
        <div id="currentRoomDisplay" style="font-size:12px; color:#7289da; margin-left:auto; font-weight:500; background:rgba(88,101,242,0.1); padding:4px 10px; border-radius:6px;"># ${currentRoom}</div>
      </div>

      <div id="chatMessages" style="flex:1; padding:8px 10px; overflow-y:auto; background:transparent; display:flex; flex-direction:column; gap:4px; -webkit-overflow-scrolling:touch;"></div>

      <div id="imageInputRow" style="display:none; padding:8px 10px; background:rgba(0,0,0,0.2); gap:8px; align-items:center; flex-shrink:0; flex-direction:row; border-top:1px solid rgba(255,255,255,0.03);">
        <input id="imageUrlInput" class="dole-input" placeholder="Paste image URL..." style="flex:1; padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); outline:none; font-size:13px; background:rgba(0,0,0,0.3); color:#fff; font-family:inherit;">
        <button id="imageUrlSend" class="dole-btn" style="padding:8px 10px; border-radius:8px; border:none; background:#2f855a; color:white; cursor:pointer; font-size:13px; min-height:36px; font-weight:600;">Send</button>
        <button id="imageUploadBtn" class="dole-btn" style="padding:8px 10px; border-radius:8px; border:none; background:#2b6cb0; color:white; cursor:pointer; font-size:13px; min-height:36px; font-weight:600;">Upload</button>
        <button id="imageUrlCancel" class="dole-btn" style="padding:8px 10px; border-radius:8px; border:none; background:rgba(255,255,255,0.08); color:#aaa; cursor:pointer; font-size:13px; min-height:36px;">Cancel</button>
      </div>

      <div style="padding:10px 12px; background:rgba(0,0,0,0.2); display:flex; gap:8px; align-items:center; border-top:1px solid rgba(255,255,255,0.04); flex-shrink:0;">
        <button id="imageBtn" title="Add image" class="dole-btn" style="padding:6px 8px; border-radius:8px; border:none; background:rgba(43,108,176,0.2); color:#63b3ed; cursor:pointer; font-size:16px; min-height:40px; min-width:40px; display:flex; align-items:center; justify-content:center;">\ud83d\uddbc\ufe0f</button>
        <input id="chatInput" class="dole-input" style="flex:1; padding:10px 14px; border-radius:10px; border:1px solid rgba(255,255,255,0.06); outline:none; font-size:14px; background:rgba(0,0,0,0.3); color:#fff; font-family:inherit;" placeholder="Type a message...">
        <button id="chatSend" class="dole-btn" style="padding:10px 16px; border-radius:10px; border:none; background:linear-gradient(135deg,#5865f2,#4752c4); color:white; cursor:pointer; font-size:14px; min-height:40px; font-weight:600;">Send</button>
      </div>
    `;

    document.body.appendChild(box);
    registerEl(box);

    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.style.display = "none";
    box.appendChild(fileInput);

    const usernameSpan = box.querySelector("#book_username");
    if (usernameSpan) usernameSpan.textContent = username;

    const msgBox = box.querySelector("#chatMessages");
    const chatInputEl = box.querySelector("#chatInput");
    const minifyBtn = box.querySelector("#minifyChat");
    const closeBtn = box.querySelector("#closeChat");
    const callBtn = box.querySelector("#callBtn");
    const imageBtn = box.querySelector("#imageBtn");
    const imageInputRow = box.querySelector("#imageInputRow");
    const imageUrlInput = box.querySelector("#imageUrlInput");
    const imageUrlSend = box.querySelector("#imageUrlSend");
    const imageUploadBtn = box.querySelector("#imageUploadBtn");
    const imageUrlCancel = box.querySelector("#imageUrlCancel");
    const openRoomsBtn = box.querySelector("#openRoomsBtn");
    const openExploreBtn = box.querySelector("#openExploreBtn");
    const currentRoomDisplay = box.querySelector("#currentRoomDisplay");

    // new messages button
    const newMsgBtn = document.createElement("button");
    Object.assign(newMsgBtn.style, {
      position: "absolute", right: "12px", bottom: "12px",
      padding: "6px 10px", borderRadius: "12px", background: "#2f855a",
      color: "#fff", border: "none", display: "none", zIndex: 10, fontSize: "13px",
    });
    newMsgBtn.textContent = "New messages";
    newMsgBtn.onclick = () => { msgBox.scrollTop = msgBox.scrollHeight; newMsgBtn.style.display = "none"; };
    msgBox.appendChild(newMsgBtn);

    // --- Resize helper ---
    function makeResizable(el, minW = 280, minH = 320) {
      const handle = document.createElement("div");
      Object.assign(handle.style, {
        position: "absolute", right: "0", bottom: "0",
        width: "28px", height: "28px", cursor: "se-resize",
        display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
        padding: "6px", zIndex: 10, touchAction: "none",
      });
      handle.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M11 1L1 11M11 6L6 11M11 11" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" stroke-linecap="round"/></svg>`;
      el.appendChild(handle);
      let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;
      handle.addEventListener("pointerdown", e => {
        resizing = true; startX = e.clientX; startY = e.clientY;
        startW = el.offsetWidth; startH = el.offsetHeight;
        handle.setPointerCapture(e.pointerId); e.preventDefault();
      });
      handle.addEventListener("pointermove", e => {
        if (!resizing) return;
        el.style.width = Math.max(minW, startW + (e.clientX - startX)) + "px";
        el.style.height = Math.max(minH, startH + (e.clientY - startY)) + "px";
        e.preventDefault();
      });
      handle.addEventListener("pointerup", () => resizing = false);
    }

    makeResizable(box, 300, 400);

    // --- WS indicator ---
    function updateWsIndicator(connected) {
      const dot = box.querySelector("#wsIndicator");
      if (!dot) return;
      dot.style.background = connected ? "#68d391" : "#fc8181";
      dot.title = connected ? "Live connection" : "Reconnecting...";
    }

    // --- Call window state ---
    let callWindow = null;
    let remoteVideoEl = null;
    let localVideoEl = null;

    function updateCallStatus(msg) {
      if (!callWindow) return;
      const el = callWindow.querySelector("#callStatus");
      if (el) el.textContent = msg;
      if (msg.includes("🟢")) {
        const dot = callWindow.querySelector("#callDot");
        if (dot) dot.style.background = "#68d391";
        const waiting = callWindow.querySelector("#callWaiting");
        if (waiting) waiting.style.display = "none";
        const nameEl = callWindow.querySelector("#callHeaderName");
        if (nameEl && callWindow._peerName) nameEl.textContent = callWindow._peerName;
      }
    }

    // FIX 1: setRemoteStream now calls .play() and handles autoplay policy
    function setRemoteStream(stream) {
      if (!remoteVideoEl) return;
      remoteVideoEl.srcObject = stream;
      remoteVideoEl.volume = callWindow
        ? (Number(callWindow.querySelector("#volumeSlider")?.value) || 80) / 100
        : 0.8;
      remoteVideoEl.play().catch(() => {
        // Autoplay blocked — show tap-to-play button
        if (callWindow) {
          const unmuteBtn = callWindow.querySelector("#unmuteRemote");
          if (unmuteBtn) unmuteBtn.style.display = "flex";
        }
      });
      if (callWindow) {
        const waiting = callWindow.querySelector("#callWaiting");
        if (waiting) waiting.style.display = "none";
      }
    }

    function hideCallWindow() {
      if (callWindow) { try { callWindow.remove(); } catch (e) {} callWindow = null; remoteVideoEl = null; localVideoEl = null; }
    }

    // FIX 2: showCallWindow with volume slider + tap-to-play fallback + explicit .play() calls
    function showCallWindow(peerName, lStream) {
      if (callWindow) { try { callWindow.remove(); } catch (e) {} }

      callWindow = document.createElement("div");
      callWindow._peerName = peerName;
      Object.assign(callWindow.style, {
        position: "fixed", top: "20px", left: "20px",
        width: "min(92vw, 420px)", height: "min(85vh, 560px)",
        background: "linear-gradient(180deg, #0d0e12, #08090c)", borderRadius: "20px", zIndex: 1000001,
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        animation: "dole-fadeIn 0.3s ease",
      });

      callWindow.innerHTML = `
        <div id="callHeader" style="padding:12px 16px; background:rgba(0,0,0,0.3); display:flex; align-items:center; gap:10px; cursor:grab; user-select:none; flex-shrink:0; border-bottom:1px solid rgba(255,255,255,0.04);">
          <div style="width:8px; height:8px; border-radius:50%; background:#fc8181;" id="callDot"></div>
          <div style="flex:1; font-weight:700; font-size:14px; color:#e6eefc;" id="callHeaderName">Calling ${escapeHtml(peerName)}...</div>
          <div id="callStatus" style="font-size:11px; color:#9fb0e6; opacity:0.8;"></div>
          <button id="callCloseBtn" class="dole-btn" style="background:rgba(255,255,255,0.06); border:none; width:34px; height:34px; border-radius:10px; cursor:pointer; color:#9fb0e6; font-size:13px; display:flex; align-items:center; justify-content:center;">\u2715</button>
        </div>
        <div style="flex:1; position:relative; background:#000; overflow:hidden;">
          <video id="remoteVideo" autoplay playsinline style="width:100%; height:100%; object-fit:cover; display:block;"></video>
          <video id="localVideo" autoplay muted playsinline style="position:absolute; bottom:14px; right:14px; width:120px; height:90px; object-fit:cover; border-radius:12px; border:2px solid rgba(255,255,255,0.15); box-shadow:0 4px 12px rgba(0,0,0,0.5);"></video>
          <div id="callWaiting" style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; color:#e6eefc; background:radial-gradient(circle at center, rgba(88,101,242,0.08), transparent);">
            <div style="width:72px; height:72px; border-radius:50%; background:linear-gradient(135deg,#5865f2,#4752c4); display:flex; align-items:center; justify-content:center; font-size:32px; box-shadow:0 8px 24px rgba(88,101,242,0.3);">\ud83d\udc64</div>
            <div style="font-size:15px; opacity:0.7; font-weight:500;">Waiting for ${escapeHtml(peerName)}...</div>
          </div>
          <button id="unmuteRemote" class="dole-btn" style="display:none; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); padding:12px 20px; background:rgba(0,0,0,0.7); border:none; border-radius:12px; color:#fff; font-size:14px; cursor:pointer; align-items:center; gap:8px; backdrop-filter:blur(8px);">
            \ud83d\udd0a Tap to hear audio
          </button>
        </div>
        <div style="padding:8px 16px; background:rgba(0,0,0,0.3); display:flex; align-items:center; gap:10px; flex-shrink:0; border-top:1px solid rgba(255,255,255,0.04);">
          <span style="font-size:11px; color:#9fb0e6; white-space:nowrap;">\ud83d\udd0a</span>
          <input id="volumeSlider" type="range" min="0" max="100" value="80"
            style="flex:1; accent-color:#5865f2; cursor:pointer; height:4px;">
        </div>
        <div style="padding:16px; background:rgba(0,0,0,0.3); display:flex; gap:12px; justify-content:center; align-items:center; flex-shrink:0; border-top:1px solid rgba(255,255,255,0.04);">
          <button id="callMuteBtn" class="dole-btn" style="width:52px; height:52px; border-radius:50%; border:none; background:rgba(255,255,255,0.08); color:#fff; font-size:20px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.2s;">\ud83c\udf99\ufe0f</button>
          <button id="callVideoBtn" class="dole-btn" style="width:52px; height:52px; border-radius:50%; border:none; background:rgba(255,255,255,0.08); color:#fff; font-size:20px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.2s;">\ud83d\udcf7</button>
          <button id="callDeafenBtn" class="dole-btn" style="width:52px; height:52px; border-radius:50%; border:none; background:rgba(255,255,255,0.08); color:#fff; font-size:20px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.2s;">\ud83d\udd08</button>
          <button id="callEndBtn" class="dole-btn" style="width:64px; height:64px; border-radius:50%; border:none; background:linear-gradient(135deg,#e53e3e,#c53030); color:#fff; font-size:24px; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 16px rgba(229,62,62,0.4);">\ud83d\udcde</button>
        </div>
      `;

      document.body.appendChild(callWindow);
      makeResizable(callWindow, 300, 360);

      remoteVideoEl = callWindow.querySelector("#remoteVideo");
      localVideoEl  = callWindow.querySelector("#localVideo");

      // Play local stream immediately — muted so no echo
      if (lStream) {
        localVideoEl.srcObject = lStream;
        localVideoEl.play().catch(() => {});
      }

      // Drag
      const ch = callWindow.querySelector("#callHeader");
      let drag = false, ox = 0, oy = 0;
      ch.addEventListener("pointerdown", e => {
        if (e.target.tagName === "BUTTON") return;
        drag = true;
        ox = e.clientX - callWindow.getBoundingClientRect().left;
        oy = e.clientY - callWindow.getBoundingClientRect().top;
        ch.setPointerCapture(e.pointerId);
      });
      ch.addEventListener("pointermove", e => {
        if (!drag) return;
        callWindow.style.left = Math.max(0, Math.min(window.innerWidth  - callWindow.offsetWidth,  e.clientX - ox)) + "px";
        callWindow.style.top  = Math.max(0, Math.min(window.innerHeight - callWindow.offsetHeight, e.clientY - oy)) + "px";
        e.preventDefault();
      });
      ch.addEventListener("pointerup", () => drag = false);

      // Volume slider
      callWindow.querySelector("#volumeSlider").addEventListener("input", (e) => {
        if (remoteVideoEl) remoteVideoEl.volume = Number(e.target.value) / 100;
      });

      // Tap-to-play button (autoplay policy fallback)
      callWindow.querySelector("#unmuteRemote").addEventListener("click", () => {
        if (remoteVideoEl) {
          remoteVideoEl.play().catch(() => {});
          callWindow.querySelector("#unmuteRemote").style.display = "none";
        }
      });

      let muted = false, vidHidden = false, deafened = false;
      callWindow.querySelector("#callMuteBtn").addEventListener("click", () => {
        muted = !muted;
        if (chatController && chatController._localStream)
          chatController._localStream.getAudioTracks().forEach(t => t.enabled = !muted);
        callWindow.querySelector("#callMuteBtn").textContent = muted ? "🔇" : "🎙️";
        callWindow.querySelector("#callMuteBtn").style.background = muted ? "#e53e3e" : "rgba(255,255,255,0.08)";
      });
      callWindow.querySelector("#callVideoBtn").addEventListener("click", () => {
        vidHidden = !vidHidden;
        if (chatController && chatController._localStream)
          chatController._localStream.getVideoTracks().forEach(t => t.enabled = !vidHidden);
        callWindow.querySelector("#callVideoBtn").textContent = vidHidden ? "🚫" : "📷";
        callWindow.querySelector("#callVideoBtn").style.background = vidHidden ? "#e53e3e" : "rgba(255,255,255,0.08)";
      });
      callWindow.querySelector("#callDeafenBtn").addEventListener("click", () => {
        deafened = !deafened;
        if (remoteVideoEl) remoteVideoEl.muted = deafened;
        callWindow.querySelector("#callDeafenBtn").textContent = deafened ? "🔇" : "🔈";
        callWindow.querySelector("#callDeafenBtn").style.background = deafened ? "#e53e3e" : "rgba(255,255,255,0.08)";
      });

      const hasAudioTrack = !!(lStream && lStream.getAudioTracks && lStream.getAudioTracks().length > 0);
      const hasVideoTrack = !!(lStream && lStream.getVideoTracks && lStream.getVideoTracks().length > 0);
      if (!hasAudioTrack) {
        const muteBtn = callWindow.querySelector("#callMuteBtn");
        muteBtn.disabled = true;
        muteBtn.style.opacity = "0.5";
        muteBtn.title = "Microphone unavailable";
      }
      if (!hasVideoTrack) {
        const videoBtn = callWindow.querySelector("#callVideoBtn");
        videoBtn.disabled = true;
        videoBtn.style.opacity = "0.5";
        videoBtn.title = "Camera unavailable";
      }
      callWindow.querySelector("#callEndBtn").addEventListener("click",   () => chatController.endCall());
      callWindow.querySelector("#callCloseBtn").addEventListener("click", () => chatController.endCall());
    }

    // --- Incoming call banner ---
    const incomingBanner = document.createElement("div");
    incomingBanner.id = "incomingCallBanner";
    Object.assign(incomingBanner.style, {
      position: "absolute", left: "0", right: "0", top: "0",
      background: "linear-gradient(135deg, #1a2040, #1a3a28)",
      zIndex: 46, display: "none", flexDirection: "column",
      alignItems: "center", padding: "24px 16px", gap: "14px",
      borderRadius: "16px 16px 0 0",
      boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
      border: "1px solid rgba(255,255,255,0.08)",
      animation: "dole-fadeIn 0.25s ease",
    });
    incomingBanner.innerHTML = `
      <div style="width:56px; height:56px; border-radius:50%; background:linear-gradient(135deg,#2f855a,#276749); display:flex; align-items:center; justify-content:center; font-size:26px; box-shadow:0 6px 20px rgba(47,133,90,0.4);">\ud83d\udcde</div>
      <div id="incomingCallerName" style="font-size:16px; font-weight:700; color:#fff; text-align:center;"></div>
      <div style="font-size:12px; color:rgba(255,255,255,0.6); font-weight:500;">Incoming video call</div>
      <div style="display:flex; gap:12px; width:100%; justify-content:center; margin-top:4px;">
        <button id="acceptCallBtn" class="dole-btn" style="flex:1; max-width:140px; padding:14px; border-radius:12px; border:none; background:linear-gradient(135deg,#48bb78,#38a169); color:#1a202c; font-size:15px; font-weight:700; cursor:pointer; min-height:44px; box-shadow:0 4px 12px rgba(72,187,120,0.3);">Accept</button>
        <button id="rejectCallBtn" class="dole-btn" style="flex:1; max-width:140px; padding:14px; border-radius:12px; border:none; background:linear-gradient(135deg,#fc8181,#e53e3e); color:#1a202c; font-size:15px; font-weight:700; cursor:pointer; min-height:44px; box-shadow:0 4px 12px rgba(229,62,62,0.3);">Reject</button>
      </div>
    `;
    box.appendChild(incomingBanner);

    function showIncomingCallBanner(callerName) {
      incomingBanner.querySelector("#incomingCallerName").textContent = callerName + " is calling...";
      incomingBanner.style.display = "flex";
    }
    function hideIncomingCallBanner() { incomingBanner.style.display = "none"; }

    incomingBanner.querySelector("#acceptCallBtn").addEventListener("click", () => chatController.acceptCall());
    incomingBanner.querySelector("#rejectCallBtn").addEventListener("click", () => chatController.rejectCall());

    // --- User list panel ---
    let userListVisible = false;
    const userListPanel = document.createElement("div");
    userListPanel.id = "userListPanel";
    Object.assign(userListPanel.style, {
      position: "absolute", left: "0", right: "0", top: "0",
      background: "linear-gradient(180deg,#0d0e10,#111214)",
      zIndex: 45, display: "none", flexDirection: "column",
      borderRadius: "12px 12px 0 0", overflow: "hidden",
      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      border: "1px solid rgba(255,255,255,0.04)",
      transition: "transform 0.25s ease",
      transform: "translateY(-100%)",
    });
    userListPanel.innerHTML = `
      <div style="padding:14px 16px; background:#0d0e10; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.04);">
        <div style="font-weight:700; font-size:15px; color:#e6eefc;">📞 Call Someone</div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="startGroupCallBtn" style="padding:8px 14px; border-radius:8px; border:none; background:#5865f2; color:#fff; cursor:pointer; font-size:13px; font-weight:600; min-height:44px;">Group Call</button>
          <button id="closeUserList" style="background:#333; border:none; padding:8px 12px; border-radius:8px; cursor:pointer; color:#fff; font-size:14px; min-width:44px; min-height:44px;">✕</button>
        </div>
      </div>
      <div id="userListInner" style="padding:12px; display:flex; flex-direction:column; gap:10px; overflow-y:auto; max-height:280px; -webkit-overflow-scrolling:touch;"></div>
      <div id="userListEmpty" style="padding:20px; text-align:center; font-size:14px; color:#9fb0e6; opacity:0.8; display:none;">No other users online right now.</div>
    `;
    box.appendChild(userListPanel);

    function renderUserList() {
      const inner = userListPanel.querySelector("#userListInner");
      const empty = userListPanel.querySelector("#userListEmpty");
      const startGroupBtn = userListPanel.querySelector("#startGroupCallBtn");
      const users = chatController ? chatController.currentUsers : [];
      const activeGroupCallMembers = chatController ? chatController.activeGroupCallMembers : null;
      const callState = chatController ? chatController.callState : null;
      const inActiveGroupCall = callState === "active-group";
      const hasOngoingGroupCall = !!(activeGroupCallMembers && activeGroupCallMembers.size > 0);
      if (startGroupBtn) {
        startGroupBtn.textContent = inActiveGroupCall ? "In Group Call" : (hasOngoingGroupCall ? "Join Group" : "Group Call");
      }
      inner.innerHTML = "";

      // ── Active group call banner ──────────────────────────────────────────
      if (hasOngoingGroupCall) {
        const banner = document.createElement("div");
        Object.assign(banner.style, {
          display: "flex", flexDirection: "column", gap: "8px",
          padding: "12px", borderRadius: "10px",
          background: "linear-gradient(135deg, rgba(88,101,242,0.18), rgba(47,133,90,0.14))",
          border: "1px solid rgba(88,101,242,0.35)",
          marginBottom: "4px",
        });
        const memberList = [...activeGroupCallMembers].slice(0, 4).join(", ")
          + (activeGroupCallMembers.size > 4 ? ` +${activeGroupCallMembers.size - 4} more` : "");
        const titleText = inActiveGroupCall ? "You are in the room group call" : "Group call in progress";
        banner.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:8px; height:8px; border-radius:50%; background:#68d391; animation:dole-pulse 1.5s infinite;"></div>
            <div style="font-weight:700; font-size:14px; color:#e6eefc;">${titleText}</div>
          </div>
          <div style="font-size:12px; color:#9fb0e6;">${memberList}</div>
        `;
        if (!inActiveGroupCall) {
          const joinBtn = document.createElement("button");
          Object.assign(joinBtn.style, {
            padding: "12px", borderRadius: "10px", border: "none",
            background: "#5865f2", color: "#fff", cursor: "pointer",
            fontSize: "14px", fontWeight: "700", minHeight: "44px",
          });
          joinBtn.textContent = "Join group call";
          joinBtn.addEventListener("click", () => {
            hideUserList();
            chatController.acceptGroupCall();
          });
          banner.appendChild(joinBtn);
        }

        inner.appendChild(banner);
      }

      // ── Individual call buttons ───────────────────────────────────────────
      if (!users || users.length === 0) {
        if (inner.children.length === 0) {
          inner.style.display = "none";
          empty.style.display = "block";
        } else {
          inner.style.display = "flex";
          empty.style.display = "none";
        }
        return;
      }
      inner.style.display = "flex";
      empty.style.display = "none";

      for (const u of users) {
        const row = document.createElement("div");
        Object.assign(row.style, {
          display: "flex", alignItems: "center", gap: "12px", padding: "12px",
          borderRadius: "10px", background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.04)",
        });
        const avatar = document.createElement("div");
        Object.assign(avatar.style, {
          width: "40px", height: "40px", borderRadius: "50%", background: "#5865f2",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "18px", fontWeight: "700", color: "#fff", flexShrink: "0",
        });
        avatar.textContent = u.charAt(0).toUpperCase();
        row.appendChild(avatar);
        const name = document.createElement("div");
        name.style.flex = "1"; name.style.fontWeight = "600";
        name.style.fontSize = "15px"; name.style.color = "#e6eefc";
        name.textContent = u;
        row.appendChild(name);
        const callUserBtn = document.createElement("button");
        Object.assign(callUserBtn.style, {
          padding: "10px 16px", borderRadius: "10px", border: "none",
          background: "#2f855a", color: "#fff", cursor: "pointer",
          fontSize: "20px", minWidth: "50px", minHeight: "50px",
        });
        callUserBtn.textContent = "📞";
        callUserBtn.title = `Call ${u}`;
        callUserBtn.addEventListener("click", () => {
          hideUserList();
          chatController.startCall(u);
        });
        row.appendChild(callUserBtn);
        inner.appendChild(row);
      }
    }

    function showUserList() {
      userListVisible = true;
      userListPanel.style.display = "flex";
      requestAnimationFrame(() => { userListPanel.style.transform = "translateY(0)"; });
      renderUserList();
    }
    function hideUserList() {
      userListVisible = false;
      userListPanel.style.transform = "translateY(-100%)";
      setTimeout(() => { if (!userListVisible) userListPanel.style.display = "none"; }, 260);
    }
    userListPanel.querySelector("#closeUserList").addEventListener("click", hideUserList);
    userListPanel.querySelector("#startGroupCallBtn").addEventListener("click", () => {
      hideUserList();
      const members = chatController ? chatController.activeGroupCallMembers : null;
      const inGroup = chatController && chatController.callState === "active-group";
      if (!inGroup && members && members.size > 0) chatController.acceptGroupCall();
      else chatController.startGroupCall();
    });

    callBtn.addEventListener("click", () => {
      if (userListVisible) hideUserList(); else showUserList();
    });

    // --- Minify ---
    let minIcon = null;
    function createMinIcon() {
      const rect = box.getBoundingClientRect();
      const icon = document.createElement("div");
      Object.assign(icon.style, {
        position: "fixed",
        left: Math.max(8, rect.left + 8) + "px",
        top: Math.max(8, rect.top + 8) + "px",
        width: "52px", height: "52px",
        background: "linear-gradient(135deg, #5865f2, #4752c4)", color: "#fff",
        borderRadius: "16px", display: "flex",
        alignItems: "center", justifyContent: "center",
        zIndex: 1000000, cursor: "pointer",
        boxShadow: "0 8px 24px rgba(88,101,242,0.4)",
        fontSize: "22px", touchAction: "manipulation",
        animation: "dole-fadeIn 0.2s ease",
      });
      icon.title = "Restore Chat";
      icon.innerText = "\u2709";
      document.body.appendChild(icon);
      registerEl(icon);
      icon.onclick = () => {
        removeEl(icon); minIcon = null;
        box.style.display = "flex";
        chatController.resume();
        chatController.loadMessagesOnce().catch(() => {});
      };
      makeDraggable(icon, { threshold: 6 });
      return icon;
    }

    function minifyChat() {
      if (minIcon) return;
      minIcon = createMinIcon();
      box.style.display = "none";
      chatController.pause();
    }

    minifyBtn.onclick = () => minifyChat();

    closeBtn.onclick = () => {
      if (box._chatController) try { box._chatController.stop(); } catch (e) {}
      if (box._timeUpdater) { clearInterval(box._timeUpdater); box._timeUpdater = null; }
      if (minIcon) { removeEl(minIcon); minIcon = null; }
      hideCallWindow();
      removeEl(box);
    };

    // --- Rooms overlay ---
    const overlay = document.createElement("div");
    overlay.id = "roomOverlay";
    Object.assign(overlay.style, {
      position: "absolute", left: "6px", top: "64px", right: "6px", bottom: "72px",
      background: "rgba(12,13,15,0.98)", zIndex: 40, display: "none",
      alignItems: "center", justifyContent: "center", padding: "12px",
      borderRadius: "10px", boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
      border: "1px solid rgba(255,255,255,0.03)",
    });

    const modal = document.createElement("div");
    Object.assign(modal.style, {
      width: "100%", height: "100%", background: "transparent",
      borderRadius: "8px", padding: "6px", overflow: "auto",
      color: "#fff", display: "flex", flexDirection: "column", gap: "8px",
    });
    modal.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <strong style="font-size:15px;">Your Rooms</strong>
        <button id="closeRoomsOverlay" style="background:#444; border:none; padding:6px 8px; border-radius:8px; cursor:pointer; color:#fff;">Close</button>
      </div>
      <div id="roomsList" style="display:flex; flex-direction:column; gap:8px; margin-top:6px;"></div>
      <div style="display:flex; gap:8px; margin-top:auto;">
        <input id="newRoomNameInput" placeholder="New room name" style="flex:1; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,0.03); outline:none; font-size:14px; background:#0c0d0f; color:#fff;">
        <button id="addRoomBtn" style="padding:10px 12px; border-radius:10px; border:none; background:#2f855a; color:white; cursor:pointer;">Add</button>
        <button id="addAndSwitchBtn" style="padding:10px 12px; border-radius:10px; border:none; background:#2b6cb0; color:white; cursor:pointer;">Add+Switch</button>
      </div>
    `;
    overlay.appendChild(modal);
    box.appendChild(overlay);

    const roomsListEl = modal.querySelector("#roomsList");
    const closeRoomsOverlayBtn = modal.querySelector("#closeRoomsOverlay");
    const newRoomNameInput = modal.querySelector("#newRoomNameInput");
    const addRoomBtn = modal.querySelector("#addRoomBtn");
    const addAndSwitchBtn = modal.querySelector("#addAndSwitchBtn");

    const passwordOverlay = document.createElement("div");
    Object.assign(passwordOverlay.style, {
      position: "absolute", inset: "0",
      background: "rgba(12,13,15,0.95)", zIndex: "42",
      display: "none", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "24px", borderRadius: "16px",
      backdropFilter: "blur(8px)",
      color: "#fff",
    });
    const passwordModal = document.createElement("div");
    Object.assign(passwordModal.style, {
      background: "#111214", padding: "20px", borderRadius: "14px",
      display: "flex", flexDirection: "column", gap: "10px",
      color: "#fff", border: "1px solid rgba(255,255,255,0.06)",
      width: "min(90%, 300px)",
      boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
    });
    passwordModal.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong id="pwdModalTitle" style="font-size:15px; color:#e6eefc;">Enter password</strong>
        <button id="pwdModalClose" style="background:rgba(255,255,255,0.06); border:none; padding:6px 10px; border-radius:8px; cursor:pointer; color:#9fb0e6; font-size:14px;">✕</button>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <input id="pwdInput" type="password" placeholder="Room password" class="dole-input" style="padding:12px 14px; border-radius:10px; border:1px solid rgba(255,255,255,0.06); outline:none; font-size:14px; background:rgba(0,0,0,0.3); color:#fff; font-family:inherit;">
        <label style="font-size:13px; display:flex; gap:8px; align-items:center; color:#9fb0e6;"><input id="pwdRemember" type="checkbox"> Save to account</label>
        <div style="display:flex; gap:8px; margin-top:4px;">
          <button id="pwdSubmit" class="dole-btn" style="flex:1; padding:12px; border-radius:10px; border:none; background:linear-gradient(135deg,#2f855a,#276749); color:white; cursor:pointer; font-weight:600; font-size:14px;">Submit</button>
          <button id="pwdCancel" class="dole-btn" style="flex:1; padding:12px; border-radius:10px; border:none; background:rgba(255,255,255,0.08); color:#aaa; cursor:pointer; font-weight:600; font-size:14px;">Cancel</button>
        </div>
      </div>
    `;
    passwordOverlay.appendChild(passwordModal);
    box.appendChild(passwordOverlay);

    function showPasswordModal(title) {
      passwordOverlay.style.display = "flex";
      passwordModal.querySelector("#pwdModalTitle").textContent = title || "Enter password";
      passwordModal.querySelector("#pwdInput").value = "";
      passwordModal.querySelector("#pwdRemember").checked = true;
      setTimeout(() => { try { passwordModal.querySelector("#pwdInput").focus(); } catch (e) {} }, 50);
    }
    function hidePasswordModal() { passwordOverlay.style.display = "none"; }

    function promptPasswordForRoom(room, purpose = "access") {
      return new Promise((resolve) => {
        showPasswordModal(purpose === "claim" ? `Set password to claim "${room}"` : (purpose === "update-claim" ? `New password for "${room}"` : `Password for "${room}"`));
        const submit = () => {
          const pwd = passwordModal.querySelector("#pwdInput").value;
          const remember = !!passwordModal.querySelector("#pwdRemember").checked;
          hidePasswordModal();
          resolve({ password: pwd, remember });
        };
        const cancel = () => { hidePasswordModal(); resolve(null); };
        const closeBtn2 = passwordModal.querySelector("#pwdModalClose");
        const submitBtn = passwordModal.querySelector("#pwdSubmit");
        const cancelBtn = passwordModal.querySelector("#pwdCancel");
        function cleanup() {
          submitBtn.removeEventListener("click", submit);
          cancelBtn.removeEventListener("click", cancel);
          closeBtn2.removeEventListener("click", cancel);
        }
        submitBtn.addEventListener("click", () => { cleanup(); submit(); });
        cancelBtn.addEventListener("click", () => { cleanup(); cancel(); });
        closeBtn2.addEventListener("click", () => { cleanup(); cancel(); });
      });
    }

    function renderRoomsList() {
      roomsListEl.innerHTML = "";
      const rooms = loadRoomsList();
      if (!rooms || rooms.length === 0) {
        const p = document.createElement("div");
        p.style.opacity = "0.85"; p.style.fontSize = "13px";
        p.textContent = "No rooms yet. Add one below.";
        roomsListEl.appendChild(p);
        return;
      }
      for (const r of rooms) {
        const row = document.createElement("div");
        Object.assign(row.style, { display: "flex", gap: "8px", alignItems: "center", justifyContent: "space-between" });
        const left = document.createElement("div");
        left.style.display = "flex"; left.style.gap = "8px"; left.style.alignItems = "center";
        const hasPwd = (sessionRoomPasswords[r] && sessionRoomPasswords[r].length) || (userRoomPasswords[r] && userRoomPasswords[r].length);
        const lock = document.createElement("div");
        lock.textContent = hasPwd ? "🔒" : "🔓";
        lock.title = hasPwd ? "Has saved password" : "No saved password";
        left.appendChild(lock);
        const btn = document.createElement("button");
        btn.textContent = r; btn.title = `Switch to ${r}`;
        Object.assign(btn.style, { padding: "8px 10px", borderRadius: "8px", border: "none", background: r === currentRoom ? "#25393a" : "#131415", color: "#fff", cursor: "pointer", fontSize: "14px", flex: "1", minHeight: "44px" });
        btn.onclick = async () => { await switchRoom(r); hideRoomsOverlay(); };
        left.appendChild(btn);
        row.appendChild(left);
        const actions = document.createElement("div");
        actions.style.display = "flex"; actions.style.gap = "6px"; actions.style.alignItems = "center";
        const claimedInfo = claimedChatsMap[r];
        if (!claimedInfo || !claimedInfo.claimed_by) {
          const claimBtn = document.createElement("button");
          claimBtn.textContent = "Claim";
          Object.assign(claimBtn.style, { padding: "6px 8px", borderRadius: "8px", border: "none", background: "#2f855a", color: "#fff", cursor: "pointer", fontSize: "12px", minHeight: "44px" });
          claimBtn.onclick = async () => {
            const ans = await promptPasswordForRoom(r, "claim");
            if (!ans || !ans.password) return alert("Claim canceled (no password)");
            const res = await postClaimChat(token, r, ans.password);
            if (!res || !res.success) { alert("Claim failed: " + (res && res.error ? res.error : "unknown")); return; }
            userRoomPasswords = await fetchUserRoomPasswords(token);
            claimedChatsMap = await fetchClaimedChats();
            renderRoomsList();
            const proof = await fetchRoomProof(token, r);
            if (proof) alert(`Chat "${r}" claimed successfully.`); else alert(`Chat "${r}" claimed.`);
          };
          actions.appendChild(claimBtn);
        } else {
          const owner = claimedInfo.claimed_by;
          if (owner === username) {
            const manageBtn = document.createElement("button");
            manageBtn.textContent = "Manage";
            Object.assign(manageBtn.style, { padding: "6px 8px", borderRadius: "8px", border: "none", background: "#5865f2", color: "#fff", cursor: "pointer", fontSize: "12px", minHeight: "44px" });
            manageBtn.onclick = () => {
              const menu = document.createElement("div");
              Object.assign(menu.style, { position: "absolute", background: "#111", padding: "8px", borderRadius: "8px", right: "20px", zIndex: 99999, display: "flex", gap: "6px" });
              const change = document.createElement("button");
              change.textContent = "Change pwd";
              Object.assign(change.style, { padding: "6px 8px", borderRadius: "8px", border: "none", background: "#2f855a", color: "#fff", cursor: "pointer", fontSize: "12px", minHeight: "44px" });
              const unclaim = document.createElement("button");
              unclaim.textContent = "Unclaim";
              Object.assign(unclaim.style, { padding: "6px 8px", borderRadius: "8px", border: "none", background: "#a33", color: "#fff", cursor: "pointer", fontSize: "12px", minHeight: "44px" });
              menu.appendChild(change); menu.appendChild(unclaim);
              row.appendChild(menu);
              function cleanupMenu() { try { menu.remove(); } catch (e) {} }
              change.onclick = async () => {
                const ans = await promptPasswordForRoom(r, "update-claim");
                if (!ans || !ans.password) { cleanupMenu(); return alert("Canceled"); }
                const res = await postUpdateClaimPassword(token, r, ans.password);
                if (!res || !res.success) return alert("Update failed: " + (res && res.error ? res.error : "unknown"));
                userRoomPasswords = await fetchUserRoomPasswords(token);
                claimedChatsMap = await fetchClaimedChats();
                renderRoomsList(); cleanupMenu(); alert("Password updated");
                await fetchRoomProof(token, r);
              };
              unclaim.onclick = async () => {
                if (!confirm(`Unclaim "${r}"?`)) { cleanupMenu(); return; }
                const res = await postUnclaimChat(token, r);
                if (!res || !res.success) return alert("Unclaim failed: " + (res && res.error ? res.error : "unknown"));
                claimedChatsMap = await fetchClaimedChats();
                renderRoomsList(); cleanupMenu(); alert("Unclaimed");
                delete roomProofs[r];
              };
            };
            actions.appendChild(manageBtn);
          } else {
            const ownerLabel = document.createElement("div");
            ownerLabel.textContent = `claimed by ${owner}`;
            ownerLabel.style.opacity = "0.9"; ownerLabel.style.fontSize = "12px"; ownerLabel.style.color = "#ddd";
            actions.appendChild(ownerLabel);
          }
        }
        const del = document.createElement("button");
        del.textContent = "Remove";
        Object.assign(del.style, { padding: "6px 8px", borderRadius: "8px", border: "none", background: "#666", color: "#fff", cursor: "pointer", fontSize: "12px", minHeight: "44px" });
        del.onclick = () => { if (confirm(`Remove "${r}" from your library?`)) { removeRoomFromList(r); renderRoomsList(); } };
        actions.appendChild(del);
        row.appendChild(actions);
        roomsListEl.appendChild(row);
      }
    }

    function showRoomsOverlay() {
      renderRoomsList();
      overlay.style.display = "flex";
      const ex = box.querySelector("#explorePanel");
      if (ex) ex.remove();
      setTimeout(() => { try { newRoomNameInput.focus(); } catch (e) {} }, 50);
    }
    function hideRoomsOverlay() { overlay.style.display = "none"; }

    openRoomsBtn.addEventListener("click", () => showRoomsOverlay());
    closeRoomsOverlayBtn.addEventListener("click", () => hideRoomsOverlay());
    overlay.addEventListener("click", () => {});

    addRoomBtn.addEventListener("click", () => {
      const name = (newRoomNameInput.value || "").trim();
      if (!name) { newRoomNameInput.style.border = "1px solid #ff5555"; setTimeout(() => newRoomNameInput.style.border = "none", 1200); return; }
      addRoomToList(name); newRoomNameInput.value = ""; renderRoomsList();
    });
    addAndSwitchBtn.addEventListener("click", async () => {
      const name = (newRoomNameInput.value || "").trim();
      if (!name) { newRoomNameInput.style.border = "1px solid #ff5555"; setTimeout(() => newRoomNameInput.style.border = "none", 1200); return; }
      addRoomToList(name); newRoomNameInput.value = ""; renderRoomsList();
      await switchRoom(name); hideRoomsOverlay();
    });

    // --- Explore overlay ---
    function hideExploreOverlay() {
      const ex = box.querySelector("#explorePanel");
      if (ex) ex.remove();
    }

    async function showExploreOverlay() {
      try {
        const existing = box.querySelector("#explorePanel");
        if (existing) existing.remove();

        const ex = document.createElement("div");
        ex.id = "explorePanel";
        Object.assign(ex.style, {
          position: "absolute", left: "0", top: "0", right: "0", bottom: "0",
          zIndex: 50, display: "flex", flexDirection: "column",
          background: "#111214", borderRadius: "12px", overflow: "hidden",
        });

        const header = document.createElement("div");
        Object.assign(header.style, {
          padding: "12px 14px", background: "#0d0e10",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          display: "flex", alignItems: "center", gap: "10px", flexShrink: "0",
        });
        header.innerHTML = `
          <div style="font-size:15px; font-weight:700; color:#e6eefc; flex:1;">Explore Rooms</div>
          <button id="exploreClose" style="background:#333; border:none; padding:7px 12px; border-radius:8px; cursor:pointer; color:#fff; font-size:13px; min-height:44px;">Close</button>
        `;
        ex.appendChild(header);

        const searchRow = document.createElement("div");
        Object.assign(searchRow.style, { padding: "10px 14px 6px", flexShrink: "0", background: "#111214" });
        searchRow.innerHTML = `<input id="exploreSearch" placeholder="Search rooms..." style="width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.04); outline:none; font-size:14px; background:#0c0d0f; color:#fff;">`;
        ex.appendChild(searchRow);

        const pillsRow = document.createElement("div");
        Object.assign(pillsRow.style, {
          padding: "6px 14px 10px", display: "flex", gap: "8px",
          flexShrink: "0", background: "#111214",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        });
        function makePill(label, id) {
          const pill = document.createElement("button");
          pill.id = id; pill.textContent = label;
          Object.assign(pill.style, {
            padding: "8px 16px", borderRadius: "999px",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "transparent", color: "#9fb0e6",
            cursor: "pointer", fontSize: "13px", fontWeight: "600",
            minHeight: "44px",
          });
          return pill;
        }
        const recentPill = makePill("🕐 Recent", "pillRecent");
        const activePill = makePill("🔥 Most Active", "pillActive");
        pillsRow.appendChild(recentPill);
        pillsRow.appendChild(activePill);
        ex.appendChild(pillsRow);

        const listEl = document.createElement("div");
        Object.assign(listEl.style, {
          flex: "1", overflowY: "auto", padding: "10px 14px",
          display: "flex", flexDirection: "column", gap: "8px",
          WebkitOverflowScrolling: "touch",
        });
        ex.appendChild(listEl);
        box.appendChild(ex);

        const searchInput = ex.querySelector("#exploreSearch");
        const closeBtn2 = ex.querySelector("#exploreClose");

        let filterRecent = false, filterActive = false, allRooms = [], isLoading = false;

        function setPillActive(pill, active) {
          pill.style.background = active ? "#5865f2" : "transparent";
          pill.style.color = active ? "#fff" : "#9fb0e6";
          pill.style.borderColor = active ? "#5865f2" : "rgba(255,255,255,0.08)";
        }

        function getSortedRooms(rooms, query) {
          let list = rooms.slice();
          if (query && query.trim()) {
            const q = query.trim().toLowerCase();
            list = list.filter(r => String(r.room || "").toLowerCase().includes(q));
          }
          if (!filterRecent && !filterActive) return list.sort((a, b) => (Number(b.last_activity) || 0) - (Number(a.last_activity) || 0));
          if (filterRecent && !filterActive) return list.sort((a, b) => (Number(b.last_activity) || 0) - (Number(a.last_activity) || 0));
          if (filterActive && !filterRecent) return list.sort((a, b) => (Number(b.message_count) || 0) - (Number(a.message_count) || 0));
          const maxActivity = Math.max(...list.map(r => Number(r.last_activity) || 0), 1);
          const minActivity = Math.min(...list.map(r => Number(r.last_activity) || 0), 0);
          const maxCount = Math.max(...list.map(r => Number(r.message_count) || 0), 1);
          const activityRange = maxActivity - minActivity || 1;
          return list.sort((a, b) => {
            const sA = 0.5 * ((Number(a.last_activity) || 0) - minActivity) / activityRange + 0.5 * (Number(a.message_count) || 0) / maxCount;
            const sB = 0.5 * ((Number(b.last_activity) || 0) - minActivity) / activityRange + 0.5 * (Number(b.message_count) || 0) / maxCount;
            return sB - sA;
          });
        }

        function renderExploreList() {
          const query = searchInput.value || "";
          const sorted = getSortedRooms(allRooms, query);
          listEl.innerHTML = "";
          if (!sorted.length) {
            const empty = document.createElement("div");
            Object.assign(empty.style, { opacity: "0.6", fontSize: "14px", padding: "16px 0", textAlign: "center", color: "#9fb0e6" });
            empty.textContent = allRooms.length ? "No rooms match your search." : "No rooms found.";
            listEl.appendChild(empty);
            return;
          }
          for (const r of sorted) {
            const card = document.createElement("div");
            Object.assign(card.style, {
              display: "flex", alignItems: "center", gap: "12px", padding: "12px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
              border: "1px solid rgba(255,255,255,0.04)",
            });
            const icon = document.createElement("div");
            Object.assign(icon.style, {
              width: "40px", height: "40px", borderRadius: "12px", background: "#1e2030",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "18px", flexShrink: "0", border: "1px solid rgba(255,255,255,0.04)",
            });
            icon.textContent = "💬";
            card.appendChild(icon);
            const info = document.createElement("div");
            Object.assign(info.style, { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "3px" });
            const nameEl = document.createElement("div");
            Object.assign(nameEl.style, { fontWeight: "700", fontSize: "14px", color: "#e6eefc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
            nameEl.textContent = r.room;
            info.appendChild(nameEl);
            const statsEl = document.createElement("div");
            Object.assign(statsEl.style, { fontSize: "12px", color: "#7289da", display: "flex", gap: "8px", alignItems: "center" });
            const msgCount = document.createElement("span");
            msgCount.textContent = `💬 ${Number(r.message_count) || 0}`;
            statsEl.appendChild(msgCount);
            const dot2 = document.createElement("span");
            dot2.textContent = "·"; dot2.style.opacity = "0.4";
            statsEl.appendChild(dot2);
            const lastActive = document.createElement("span");
            lastActive.textContent = r.last_activity ? `🕐 ${timeAgoShort(new Date(Number(r.last_activity)))}` : "No activity";
            statsEl.appendChild(lastActive);
            info.appendChild(statsEl);
            const claimedInfo = claimedChatsMap[r.room];
            const badge = document.createElement("div");
            if (claimedInfo && claimedInfo.claimed_by) {
              Object.assign(badge.style, { fontSize: "11px", color: "#a0aec0", background: "rgba(255,255,255,0.04)", padding: "2px 8px", borderRadius: "999px", marginTop: "2px", display: "inline-block" });
              badge.textContent = `🔒 ${claimedInfo.claimed_by}`;
            } else {
              Object.assign(badge.style, { fontSize: "11px", color: "#68d391", background: "rgba(104,211,145,0.08)", padding: "2px 8px", borderRadius: "999px", marginTop: "2px", display: "inline-block" });
              badge.textContent = "✓ Open";
            }
            info.appendChild(badge);
            card.appendChild(info);
            const joinBtn = document.createElement("button");
            joinBtn.textContent = "Join";
            Object.assign(joinBtn.style, { padding: "10px 14px", borderRadius: "8px", border: "none", background: "#5865f2", color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: "600", minHeight: "44px" });
            joinBtn.addEventListener("click", async () => {
              addRoomToList(r.room);
              ex.remove();
              await switchRoom(r.room);
            });
            card.appendChild(joinBtn);
            listEl.appendChild(card);
          }
        }

        async function loadRooms() {
          if (isLoading) return;
          isLoading = true;
          listEl.innerHTML = `<div style="opacity:0.6; font-size:14px; padding:16px 0; text-align:center; color:#9fb0e6;">Loading...</div>`;
          try { allRooms = await fetchExplore(100, "last_activity"); } catch (e) { allRooms = []; }
          isLoading = false;
          renderExploreList();
        }

        closeBtn2.addEventListener("click", () => ex.remove());
        recentPill.addEventListener("click", () => { filterRecent = !filterRecent; setPillActive(recentPill, filterRecent); renderExploreList(); });
        activePill.addEventListener("click", () => { filterActive = !filterActive; setPillActive(activePill, filterActive); renderExploreList(); });
        let searchDebounce = null;
        searchInput.addEventListener("input", () => {
          clearTimeout(searchDebounce);
          searchDebounce = setTimeout(() => renderExploreList(), 250);
        });

        await loadRooms();
      } catch (err) {
        console.error("showExploreOverlay error:", err);
        alert("Could not open Explore.");
      }
    }

    if (openExploreBtn) {
      openExploreBtn.addEventListener("click", () => {
        try { showExploreOverlay(); } catch (e) { console.error(e); }
      });
    }

    // --- helpers ---
    function getRoomPassword(room) {
      if (sessionRoomPasswords[room]) return sessionRoomPasswords[room];
      if (userRoomPasswords[room]) return userRoomPasswords[room];
      return null;
    }

    // --- Group Call Window & Tile Management ---
    let groupCallWindow = null;
    let groupRemoteAudioMuted = false;
    let groupRemoteVolume = 1;

    function createVideoTile(peerId, label, muted = false) {
      const tile = document.createElement("div");
      tile.id = "tile-" + peerId;
      if (peerId !== "local") tile.dataset.peer = peerId;
      Object.assign(tile.style, {
        position: "relative", background: "#1a1b1e", borderRadius: "6px",
        overflow: "hidden", minHeight: "0", // critical for grid fill
      });
      const vid = document.createElement("video");
      vid.autoplay = true; vid.playsInline = true;
      if (muted) vid.muted = true;
      Object.assign(vid.style, {
        position: "absolute", inset: "0",
        width: "100%", height: "100%",
        objectFit: "cover", display: "block", background: "#000",
      });
      tile.appendChild(vid);

      // Avatar placeholder shown while video is loading/off
      const avatarEl = document.createElement("div");
      Object.assign(avatarEl.style, {
        position: "absolute", inset: "0",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#1a1b1e", fontSize: "32px", color: "#555", zIndex: 1,
      });
      avatarEl.textContent = label.charAt(0).toUpperCase();
      avatarEl.id = "avatar-" + peerId;
      tile.appendChild(avatarEl);

      vid.addEventListener("play",    () => { avatarEl.style.display = "none"; });
      vid.addEventListener("emptied", () => { avatarEl.style.display = "flex"; });

      const nameTag = document.createElement("div");
      Object.assign(nameTag.style, {
        position: "absolute", bottom: "8px", left: "8px", zIndex: 2,
        background: "rgba(0,0,0,0.6)", color: "#fff",
        fontSize: "11px", padding: "3px 8px", borderRadius: "4px",
        backdropFilter: "blur(4px)",
      });
      nameTag.textContent = label;
      tile.appendChild(nameTag);

      if (peerId !== "local") {
        const volWrap = document.createElement("div");
        Object.assign(volWrap.style, {
          position: "absolute", right: "8px", bottom: "8px", zIndex: 2,
          background: "rgba(0,0,0,0.65)", borderRadius: "8px",
          padding: "2px 6px", display: "flex", alignItems: "center", gap: "4px",
        });
        const icon = document.createElement("span");
        icon.textContent = "🔊";
        icon.style.fontSize = "10px";
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.value = String(Math.round(groupRemoteVolume * 100));
        Object.assign(slider.style, {
          width: "62px",
          accentColor: "#5865f2",
          cursor: "pointer",
        });
        slider.addEventListener("input", () => {
          groupRemoteVolume = Math.max(0, Math.min(1, Number(slider.value) / 100));
          vid.volume = groupRemoteVolume;
        });
        volWrap.appendChild(icon);
        volWrap.appendChild(slider);
        tile.appendChild(volWrap);
      }
      return tile;
    }

    function applyGroupRemoteAudioState() {
      if (!groupCallWindow) return;
      const remoteVideos = groupCallWindow.querySelectorAll("#gcVideoGrid [data-peer] video");
      for (const v of remoteVideos) {
        v.muted = groupRemoteAudioMuted;
        v.volume = groupRemoteVolume;
      }
    }

    function updateGridLayout() {
      if (!groupCallWindow) return;
      const grid = groupCallWindow.querySelector("#gcVideoGrid");
      if (!grid) return;
      const n = grid.children.length;

      let cols, rows;
      if      (n === 1) { cols = 1; rows = 1; }
      else if (n === 2) { cols = 2; rows = 1; }
      else if (n <= 4)  { cols = 2; rows = 2; }
      else if (n <= 6)  { cols = 3; rows = 2; }
      else if (n <= 9)  { cols = 3; rows = 3; }
      else              { cols = 4; rows = Math.ceil(n / 4); }

      grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      grid.style.gridTemplateRows    = `repeat(${rows}, 1fr)`;
      grid.style.padding = n === 1 ? "0" : "3px";
      grid.style.gap     = n === 1 ? "0" : "3px";

      const countEl = groupCallWindow.querySelector("#gcCount");
      if (countEl) countEl.textContent = `${n} participant${n !== 1 ? "s" : ""}`;
    }

    function addLocalTile() {
      if (!groupCallWindow) return;
      const grid = groupCallWindow.querySelector("#gcVideoGrid");
      if (grid.querySelector("#tile-local")) return;
      const tile = createVideoTile("local", username + " (you)", true);
      grid.appendChild(tile);
      const vid = tile.querySelector("video");
      if (chatController && chatController._localStream) {
        vid.srcObject = chatController._localStream;
        vid.play().catch(() => {});
      }
      updateGridLayout();
    }

    function addPeerTile(peerName, stream) {
      if (!groupCallWindow) return null;
      removePeerTile(peerName);
      const grid = groupCallWindow.querySelector("#gcVideoGrid");
      const tile = createVideoTile(peerName, peerName, false);
      if (stream) {
        const vid = tile.querySelector("video");
        vid.srcObject = stream;
        vid.muted = groupRemoteAudioMuted;
        vid.volume = groupRemoteVolume;
        vid.play().catch(() => {});
      }
      grid.appendChild(tile);
      updateGridLayout();
      applyGroupRemoteAudioState();
      return tile.querySelector("video");
    }

    function removePeerTile(peerName) {
      if (!groupCallWindow) return;
      const grid = groupCallWindow.querySelector("#gcVideoGrid");
      const el = grid.querySelector(`[data-peer="${CSS.escape(peerName)}"]`);
      if (el) el.remove();
      updateGridLayout();
    }

    function showGroupCallWindow() {
      if (groupCallWindow) { try { groupCallWindow.remove(); } catch (e) {} }
      groupRemoteAudioMuted = false;
      groupRemoteVolume = 1;
      groupCallWindow = document.createElement("div");
      Object.assign(groupCallWindow.style, {
        position: "fixed", top: "20px", left: "20px",
        width: "min(96vw, 720px)", height: "min(92vh, 600px)",
        background: "linear-gradient(180deg, #0d0e12, #08090c)", borderRadius: "20px", zIndex: 1000001,
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        animation: "dole-fadeIn 0.3s ease",
      });
      groupCallWindow.innerHTML = `
        <div id="gcHeader" style="padding:10px 16px; background:rgba(0,0,0,0.3); display:flex; align-items:center; gap:10px; cursor:grab; user-select:none; flex-shrink:0; border-bottom:1px solid rgba(255,255,255,0.04);">
          <div style="width:8px; height:8px; border-radius:50%; background:#68d391; flex-shrink:0; animation:dole-pulse 1.5s infinite;"></div>
          <div style="font-weight:700; font-size:14px; color:#e6eefc; flex:1;">Group Call</div>
          <div id="gcCount" style="font-size:12px; color:#9fb0e6;">1 participant</div>
          <button id="gcClose" class="dole-btn" style="background:rgba(255,255,255,0.06); border:none; width:34px; height:34px; border-radius:10px; cursor:pointer; color:#9fb0e6; font-size:13px; display:flex; align-items:center; justify-content:center; margin-left:8px;">\u2715</button>
        </div>
        <div id="gcVideoGrid" style="flex:1; display:grid; gap:3px; padding:3px; background:#000; overflow:hidden; align-items:stretch; justify-items:stretch;"></div>
        <div style="padding:12px 16px; background:rgba(0,0,0,0.3); display:flex; gap:10px; justify-content:center; align-items:center; flex-shrink:0; border-top:1px solid rgba(255,255,255,0.04);">
          <button id="gcMute" class="dole-btn" style="width:48px;height:48px;border-radius:50%;border:none;background:rgba(255,255,255,0.08);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;">\ud83c\udf99\ufe0f</button>
          <button id="gcVid" class="dole-btn" style="width:48px;height:48px;border-radius:50%;border:none;background:rgba(255,255,255,0.08);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;">\ud83d\udcf7</button>
          <button id="gcLeave" class="dole-btn" style="width:60px;height:60px;border-radius:50%;border:none;background:linear-gradient(135deg,#e53e3e,#c53030);color:#fff;font-size:21px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(229,62,62,0.4);">\ud83d\udcde</button>
        </div>
      `;
      document.body.appendChild(groupCallWindow);
      makeResizable(groupCallWindow, 320, 280);

      // Drag
      const gh = groupCallWindow.querySelector("#gcHeader");
      let drag = false, ox = 0, oy = 0;
      gh.addEventListener("pointerdown", e => {
        if (e.target.tagName === "BUTTON") return;
        drag = true;
        ox = e.clientX - groupCallWindow.getBoundingClientRect().left;
        oy = e.clientY - groupCallWindow.getBoundingClientRect().top;
        gh.setPointerCapture(e.pointerId);
      });
      gh.addEventListener("pointermove", e => {
        if (!drag) return;
        groupCallWindow.style.left = Math.max(0, Math.min(window.innerWidth  - groupCallWindow.offsetWidth,  e.clientX - ox)) + "px";
        groupCallWindow.style.top  = Math.max(0, Math.min(window.innerHeight - groupCallWindow.offsetHeight, e.clientY - oy)) + "px";
        e.preventDefault();
      });
      gh.addEventListener("pointerup", () => drag = false);

      let muted = false, vidOff = false, deafened = false;
      groupCallWindow.querySelector("#gcMute").addEventListener("click", () => {
        muted = !muted;
        if (chatController._localStream) chatController._localStream.getAudioTracks().forEach(t => t.enabled = !muted);
        const b = groupCallWindow.querySelector("#gcMute");
        b.textContent = muted ? "🔇" : "🎙️";
        b.style.background = muted ? "#e53e3e" : "rgba(255,255,255,0.08)";
      });
      groupCallWindow.querySelector("#gcVid").addEventListener("click", () => {
        vidOff = !vidOff;
        if (chatController._localStream) chatController._localStream.getVideoTracks().forEach(t => t.enabled = !vidOff);
        const b = groupCallWindow.querySelector("#gcVid");
        b.textContent = vidOff ? "🚫" : "📷";
        b.style.background = vidOff ? "#e53e3e" : "rgba(255,255,255,0.08)";
      });
      const deafenBtn = document.createElement("button");
      deafenBtn.id = "gcDeafen";
      deafenBtn.className = "dole-btn";
      Object.assign(deafenBtn.style, {
        width: "48px", height: "48px", borderRadius: "50%", border: "none",
        background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: "18px",
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 0.2s"
      });
      deafenBtn.textContent = "🔈";
      const leaveBtn = groupCallWindow.querySelector("#gcLeave");
      leaveBtn.parentNode.insertBefore(deafenBtn, leaveBtn);
      deafenBtn.addEventListener("click", () => {
        deafened = !deafened;
        groupRemoteAudioMuted = deafened;
        applyGroupRemoteAudioState();
        deafenBtn.textContent = deafened ? "🔇" : "🔈";
        deafenBtn.style.background = deafened ? "#e53e3e" : "rgba(255,255,255,0.08)";
      });
      groupCallWindow.querySelector("#gcLeave").addEventListener("click", () => chatController.leaveGroupCall());
      groupCallWindow.querySelector("#gcClose").addEventListener("click",  () => chatController.leaveGroupCall());

      addLocalTile();
    }

    // --- WebSocket + Chat Controller ---
    function makeWsController() {
      const SLOW_POLL_MS = 30000;
      const WS_RECONNECT_BASE = 2000;
      const WS_RECONNECT_MAX = 30000;
      const controllerRoom = currentRoom;

      let ws = null;
      let wsReconnectTimer = null;
      let wsReconnectDelay = WS_RECONNECT_BASE;
      let wsActive = true;
      let wsPaused = false;
      let pollTimer = null;
      let lastCount = 0;
      let lastMessages = [];
      let currentUsers = [];
      let callState = null;
      let callPeer = null;
      let peerConnection = null;
      let _localStream = null;
      let pendingOffer = null;
      let isGroupCall = false;
      let groupPeers  = new Map(); // username → { pc, stream, videoEl }
      let activeGroupCallMembers = new Set();
      let groupAnnounceTimer = null;

      function inferSender(msg) {
        if (!msg || typeof msg !== "object") return "";
        return String(msg._from || msg.from || msg.username || msg.user || "").trim();
      }
      function isSameRoomPayload(msg) {
        if (!msg || typeof msg !== "object") return true;
        const roomValue = msg.room || msg.room_name || msg.chat || msg.channel;
        if (roomValue === undefined || roomValue === null || roomValue === "") return true;
        return String(roomValue).trim() === controllerRoom;
      }

      const ICE_SERVERS = [
        { urls: "stun:stun.relay.metered.ca:80" },
        { urls: "turn:global.relay.metered.ca:80", username: "951956895909a9291fb1adb3", credential: "EGUb/agb91aFy24M" },
        { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "951956895909a9291fb1adb3", credential: "EGUb/agb91aFy24M" },
        { urls: "turn:global.relay.metered.ca:443", username: "951956895909a9291fb1adb3", credential: "EGUb/agb91aFy24M" },
        { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "951956895909a9291fb1adb3", credential: "EGUb/agb91aFy24M" },
      ];

      async function connectWs() {
        if (!wsActive || wsPaused) return;

        // Close the old socket before opening a new one.
        // Without this, the DO holds both connections and broadcasts to all of them.
        if (ws) {
          try { ws.close(1000, "reconnecting"); } catch (e) {}
          ws = null;
        }

        try {
          const proof = await fetchRoomProof(token, controllerRoom);
          if (!proof) { scheduleReconnect(); return; }
          const wsUrl = `${CHAT_BASE.replace("https://", "wss://").replace("http://", "ws://")}/room/${encodeURIComponent(controllerRoom)}?proof=${encodeURIComponent(proof)}`;
          ws = new WebSocket(wsUrl);
          ws.addEventListener("open",  () => { wsReconnectDelay = WS_RECONNECT_BASE; updateWsIndicator(true); });
          ws.addEventListener("message", (evt) => {
            try {
              const msg = JSON.parse(evt.data);
              if (!isSameRoomPayload(msg)) return;
              if (msg.type === "chat")                       handleIncomingChatMessage(msg);
              else if (msg.type === "presence")              handlePresence(msg.users || []);
              else if (msg.type && msg.type.startsWith("call-")) handleCallSignal(msg);
            } catch (e) {}
          });
          ws.addEventListener("close", () => { updateWsIndicator(false); if (wsActive && !wsPaused) scheduleReconnect(); });
          ws.addEventListener("error", () => {
            updateWsIndicator(false);
            try { ws.close(); } catch (e) {}
            if (wsActive && !wsPaused) scheduleReconnect();
          });
        } catch (e) { if (wsActive && !wsPaused) scheduleReconnect(); }
      }

      function scheduleReconnect() {
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(() => { wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, WS_RECONNECT_MAX); connectWs(); }, wsReconnectDelay);
      }

      function sendWs(data) {
        if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(data)); return true; }
        return false;
      }

      function closeWs() {
        if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
        if (ws) { try { ws.close(); } catch (e) {} ws = null; }
      }

      function handlePresence(users) {
        currentUsers = users.filter(u => u !== username);
        renderUserList();
      }

      // Tracks the last 50 message signatures to catch any duplicates that slip through
      const recentMsgIds = new Set();

      function handleIncomingChatMessage(msg) {
        if (!isSameRoomPayload(msg)) return;
        // Build a signature from username + text + timestamp (rounded to 2s to handle minor clock drift)
        const sig = `${msg.username}:${String(msg.text).slice(0, 80)}:${Math.round((msg.time || msg.ts || 0) / 2000)}`;
        if (recentMsgIds.has(sig)) return;
        recentMsgIds.add(sig);
        if (recentMsgIds.size > 50) {
          // Evict oldest entry — Set preserves insertion order
          recentMsgIds.delete(recentMsgIds.values().next().value);
        }

        const wasAtBottom = ctrl.isUserAtBottom();
        lastMessages.push(msg);
        const reaction = parseReaction(String(msg.text || ""));
        if (reaction) {
          const targetEl = msgBox.querySelector(`.dole-msg[data-msg-index="${reaction.targetIndex}"][data-msg-user="${CSS.escape(reaction.targetUser)}"]`);
          if (targetEl) {
            let reactRow = targetEl.querySelector(".dole-reaction-row");
            if (!reactRow) {
              reactRow = document.createElement("div");
              reactRow.className = "dole-reaction-row";
              Object.assign(reactRow.style, { display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "2px" });
              targetEl.appendChild(reactRow);
            }
            const reactions = collectReactionsForMessage(lastMessages, reaction.targetIndex, reaction.targetUser);
            reactRow.innerHTML = "";
            for (const [emoji, users] of reactions) {
              const badge = document.createElement("span");
              badge.className = "dole-reaction-badge" + (users.includes(username) ? " mine" : "");
              badge.textContent = emoji + " " + users.length;
              badge.title = users.join(", ");
              badge.addEventListener("click", () => {
                const reactText = makeReactMessage(emoji, reaction.targetUser, reaction.targetIndex);
                ctrl.sendMessage(reactText).catch(() => {});
              });
              reactRow.appendChild(badge);
            }
          }
        } else {
          appendMessageToContainer(msgBox, msg, lastMessages.length - 1, lastMessages, ctrl, username);
        }
        lastCount = lastMessages.length;
        if (wasAtBottom) { msgBox.scrollTop = msgBox.scrollHeight; newMsgBtn.style.display = "none"; }
        else newMsgBtn.style.display = "block";
        refreshTimestampsIn(msgBox);
      }

      async function slowPoll() {
        if (!wsActive || wsPaused) return;
        const roomAtPollStart = controllerRoom;
        try {
          const data = await ctrl.getMessages();
          if (!wsActive || wsPaused || controllerRoom !== roomAtPollStart || currentRoom !== controllerRoom) return;
          if (!data || !Array.isArray(data.messages)) return;
          const newMessages = data.messages;
          if (newMessages.length !== lastCount) {
            const wasAtBottom = ctrl.isUserAtBottom();
            msgBox.innerHTML = ""; msgBox.appendChild(newMsgBtn);
            newMessages.forEach((m, i) => appendMessageToContainer(msgBox, m, i, newMessages, ctrl, username));
            lastCount = newMessages.length; lastMessages = newMessages;
            if (wasAtBottom) msgBox.scrollTop = msgBox.scrollHeight;
          }
        } catch (e) {}
        if (wsActive) pollTimer = setTimeout(slowPoll, SLOW_POLL_MS);
      }

      function handleCallSignal(msg) {
        const fromUser = inferSender(msg);
        switch (msg.type) {
          case "call-offer":
            if (!fromUser) return;
            if (isGroupCall) { handleGroupOffer(fromUser, msg.sdp); return; }
            if (callState) return;
            callState = "incoming"; callPeer = fromUser; pendingOffer = msg.sdp;
            showIncomingCallBanner(fromUser);
            break;

          case "call-answer":
            if (!fromUser) return;
            if (isGroupCall) {
              const pd = groupPeers.get(fromUser);
              if (pd && pd.pc) pd.pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: msg.sdp }))
                .then(() => { if (pd.pc._flushIce) pd.pc._flushIce(); })
                .catch(e => console.error("group answer:", e));
              return;
            }
            if (callState === "outgoing" && peerConnection) {
              peerConnection.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: msg.sdp }))
                .then(() => { if (peerConnection._flushIce) peerConnection._flushIce(); })
                .catch(e => console.error("setRemoteDescription (answer):", e));
            }
            break;

          case "call-ice":
            if (!fromUser) return;
            if (isGroupCall) {
              const pd = groupPeers.get(fromUser);
              if (pd && pd.pc && msg.candidate) {
                if (pd.pc._queueOrAddIce) pd.pc._queueOrAddIce(msg.candidate);
                else pd.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
              }
              return;
            }
            if (peerConnection && msg.candidate) {
              if (peerConnection._queueOrAddIce) peerConnection._queueOrAddIce(msg.candidate);
              else peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(e => console.error(e));
            }
            break;

          case "call-end":
          case "call-reject":
            if (isGroupCall) { if (fromUser) handleGroupPeerLeft(fromUser); return; }
            endCall(msg.type === "call-reject" ? "rejected" : "ended");
            break;

          case "call-group-invite":
            if (!fromUser) return;
            if (callState) return;
            isGroupCall = true;
            callState = "incoming";
            callPeer = fromUser;
            activeGroupCallMembers = new Set(msg.members || [fromUser]);
            showIncomingCallBanner(`${fromUser} started a group call`);
            renderUserList();
            break;

          case "call-group-join":
            if (!fromUser) return;
            if (!isGroupCall || !callState) return;
            if (fromUser === username) return;
            activeGroupCallMembers.add(fromUser);
            handleNewGroupMember(fromUser);
            // Announce updated member list so any future joiner sees full picture
            sendWs({ type: "call-group-announce", members: [...activeGroupCallMembers, username] });
            break;

          case "call-group-leave":
            if (!fromUser) return;
            if (isGroupCall) {
              handleGroupPeerLeft(fromUser);
              activeGroupCallMembers.delete(fromUser);
            } else {
              activeGroupCallMembers.delete(fromUser);
              renderUserList();
            }
            break;

          case "call-group-announce":
            activeGroupCallMembers = new Set(msg.members || []);
            activeGroupCallMembers.delete(username);
            if (!callState) renderUserList(); // refresh panel to show join button
            break;

          case "call-group-ended":
            activeGroupCallMembers.clear();
            if (!callState) renderUserList();
            break;
        }
      }

      async function startCall(targetUsername) {
        if (callState) { alert("Already in a call"); return; }
        try {
          callState = "outgoing"; callPeer = targetUsername;
          _localStream = await getPreferredLocalMedia();
          if (_localStream.getAudioTracks().length === 0) alert("Mic not available. Call will be listen-only.");
          if (_localStream.getVideoTracks().length === 0) alert("Camera not available. Call will be audio-only.");
          peerConnection = createPeerConnection(targetUsername);
          _localStream.getTracks().forEach(t => peerConnection.addTrack(t, _localStream));
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          sendWs({ type: "call-offer", to: targetUsername, sdp: offer.sdp });
          showCallWindow(targetUsername, _localStream);
          minifyChat();
        } catch (e) { console.error("startCall error", e); endCall("error"); }
      }

      async function acceptCall_1to1() {
        if (callState !== "incoming" || !pendingOffer) return;
        hideIncomingCallBanner();
        try {
          _localStream = await getPreferredLocalMedia();
          if (_localStream.getAudioTracks().length === 0) alert("Mic not available. Call will be listen-only.");
          if (_localStream.getVideoTracks().length === 0) alert("Camera not available. Call will be audio-only.");
          peerConnection = createPeerConnection(callPeer);
          _localStream.getTracks().forEach(t => peerConnection.addTrack(t, _localStream));

          // Must come before setRemoteDescription so remoteVideoEl exists when ontrack fires
          showCallWindow(callPeer, _localStream);
          minifyChat();

          await peerConnection.setRemoteDescription(
            new RTCSessionDescription({ type: "offer", sdp: pendingOffer })
          );
          if (peerConnection._flushIce) peerConnection._flushIce();

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          sendWs({ type: "call-answer", to: callPeer, sdp: answer.sdp });
          callState = "active";
          pendingOffer = null;
        } catch (e) { console.error("acceptCall error", e); endCall("error"); }
      }

      function rejectCall() {
        if (callState !== "incoming") return;
        if (isGroupCall) {
          sendWs({ type: "call-group-leave" });
          hideIncomingCallBanner();
          callState = null; callPeer = null; isGroupCall = false;
          activeGroupCallMembers.clear();
          renderUserList();
        } else {
          sendWs({ type: "call-reject", to: callPeer });
          hideIncomingCallBanner();
          callState = null; callPeer = null; pendingOffer = null;
        }
      }

      function endCall(reason = "ended") {
        if (callPeer && callState && callState !== "ended") sendWs({ type: "call-end", to: callPeer });
        if (peerConnection) { try { peerConnection.close(); } catch (e) {} peerConnection = null; }
        if (_localStream) { _localStream.getTracks().forEach(t => t.stop()); _localStream = null; }
        callState = null; callPeer = null; pendingOffer = null;
        hideCallWindow();
        hideIncomingCallBanner();
        if (wsPaused) closeWs(); // now safe to close — call is done, chat is still minified
      }

      // --- Group call helpers ---
      function shouldOffer(myUser, theirUser) {
        return myUser < theirUser; // consistent on both sides — prevents offer collision
      }

      async function startGroupCall() {
        if (callState) { alert("Already in a call"); return; }
        if (activeGroupCallMembers.size > 0) {
          alert("A group call is already running in this room. Join it from the call panel.");
          return;
        }
        try {
          isGroupCall = true; callState = "active-group";
          _localStream = await getPreferredLocalMedia();
          if (_localStream.getAudioTracks().length === 0) alert("Mic not available. Group call will be listen-only.");
          if (_localStream.getVideoTracks().length === 0) alert("Camera not available. Group call will be audio-only.");
          showGroupCallWindow();
          minifyChat();
          activeGroupCallMembers.add(username);
          sendWs({ type: "call-group-invite", members: [...activeGroupCallMembers] });
          sendWs({ type: "call-group-announce", members: [...activeGroupCallMembers] });
          // Beacon every 8s so late-joiners see the call in the panel
          groupAnnounceTimer = setInterval(() => {
            if (callState === "active-group") {
              sendWs({ type: "call-group-announce", members: [...activeGroupCallMembers] });
            }
          }, 8000);
        } catch (e) {
          alert("Could not start group call: " + (e && e.message ? e.message : "check camera/mic"));
          callState = null; isGroupCall = false;
        }
      }

      async function acceptGroupCall() {
        if (callState && callState !== "incoming" && callState !== "active-group") {
          alert("Finish your current call before joining the group call.");
          return;
        }
        hideIncomingCallBanner();
        try {
          const existingMembers = [...activeGroupCallMembers].filter(m => m !== username);
          isGroupCall = true; callState = "active-group";
          _localStream = await getPreferredLocalMedia();
          if (_localStream.getAudioTracks().length === 0) alert("Mic not available. Group call will be listen-only.");
          if (_localStream.getVideoTracks().length === 0) alert("Camera not available. Group call will be audio-only.");
          showGroupCallWindow();
          minifyChat();
          activeGroupCallMembers.add(username);
          sendWs({ type: "call-group-join" }); // everyone in the call hears this and connects
          for (const member of existingMembers) {
            await handleNewGroupMember(member);
          }
        } catch (e) {
          alert("Could not join group call: " + (e && e.message ? e.message : "check camera/mic"));
          callState = null; isGroupCall = false;
        }
      }

      async function handleNewGroupMember(peerName) {
        if (groupPeers.has(peerName)) return;
        groupPeers.set(peerName, { pc: null, stream: null, videoEl: null });
        if (shouldOffer(username, peerName)) {
          const pc = createPeerConnection(peerName);
          groupPeers.get(peerName).pc = pc;
          if (_localStream) _localStream.getTracks().forEach(t => pc.addTrack(t, _localStream));
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendWs({ type: "call-offer", to: peerName, sdp: offer.sdp });
          } catch (e) { console.error("group offer error:", e); }
        }
        // else: wait — the other side will offer us (they apply the same rule)
      }

      async function handleGroupOffer(peerName, sdp) {
        if (!isGroupCall || !callState) return;
        let pd = groupPeers.get(peerName);
        if (!pd) { pd = { pc: null, stream: null, videoEl: null }; groupPeers.set(peerName, pd); }
        const pc = createPeerConnection(peerName);
        pd.pc = pc;
        if (_localStream) _localStream.getTracks().forEach(t => pc.addTrack(t, _localStream));
        try {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
          if (pc._flushIce) pc._flushIce();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWs({ type: "call-answer", to: peerName, sdp: answer.sdp });
        } catch (e) { console.error("handleGroupOffer error:", e); }
      }

      function handleGroupPeerLeft(peerName) {
        const pd = groupPeers.get(peerName);
        if (pd && pd.pc) { try { pd.pc.close(); } catch (e) {} }
        groupPeers.delete(peerName);
        removePeerTile(peerName);
      }

      function leaveGroupCall() {
        if (groupAnnounceTimer) { clearInterval(groupAnnounceTimer); groupAnnounceTimer = null; }
        activeGroupCallMembers.delete(username);
        const remaining = activeGroupCallMembers.size;
        sendWs({ type: remaining > 0 ? "call-group-leave" : "call-group-ended" });
        for (const [, pd] of groupPeers) {
          if (pd.pc) { try { pd.pc.close(); } catch (e) {} }
        }
        groupPeers.clear();
        activeGroupCallMembers.clear();
        if (_localStream) { _localStream.getTracks().forEach(t => t.stop()); _localStream = null; }
        callState = null; isGroupCall = false; callPeer = null; pendingOffer = null;
        if (groupCallWindow) { try { groupCallWindow.remove(); } catch (e) {} groupCallWindow = null; }
        hideIncomingCallBanner();
        if (wsPaused) closeWs();
        renderUserList(); // refresh panel to remove join button
      }

      // FIX 3 (core): createPeerConnection with ICE candidate queue + group call routing
      function createPeerConnection(targetUsername) {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        const iceCandidateQueue = [];
        let remoteDescSet = false;

        async function flushIceCandidates() {
          while (iceCandidateQueue.length) {
            const c = iceCandidateQueue.shift();
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
          }
        }

        pc._flushIce = async () => { remoteDescSet = true; await flushIceCandidates(); };
        pc._queueOrAddIce = async (candidate) => {
          if (!remoteDescSet) iceCandidateQueue.push(candidate);
          else { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {} }
        };

        pc.onicecandidate = (e) => {
          if (e.candidate) sendWs({ type: "call-ice", to: targetUsername, candidate: e.candidate });
        };
        pc.oniceconnectionstatechange = () => {
          const s = pc.iceConnectionState;
          if (!isGroupCall) {
            if (s === "connected" || s === "completed") { callState = "active"; updateCallStatus("🟢 Connected"); }
            if (s === "failed")       { updateCallStatus("❌ Connection failed"); endCall("failed"); }
            if (s === "disconnected") updateCallStatus("⚠️ Reconnecting...");
          }
        };
        pc.ontrack = (e) => {
          const stream = (e.streams && e.streams[0]) ? e.streams[0] : (() => {
            if (!pc._remoteStream) pc._remoteStream = new MediaStream();
            pc._remoteStream.addTrack(e.track);
            return pc._remoteStream;
          })();
          if (isGroupCall) {
            const pd = groupPeers.get(targetUsername);
            if (pd) {
              pd.stream = stream;
              if (pd.videoEl) { pd.videoEl.srcObject = stream; pd.videoEl.play().catch(() => {}); }
              else { pd.videoEl = addPeerTile(targetUsername, stream); }
            }
          } else {
            setRemoteStream(stream);
          }
        };
        return pc;
      }

      const ctrl = {
        get currentUsers()           { return currentUsers; },
        get callState()              { return callState; },
        get _localStream()           { return _localStream; },
        get activeGroupCallMembers() { return activeGroupCallMembers; },
        startCall,
        acceptCall() { if (isGroupCall) acceptGroupCall(); else acceptCall_1to1(); },
        rejectCall, endCall, startGroupCall, acceptGroupCall, leaveGroupCall,
        isUserAtBottom() {
          return (msgBox.scrollHeight - (msgBox.scrollTop + msgBox.clientHeight)) < 80;
        },
        async getMessages() {
          const url = `${CHAT_BASE}/room/${encodeURIComponent(controllerRoom)}/messages`;
          const proof = await fetchRoomProof(token, controllerRoom);
          const headers = {};
          if (token) headers.Authorization = token;
          if (proof) headers["X-Room-Auth"] = proof;
          const pwd = getRoomPassword(controllerRoom);
          if (pwd) headers["X-Room-Password"] = pwd;
          const res = await fetchWithTimeout(url, { headers }, 8000);
          if (res.status === 401 || res.status === 403) {
            const ans = await promptPasswordForRoom(controllerRoom, "access");
            if (!ans || !ans.password) throw new Error("Auth required");
            if (ans.remember) { const saved = await postSaveRoomPassword(token, controllerRoom, ans.password); if (saved) userRoomPasswords[controllerRoom] = ans.password; }
            else sessionRoomPasswords[controllerRoom] = ans.password;
            delete roomProofs[controllerRoom];
            const proof2 = await fetchRoomProof(token, controllerRoom);
            const headers2 = {};
            if (token) headers2.Authorization = token;
            if (proof2) headers2["X-Room-Auth"] = proof2;
            headers2["X-Room-Password"] = ans.password;
            const res2 = await fetchWithTimeout(url, { headers: headers2 }, 8000);
            if (res2.status === 401 || res2.status === 403) throw new Error("Auth failed");
            return res2.json();
          }
          return res.json();
        },
        async sendMessage(text) {
          const success = sendWs({ type: "chat", text });
          if (success) return { success: true };
          const url = `${CHAT_BASE}/room/${encodeURIComponent(controllerRoom)}/send`;
          const proof = await fetchRoomProof(token, controllerRoom);
          const headers = { "Content-Type": "application/json" };
          if (token) headers.Authorization = token;
          if (proof) headers["X-Room-Auth"] = proof;
          const pwd = getRoomPassword(controllerRoom);
          if (pwd) headers["X-Room-Password"] = pwd;
          const res = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify({ text }) }, 8000);
          if (res.status === 401 || res.status === 403) {
            delete roomProofs[controllerRoom];
            const ans = await promptPasswordForRoom(controllerRoom, "access");
            if (!ans || !ans.password) throw new Error("Auth required");
            if (ans.remember) { const saved = await postSaveRoomPassword(token, controllerRoom, ans.password); if (saved) userRoomPasswords[controllerRoom] = ans.password; }
            else sessionRoomPasswords[controllerRoom] = ans.password;
            const proof2 = await fetchRoomProof(token, controllerRoom);
            const headers2 = { "Content-Type": "application/json" };
            if (token) headers2.Authorization = token;
            if (proof2) headers2["X-Room-Auth"] = proof2;
            headers2["X-Room-Password"] = ans.password;
            const res2 = await fetchWithTimeout(url, { method: "POST", headers: headers2, body: JSON.stringify({ text }) }, 8000);
            if (res2.status === 401 || res2.status === 403) throw new Error("Auth failed");
            return res2.json();
          }
          return res.json();
        },
        async loadMessagesOnce({ forceScroll = false } = {}) {
          let data;
          try { data = await this.getMessages(); } catch (e) { return; }
          if (!data || !Array.isArray(data.messages)) return;
          const wasAtBottom = this.isUserAtBottom();
          msgBox.innerHTML = ""; msgBox.appendChild(newMsgBtn);
          data.messages.forEach((m, i) => appendMessageToContainer(msgBox, m, i, data.messages, this, username));
          lastCount = data.messages.length; lastMessages = data.messages;
          if (wasAtBottom || forceScroll) msgBox.scrollTop = msgBox.scrollHeight;
        },
        async start() {
          await this.loadMessagesOnce({ forceScroll: true });
          connectWs();
          pollTimer = setTimeout(slowPoll, SLOW_POLL_MS);
        },
        stop() {
          wsActive = false; wsPaused = true; closeWs();
          if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
        },
        pause() {
          wsPaused = true;
          if (!callState) closeWs(); // keep WS alive if a call is in progress
          if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
        },
        resume() {
          wsPaused = false; wsActive = true; connectWs();
          pollTimer = setTimeout(slowPoll, SLOW_POLL_MS);
        }
      };
      return ctrl;
    }

    // Initialize controller
    let chatController = makeWsController();
    box._chatController = chatController;
    await chatController.start();

    const TIMESTAMP_REFRESH_MS = 30 * 1000;
    box._timeUpdater = setInterval(() => refreshTimestampsIn(msgBox), TIMESTAMP_REFRESH_MS);
    refreshTimestampsIn(msgBox);

    // --- Send message ---
    async function doSendMessage(text) {
      if (!text) return;
      try {
        await chatController.sendMessage(text);
        newMsgBtn.style.display = "none";
        refreshTimestampsIn(msgBox);
      } catch (e) { alert("Send failed: " + (e && e.message ? e.message : "unknown")); }
    }

    // --- Image UI ---
    imageBtn.addEventListener("click", () => {
      if (imageInputRow.style.display === "none" || imageInputRow.style.display === "") {
        imageInputRow.style.display = "flex"; imageUrlInput.focus();
      } else { imageInputRow.style.display = "none"; }
    });
    imageUrlCancel.addEventListener("click", () => { imageInputRow.style.display = "none"; imageUrlInput.value = ""; });

    function validImageUrlCandidate(u) {
      if (!u || typeof u !== "string") return false;
      const t = u.trim();
      if (!t.length) return false;
      try {
        const url = new URL(t);
        if (!["http:", "https:"].includes(url.protocol)) return false;
        return IMG_EXT_RE.test(url.pathname);
      } catch (e) { return false; }
    }

    imageUrlSend.addEventListener("click", async () => {
      const url = imageUrlInput.value.trim();
      if (!validImageUrlCandidate(url)) { imageUrlInput.style.border = "1px solid #ff5555"; setTimeout(() => imageUrlInput.style.border = "none", 1500); return; }
      await doSendMessage(url);
      imageInputRow.style.display = "none"; imageUrlInput.value = "";
    });

    imageUploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const files = fileInput.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file.type || !file.type.startsWith("image/")) { alert("Please select an image file."); fileInput.value = ""; return; }
      if (!sessionImgBBKey) sessionImgBBKey = await fetchStoredKeyFromAccount(token);
      if (!sessionImgBBKey) {
        const entered = prompt("No ImgBB API key linked. Paste your ImgBB API key:");
        if (!entered || !entered.trim()) { alert("Upload canceled."); fileInput.value = ""; return; }
        const trimmedKey = entered.trim();
        const saved = await saveKeyToAccount(token, trimmedKey);
        if (!saved) {
          if (!confirm("Failed to save key. Use for this session only?")) { fileInput.value = ""; return; }
          sessionImgBBKey = trimmedKey;
        } else sessionImgBBKey = trimmedKey;
      }
      const prevText = imageUploadBtn.textContent;
      imageUploadBtn.disabled = true; imageUrlSend.disabled = true; imageUrlInput.disabled = true; imageUrlCancel.disabled = true;
      imageUploadBtn.textContent = "Uploading...";
      try {
        const fd = new FormData(); fd.append("file", file); fd.append("key", sessionImgBBKey);
        let res = await fetchWithTimeout(IMAGE_UPLOAD_WORKER, { method: "POST", body: fd }, 120000);
        if (res.status === 400) {
          const text = await res.text().catch(() => "");
          sessionImgBBKey = null;
          if (/key/i.test(text) || confirm("Upload failed (possible invalid key). Re-enter key?")) {
            const entered = prompt("Paste your ImgBB API key:");
            if (entered && entered.trim()) {
              const trimmedKey = entered.trim();
              const saved = await saveKeyToAccount(token, trimmedKey);
              if (!saved) { alert("Could not save key."); fileInput.value = ""; throw new Error("Failed to save key"); }
              sessionImgBBKey = trimmedKey;
              const fd2 = new FormData(); fd2.append("file", file); fd2.append("key", sessionImgBBKey);
              const res2 = await fetchWithTimeout(IMAGE_UPLOAD_WORKER, { method: "POST", body: fd2 }, 120000);
              if (!res2.ok) throw new Error("Upload error: " + res2.status);
              const data2 = await res2.json().catch(() => null);
              const url2 = data2 && (data2.url || (data2.data && data2.data.url));
              if (!url2) throw new Error("No URL returned");
              await doSendMessage(url2);
              imageInputRow.style.display = "none"; imageUrlInput.value = "";
              return;
            } else throw new Error("No key entered");
          } else throw new Error("Upload rejected");
        } else {
          if (!res.ok) { const text = await res.text().catch(() => ""); throw new Error("Upload returned " + res.status + " " + text); }
          const data = await res.json().catch(() => null);
          const url = data && (data.url || (data.data && data.data.url));
          if (!url) throw new Error("No URL returned");
          await doSendMessage(url);
          imageInputRow.style.display = "none"; imageUrlInput.value = "";
        }
      } catch (err) {
        alert("Upload failed: " + (err && err.message ? err.message : "unknown"));
      } finally {
        imageUploadBtn.disabled = false; imageUrlSend.disabled = false; imageUrlInput.disabled = false; imageUrlCancel.disabled = false;
        imageUploadBtn.textContent = prevText || "Upload"; fileInput.value = "";
      }
    });

    imageBtn.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      if (!sessionImgBBKey) { alert("No ImgBB key cached."); return; }
      if (confirm("Clear cached ImgBB key for this session?")) { sessionImgBBKey = null; alert("Cleared."); }
    }, { passive: false });

    // --- Switch room ---
    async function switchRoom(newRoomName) {
      if (!newRoomName || !newRoomName.trim()) { alert("Room name required"); return; }
      const trimmed = newRoomName.trim();
      if (trimmed === currentRoom) { currentRoomDisplay.textContent = `# ${currentRoom}`; return; }
      chatController.stop();
      if (box._timeUpdater) { clearInterval(box._timeUpdater); box._timeUpdater = null; }
      msgBox.innerHTML = ""; msgBox.appendChild(newMsgBtn);
      currentRoom = trimmed;
      try { localStorage.setItem("dole_chat_room", currentRoom); } catch (e) {}
      if (currentRoomDisplay) currentRoomDisplay.textContent = `# ${currentRoom}`;
      addRoomToList(currentRoom);
      chatController = makeWsController();
      box._chatController = chatController;
      await chatController.start();
      box._timeUpdater = setInterval(() => refreshTimestampsIn(msgBox), TIMESTAMP_REFRESH_MS);
      refreshTimestampsIn(msgBox);
    }

    // --- Wire send ---
    box.querySelector("#chatSend").onclick = async () => {
      const text = chatInputEl.value.trim();
      if (!text) return;
      await doSendMessage(text);
      chatInputEl.value = "";
    };
    chatInputEl.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const text = chatInputEl.value.trim();
        if (!text) return;
        await doSendMessage(text);
        chatInputEl.value = "";
      }
    });

    // --- Mutation observer for cleanup ---
    const observer = new MutationObserver(() => {
      if (!document.body.contains(box)) {
        if (box._chatController) try { box._chatController.stop(); } catch (e) {}
        if (box._timeUpdater) { clearInterval(box._timeUpdater); box._timeUpdater = null; }
        if (minIcon && !document.body.contains(minIcon)) minIcon = null;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    box.switchRoom = switchRoom;
    addRoomToList(currentRoom);
    renderRoomsList();
    setTimeout(() => { try { chatInputEl.focus(); } catch (e) {} }, 300);
  }

  // --- ImgBB key helpers ---
  async function fetchStoredKeyFromAccount(token) {
    try {
      const res = await fetchWithTimeout(`${ACCOUNT_BASE}/user/imgbb-key`, { method: "GET", headers: { Authorization: token } }, 8000);
      if (!res.ok) return null;
      const j = await res.json().catch(() => null);
      if (j && j.success === true && j.key) return String(j.key);
      return null;
    } catch (e) { return null; }
  }
  async function saveKeyToAccount(token, key) {
    try {
      const res = await fetchWithTimeout(`${ACCOUNT_BASE}/user/imgbb-key`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({ key })
      }, 8000);
      if (!res.ok) throw new Error("Server returned " + res.status);
      const j = await res.json().catch(() => null);
      if (!j || j.success !== true) throw new Error((j && j.error) ? j.error : "Unknown error");
      return true;
    } catch (e) { return false; }
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[s]);
  }

})();
})();
