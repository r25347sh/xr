(function () {
  "use strict";
  var CHUNK = 16 * 1024;
  var peer = null, conn = null, mediaCall = null, localStream = null;
  var myName = "Me", peerName = "Peer";
  var selectedFile = null, recvChunks = [], recvMeta = null, recvGot = 0;
  var hostPass = "", started = false, isHost = false;
  var typingTimer = null, pingTimer = null;
  var exportLog = [];

  function el(id) { return document.getElementById(id); }
  function toast(msg) {
    if (window.G5Peer && G5Peer.toast) return G5Peer.toast(msg);
    var t = el("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._tm);
    toast._tm = setTimeout(function () { t.classList.remove("show"); }, 1600);
  }
  function status(node, text, cls) {
    if (!node) return;
    node.textContent = text || "";
    node.className = "status" + (cls ? " " + cls : "");
  }
  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!beep.ctx) beep.ctx = new Ctx();
      var ctx = beep.ctx;
      if (ctx.state === "suspended") ctx.resume();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.04;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      o.stop(ctx.currentTime + 0.13);
    } catch (e) {}
  }

  function boot() {
    if (started) return;
    var g = window.__G5_XR__;
    if (!g || !g.ok) return;
    started = true;
    initUI(!!g.joinOnly);
  }
  window.addEventListener("g5-xr-ready", boot);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 40); });
  } else setTimeout(boot, 40);

  function initUI(joinOnly) {
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
    el("btn-host-stop").addEventListener("click", stopHost);
    el("btn-join").addEventListener("click", function () { joinRoom(el("room-input").value); });
    el("btn-copy").addEventListener("click", function () {
      if (window.G5Peer) G5Peer.copyText(el("share-url").value);
      else toast("copy");
    });
    el("chat-form").addEventListener("submit", onSendChat);
    el("file-input").addEventListener("change", function () {
      selectedFile = el("file-input").files && el("file-input").files[0];
      if (selectedFile) toast(selectedFile.name);
    });
    el("btn-file").addEventListener("click", sendFile);
    el("btn-screen").addEventListener("click", startScreen);
    el("btn-dice").addEventListener("click", function () { sendGame("dice"); });
    el("btn-coin").addEventListener("click", function () { sendGame("coin"); });
    el("btn-clip").addEventListener("click", sendClipboard);
    el("chat-input").addEventListener("input", function () {
      if (!conn || !conn.open) return;
      sendJson({ type: "typing" });
    });

    var stage = el("stage");
    stage.addEventListener("dragover", function (e) { e.preventDefault(); });
    stage.addEventListener("drop", function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      selectedFile = f;
      toast("ready: " + f.name);
      el("btn-file").disabled = !conn || !conn.open;
    });

    var room = new URLSearchParams(location.search).get("r");
    if (room) {
      if (!joinOnly) {
        document.querySelectorAll(".mode-tab").forEach(function (t) {
          t.classList.toggle("active", t.getAttribute("data-mode") === "join");
        });
        el("panel-host").classList.add("hidden");
        el("panel-join").classList.remove("hidden");
      }
      el("room-input").value = room;
      waitPeer(function () { joinRoom(room); });
    }
  }

  function waitPeer(cb) {
    if (window.G5Peer) return G5Peer.waitPeer(cb);
    var n = 0;
    (function tick() {
      if (typeof Peer !== "undefined") return cb();
      if (++n > 80) return status(el("join-status"), "peerjs failed", "err");
      setTimeout(tick, 100);
    })();
  }
  function makePeer() {
    if (window.G5Peer) return G5Peer.makePeer();
    return new Peer({
      debug: 0,
      config: { iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]}
    });
  }
  function sendJson(obj) {
    if (!conn || !conn.open) return;
    try { conn.send(JSON.stringify(obj)); } catch (e) {}
  }
  function destroyMedia() {
    if (mediaCall) { try { mediaCall.close(); } catch (e) {} mediaCall = null; }
    if (localStream) {
      localStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      localStream = null;
    }
    var rv = el("remote-video");
    if (rv) rv.srcObject = null;
    el("screen-wrap").classList.add("hidden");
  }
  function destroy() {
    stopPing();
    destroyMedia();
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    setStage(false);
    var b = el("badge");
    if (b) { b.textContent = "offline"; b.classList.remove("on"); }
    if (el("peer-label")) el("peer-label").textContent = "—";
    if (el("typing")) el("typing").textContent = "";
    if (el("rtt")) el("rtt").textContent = "";
  }
  function buildShare(id) {
    if (window.G5Peer) return G5Peer.buildShare(id);
    var u = new URL(location.href);
    u.search = "?r=" + encodeURIComponent(id);
    return u.toString();
  }
  function renderQr(url) {
    if (window.G5Peer) return G5Peer.renderQr(el("qr-box"), url);
  }
  function addMsg(text, kind, who, extra) {
    var log = el("chat-log");
    if (!log) return;
    var div = document.createElement("div");
    div.className = "msg " + (kind || "sys");
    if (who && kind !== "sys") {
      var w = document.createElement("span");
      w.className = "who";
      w.textContent = who;
      div.appendChild(w);
    }
    if (text) div.appendChild(document.createTextNode(text));
    if (extra) div.appendChild(extra);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    exportLog.push({ t: Date.now(), kind: kind || "sys", who: who || "", text: text || "" });
    if (kind === "them") beep();
  }
  function setStage(on) {
    el("stage").classList.toggle("hidden", !on);
    ["chat-input", "btn-send", "btn-file", "btn-screen", "btn-dice", "btn-coin", "btn-clip"].forEach(function (id) {
      if (el(id)) el(id).disabled = !on;
    });
    if (on) el("chat-input").focus();
  }
  function startPing() {
    stopPing();
    pingTimer = setInterval(function () {
      if (!conn || !conn.open) return;
      sendJson({ type: "ping", t: Date.now() });
    }, 4000);
  }
  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  function wireConn(c, role) {
    conn = c;
    isHost = role === "host";
    c.on("open", function () {
      setStage(true);
      var b = el("badge");
      if (b) { b.textContent = "online"; b.classList.add("on"); }
      if (el("peer-label")) el("peer-label").textContent = peerName;
      addMsg("connected", "sys");
      sendJson({
        type: "hello",
        name: myName,
        pass: role === "join" ? (el("join-pass").value || "") : undefined
      });
      if (role === "host") status(el("host-status"), "connected", "ok");
      else status(el("join-status"), "connected", "ok");
      startPing();
    });
    c.on("data", handleData);
    c.on("close", function () {
      addMsg("peer disconnected", "sys");
      var b = el("badge");
      if (b) { b.textContent = "offline"; b.classList.remove("on"); }
      destroyMedia();
      setStage(false);
      stopPing();
      if (role === "host") status(el("host-status"), "peer left · waiting", "wait");
      else status(el("join-status"), "disconnected", "err");
    });
    c.on("error", function () {
      if (role === "host") status(el("host-status"), "error", "err");
      else status(el("join-status"), "error", "err");
    });
  }

  function handleData(raw) {
    if (raw instanceof ArrayBuffer || (ArrayBuffer.isView && ArrayBuffer.isView(raw))) {
      if (!recvMeta) return;
      var buf = raw instanceof ArrayBuffer ? raw : raw.buffer;
      recvChunks.push(buf);
      recvGot += buf.byteLength || raw.byteLength || 0;
      var pct = recvMeta.size ? Math.min(100, (recvGot / recvMeta.size) * 100) : 0;
      el("prog").classList.remove("hidden");
      el("bar").style.width = pct + "%";
      if (recvGot >= recvMeta.size) {
        var blob = new Blob(recvChunks, { type: recvMeta.mime || "application/octet-stream" });
        finishRecv(blob, recvMeta);
        recvChunks = []; recvMeta = null; recvGot = 0;
      }
      return;
    }
    var data = raw;
    try { if (typeof raw === "string") data = JSON.parse(raw); }
    catch (e) { data = { type: "chat", text: String(raw) }; }
    if (!data || !data.type) return;

    if (data.type === "hello") {
      if (isHost && hostPass) {
        if ((data.pass || "") !== hostPass) {
          addMsg("peer rejected (bad passphrase)", "sys");
          sendJson({ type: "auth", ok: false });
          try { conn.close(); } catch (e) {}
          return;
        }
        sendJson({ type: "auth", ok: true });
      }
      peerName = (data.name && String(data.name).trim()) || "Peer";
      if (el("peer-label")) el("peer-label").textContent = peerName;
      addMsg(peerName + " joined", "sys");
      return;
    }
    if (data.type === "auth") {
      if (data.ok === false) {
        status(el("join-status"), "wrong passphrase", "err");
        addMsg("auth failed", "sys");
        try { conn.close(); } catch (e) {}
      }
      return;
    }
    if (data.type === "chat") {
      var t = data.text != null ? String(data.text) : "";
      if (t) addMsg(t, "them", peerName);
      if (el("typing")) el("typing").textContent = "";
      return;
    }
    if (data.type === "typing") {
      if (el("typing")) el("typing").textContent = peerName + " is typing…";
      clearTimeout(handleData._tt);
      handleData._tt = setTimeout(function () {
        if (el("typing")) el("typing").textContent = "";
      }, 2000);
      return;
    }
    if (data.type === "ping") { sendJson({ type: "pong", t: data.t }); return; }
    if (data.type === "pong" && data.t) {
      if (el("rtt")) el("rtt").textContent = "rtt " + (Date.now() - data.t) + " ms";
      return;
    }
    if (data.type === "file-meta") {
      recvMeta = { name: data.name, size: data.size || 0, mime: data.mime };
      recvChunks = []; recvGot = 0;
      el("prog").classList.remove("hidden");
      el("bar").style.width = "0%";
      el("dl").classList.add("hidden");
      addMsg("receiving: " + (data.name || "file"), "sys");
      return;
    }
    if (data.type === "game") { addMsg(data.text, "sys"); return; }
    if (data.type === "clip") {
      addMsg("clipboard shared", "them", peerName);
      if (data.text && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(data.text).then(function () { toast("clipboard updated"); });
      }
      return;
    }
  }

  function finishRecv(blob, meta) {
    var url = URL.createObjectURL(blob);
    if (meta.mime && meta.mime.indexOf("image/") === 0) {
      var img = document.createElement("img");
      img.src = url;
      img.alt = meta.name || "image";
      img.style.maxWidth = "100%";
      img.style.borderRadius = "0.4rem";
      img.style.marginTop = "0.3rem";
      addMsg(meta.name || "image", "them", peerName, img);
      return;
    }
    var a = el("dl");
    if (a) {
      a.href = url;
      a.download = meta.name || "file";
      a.textContent = "download " + (meta.name || "file");
      a.classList.remove("hidden");
    }
    addMsg("file ready: " + (meta.name || "file"), "sys");
  }

  function startHost() {
    if (window.__G5_XR__ && window.__G5_XR__.joinOnly) { toast("host locked"); return; }
    destroy();
    el("chat-log").innerHTML = "";
    exportLog = [];
    myName = (el("host-name").value && el("host-name").value.trim()) || "Host";
    peerName = "Guest";
    hostPass = el("room-pass").value || "";
    status(el("host-status"), "starting…", "wait");
    el("host-info").classList.remove("hidden");
    el("btn-host").classList.add("hidden");
    el("btn-host-stop").classList.remove("hidden");
    waitPeer(function (err) {
      if (err) { status(el("host-status"), err.message || "fail", "err"); return; }
      try { peer = makePeer(); } catch (e) {
        status(el("host-status"), e.message, "err");
        el("btn-host").classList.remove("hidden");
        el("btn-host-stop").classList.add("hidden");
        return;
      }
      peer.on("open", function (id) {
        var url = buildShare(id);
        el("share-url").value = url;
        renderQr(url);
        status(el("host-status"), "waiting for peer…", "wait");
        toast("room open");
      });
      peer.on("connection", function (c) {
        if (conn && conn.open) { try { c.close(); } catch (e) {} return; }
        wireConn(c, "host");
      });
      peer.on("call", onIncomingCall);
      peer.on("error", function (err) {
        status(el("host-status"), (err && err.type) || "error", "err");
      });
    });
  }

  function stopHost() {
    destroy();
    el("host-info").classList.add("hidden");
    el("btn-host").classList.remove("hidden");
    el("btn-host-stop").classList.add("hidden");
    status(el("host-status"), "", "");
    el("chat-log").innerHTML = "";
    el("stage").classList.add("hidden");
  }

  function joinRoom(roomId) {
    roomId = (roomId || "").trim();
    if (!roomId) { status(el("join-status"), "room id required", "err"); return; }
    destroy();
    el("chat-log").innerHTML = "";
    exportLog = [];
    myName = (el("join-name").value && el("join-name").value.trim()) || "Guest";
    peerName = "Host";
    status(el("join-status"), "connecting…", "wait");
    waitPeer(function (err) {
      if (err) { status(el("join-status"), err.message || "fail", "err"); return; }
      try { peer = makePeer(); } catch (e) {
        status(el("join-status"), e.message, "err");
        return;
      }
      peer.on("open", function () {
        var c = peer.connect(roomId, { reliable: true });
        wireConn(c, "join");
      });
      peer.on("call", onIncomingCall);
      peer.on("error", function (err) {
        status(el("join-status"), (err && err.type) || "error", "err");
      });
    });
  }

  function onIncomingCall(call) {
    mediaCall = call;
    call.answer();
    call.on("stream", function (stream) {
      el("screen-wrap").classList.remove("hidden");
      el("remote-video").srcObject = stream;
      addMsg("receiving screen", "sys");
    });
    call.on("close", function () {
      el("remote-video").srcObject = null;
      el("screen-wrap").classList.add("hidden");
      addMsg("screen ended", "sys");
    });
  }

  function onSendChat(e) {
    e.preventDefault();
    var text = (el("chat-input").value || "").trim();
    if (!text || !conn || !conn.open) return;
    sendJson({ type: "chat", text: text });
    addMsg(text, "me", myName);
    el("chat-input").value = "";
  }

  function sendFile() {
    if (!selectedFile || !conn || !conn.open) return;
    var f = selectedFile;
    sendJson({ type: "file-meta", name: f.name, size: f.size, mime: f.type || "application/octet-stream" });
    var offset = 0;
    el("prog").classList.remove("hidden");
    function next() {
      if (offset >= f.size) {
        el("bar").style.width = "100%";
        addMsg("sent: " + f.name, "sys");
        toast("sent");
        return;
      }
      var slice = f.slice(offset, offset + CHUNK);
      var reader = new FileReader();
      reader.onload = function () {
        try { conn.send(reader.result); } catch (e) {}
        offset += CHUNK;
        el("bar").style.width = Math.min(100, (offset / f.size) * 100) + "%";
        setTimeout(next, 0);
      };
      reader.readAsArrayBuffer(slice);
    }
    next();
  }

  function startScreen() {
    if (!peer || !conn || !conn.open) return;
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
      localStream = stream;
      mediaCall = peer.call(conn.peer, stream);
      addMsg("screen sharing…", "sys");
      stream.getVideoTracks()[0].onended = function () {
        destroyMedia();
        addMsg("screen stopped", "sys");
      };
    }).catch(function () { toast("screen denied"); });
  }

  function sendGame(kind) {
    var text = "";
    if (kind === "dice") text = myName + " rolled " + (1 + Math.floor(Math.random() * 6));
    else text = myName + " flipped " + (Math.random() < 0.5 ? "heads" : "tails");
    sendJson({ type: "game", text: text });
    addMsg(text, "sys");
  }

  function sendClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      toast("clipboard unavailable");
      return;
    }
    navigator.clipboard.readText().then(function (t) {
      if (!t) { toast("empty"); return; }
      sendJson({ type: "clip", text: t });
      addMsg("clipboard sent (" + t.length + " chars)", "sys");
    }).catch(function () { toast("clipboard denied"); });
  }
})();
