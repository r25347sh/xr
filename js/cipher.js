(function () {
  "use strict";
  var peer = null, conn = null, started = false, cryptoKey = null;
  function el(id) { return document.getElementById(id); }
  function toast(m) { if (window.G5Peer) G5Peer.toast(m); }
  function status(n, t, c) { if (window.G5Peer) G5Peer.status(n, t, c); }

  function boot() {
    if (started) return;
    var g = window.__G5_XR__;
    if (!g || !g.ok) return;
    started = true;
    init(!!g.joinOnly);
  }
  window.addEventListener("g5-xr-ready", boot);
  setTimeout(boot, 50);

  function init(joinOnly) {
    if (joinOnly) {
      el("mode-tabs").classList.add("hidden");
      el("panel-host").classList.add("hidden");
      el("panel-join").classList.remove("hidden");
    }
    document.querySelectorAll(".mode-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        if (joinOnly) return;
        var m = tab.getAttribute("data-mode");
        document.querySelectorAll(".mode-tab").forEach(function (t) {
          t.classList.toggle("active", t.getAttribute("data-mode") === m);
        });
        el("panel-host").classList.toggle("hidden", m !== "host");
        el("panel-join").classList.toggle("hidden", m !== "join");
      });
    });
    el("btn-host").addEventListener("click", startHost);
    el("btn-host-stop").addEventListener("click", stopAll);
    el("btn-join").addEventListener("click", function () { join(el("room-input").value); });
    el("btn-copy").addEventListener("click", function () { G5Peer.copyText(el("share-url").value); });
    el("chat-form").addEventListener("submit", onSend);
    var r = new URLSearchParams(location.search).get("r");
    if (r) {
      el("panel-host").classList.add("hidden");
      el("panel-join").classList.remove("hidden");
      el("room-input").value = r;
      G5Peer.waitPeer(function () { join(r); });
    }
  }

  function bufToB64(buf) {
    var u = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }
  function b64ToBuf(b64) {
    var s = atob(b64);
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  }

  async function deriveKey(pass) {
    var enc = new TextEncoder();
    var salt = enc.encode("g5-xr-cipher-v1");
    var base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encrypt(text) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, cryptoKey, new TextEncoder().encode(text));
    return { iv: bufToB64(iv), ct: bufToB64(ct) };
  }

  async function decrypt(ivB64, ctB64) {
    var pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(ivB64)) },
      cryptoKey,
      b64ToBuf(ctB64)
    );
    return new TextDecoder().decode(pt);
  }

  function addMsg(text, kind) {
    var log = el("chat-log");
    var div = document.createElement("div");
    div.className = "msg " + (kind || "sys");
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function destroy() {
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    cryptoKey = null;
    el("stage").classList.add("hidden");
    var b = el("badge");
    if (b) { b.textContent = "offline"; b.classList.remove("on"); }
  }

  function wire(c) {
    conn = c;
    c.on("open", function () {
      el("stage").classList.remove("hidden");
      var b = el("badge");
      if (b) { b.textContent = "online"; b.classList.add("on"); }
      el("chat-input").disabled = false;
      el("btn-send").disabled = false;
      addMsg("connected · messages encrypted", "sys");
      toast("connected");
    });
    c.on("data", async function (raw) {
      try {
        var d = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (d.type === "c" && d.iv && d.ct) {
          try {
            var text = await decrypt(d.iv, d.ct);
            addMsg(text, "them");
          } catch (e) {
            addMsg("[decrypt failed — wrong passphrase?]", "sys");
          }
        }
      } catch (e) {}
    });
    c.on("close", function () {
      var b = el("badge");
      if (b) { b.textContent = "offline"; b.classList.remove("on"); }
      addMsg("disconnected", "sys");
    });
  }

  async function onSend(e) {
    e.preventDefault();
    var text = (el("chat-input").value || "").trim();
    if (!text || !conn || !conn.open || !cryptoKey) return;
    try {
      var enc = await encrypt(text);
      conn.send(JSON.stringify({ type: "c", iv: enc.iv, ct: enc.ct }));
      addMsg(text, "me");
      el("chat-input").value = "";
    } catch (err) {
      toast("encrypt error");
    }
  }

  function startHost() {
    destroy();
    var pass = el("host-pass").value;
    if (!pass) { status(el("host-status"), "passphrase required", "err"); return; }
    G5Peer.waitPeer(async function () {
      cryptoKey = await deriveKey(pass);
      peer = G5Peer.makePeer();
      peer.on("open", function (id) {
        el("share-url").value = G5Peer.buildShare(id);
        el("host-info").classList.remove("hidden");
        el("btn-host").classList.add("hidden");
        el("btn-host-stop").classList.remove("hidden");
        status(el("host-status"), "waiting…", "wait");
      });
      peer.on("connection", function (c) {
        if (conn && conn.open) { try { c.close(); } catch (e) {} return; }
        wire(c);
        status(el("host-status"), "connected", "ok");
      });
    });
  }

  function stopAll() {
    destroy();
    el("host-info").classList.add("hidden");
    el("btn-host").classList.remove("hidden");
    el("btn-host-stop").classList.add("hidden");
    status(el("host-status"), "", "");
    el("chat-log").innerHTML = "";
  }

  function join(id) {
    id = (id || "").trim();
    if (!id) return;
    var pass = el("join-pass").value;
    if (!pass) { status(el("join-status"), "passphrase required", "err"); return; }
    destroy();
    G5Peer.waitPeer(async function () {
      cryptoKey = await deriveKey(pass);
      peer = G5Peer.makePeer();
      peer.on("open", function () {
        wire(peer.connect(id, { reliable: true }));
        status(el("join-status"), "connecting…", "wait");
      });
    });
  }
})();
