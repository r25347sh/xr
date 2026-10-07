(function () {
  "use strict";

  var CHUNK = 16 * 1024;
  var peer = null, conn = null, mediaCall = null;
  var localStream = null;
  var myName = "Me", peerName = "Peer";
  var selectedFile = null;
  var recvChunks = [], recvMeta = null, recvGot = 0;
  var hostPass = "";
  var started = false;
  var isHost = false;

  function el(id) { return document.getElementById(id); }

  function showToast(msg) {
    var t = el("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  function setStatus(node, text, cls) {
    if (!node) return;
    node.textContent = text || "";
    node.className = "status" + (cls ? " " + cls : "");
  }

  function boot() {
    if (started) return;
    var g = window.__G5_XR__;
    if (!g || !g.ok) return;
    started = true;
    initUI(g.joinOnly);
  }

  window.addEventListener("g5-xr-ready", boot);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 30); });
  } else {
    setTimeout(boot, 30);
  }

  function initUI(joinOnly) {
    if (joinOnly) {
      el("mode-tabs").classList.add("hidden");
      el("panel-host").classList.add("hidden");
      el("panel-join").classList.remove("hidden");
      el("mode-badge").textContent = "join only · host requires portal unlock";
    } else {
      el("mode-badge").textContent = "";
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

    el("btn-host-start").addEventListener("click", startHost);
    el("btn-host-stop").addEventListener("click", stopHost);
    el("btn-join").addEventListener("click", function () { joinRoom(el("room-input").value); });
    el("btn-leave").addEventListener("click", leaveRoom);
    el("btn-copy-url").addEventListener("click", copyUrl);
    el("chat-form").addEventListener("submit", onSendChat);
    el("file-input").addEventListener("change", onFilePick);
    el("btn-file-send").addEventListener("click", sendFile);
    el("btn-screen").addEventListener("click", startScreen);
    el("btn-screen-stop").addEventListener("click", stopScreen);

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
    var n = 0;
    (function tick() {
      if (typeof Peer !== "undefined") return cb();
      if (++n > 80) return setStatus(el("join-status"), "peerjs load failed", "err");
      setTimeout(tick, 100);
    })();
  }

  function makePeer() {
    if (typeof Peer === "undefined") throw new Error("peerjs missing");
    return new Peer({
      debug: 0,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" }
        ]
      }
    });
  }

  function destroyMedia() {
    if (mediaCall) { try { mediaCall.close(); } catch (e) {} mediaCall = null; }
    if (localStream) {
      localStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      localStream = null;
    }
    var rv = el("remote-video");
    var lv = el("local-video");
    if (rv) rv.srcObject = null;
    if (lv) { lv.srcObject = null; lv.classList.add("hidden"); }
    el("screen-wrap").classList.add("hidden");
    el("btn-screen").classList.remove("hidden");
    el("btn-screen-stop").classList.add("hidden");
  }

  function destroy() {
    destroyMedia();
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    setStageEnabled(false);
    var b = el("conn-badge");
    if (b) { b.textContent = "offline"; b.classList.remove("on"); }
    if (el("peer-label")) el("peer-label").textContent = "—";
  }

  function buildShareUrl(id) {
    var u = new URL(location.href);
    u.search = "?r=" + encodeURIComponent(id);
    return u.toString();
  }

  function renderQr(url) {
    var box = el("qr-box");
    if (!box) return;
    box.innerHTML = "";
    if (typeof QRCode === "undefined") return;
    try {
      new QRCode(box, { text: url, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M });
    } catch (e) {}
  }

  function addMsg(text, kind, who) {
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
    div.appendChild(document.createTextNode(text));
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function setStageEnabled(on) {
    el("stage").classList.toggle("hidden", !on);
    el("chat-input").disabled = !on;
    el("btn-send").disabled = !on;
    el("btn-file-send").disabled = !on || !selectedFile;
    el("btn-screen").disabled = !on;
    if (on) el("chat-input").focus();
  }

  function wireConn(c, role) {
    conn = c;
    isHost = role === "host";
    c.on("open", function () {
      setStageEnabled(true);
      var b = el("conn-badge");
      if (b) { b.textContent = "online"; b.classList.add("on"); }
      if (el("peer-label")) el("peer-label").textContent = peerName;
      addMsg("connected", "sys");
      try {
        c.send(JSON.stringify({
          type: "hello",
          name: myName,
          pass: role === "join" ? (el("join-pass").value || "") : undefined
        }));
      } catch (e) {}
      if (role === "host") setStatus(el("host-status"), "connected", "ok");
      else setStatus(el("join-status"), "connected", "ok");
    });
    c.on("data", handleData);
    c.on("close", function () {
      addMsg("peer disconnected", "sys");
      var b = el("conn-badge");
      if (b) { b.textContent = "offline"; b.classList.remove("on"); }
      destroyMedia();
      setStageEnabled(false);
      if (role === "host") setStatus(el("host-status"), "peer left · waiting", "wait");
      else setStatus(el("join-status"), "disconnected", "err");
    });
    c.on("error", function () {
      if (role === "host") setStatus(el("host-status"), "error", "err");
      else setStatus(el("join-status"), "error", "err");
    });
  }

  function handleData(raw) {
    if (raw instanceof ArrayBuffer || (ArrayBuffer.isView && ArrayBuffer.isView(raw))) {
      if (!recvMeta) return;
      var buf = raw instanceof ArrayBuffer ? raw : raw.buffer;
      recvChunks.push(buf);
      recvGot += buf.byteLength || raw.byteLength || 0;
      var pct = recvMeta.size ? Math.min(100, (recvGot / recvMeta.size) * 100) : 0;
      var bar = el("file-bar");
      var prog = el("file-progress");
      if (prog) prog.classList.remove("hidden");
      if (bar) bar.style.width = pct + "%";
      if (recvGot >= recvMeta.size) {
        var blob = new Blob(recvChunks, { type: recvMeta.mime || "application/octet-stream" });
        var url = URL.createObjectURL(blob);
        var a = el("download-link");
        if (a) {
          a.href = url;
          a.download = recvMeta.name || "file";
          a.textContent = "download " + (recvMeta.name || "file");
          a.classList.remove("hidden");
        }
        addMsg("file received: " + (recvMeta.name || "file"), "sys");
        recvChunks = [];
        recvMeta = null;
        recvGot = 0;
      }
      return;
    }

    var data = raw;
    try {
      if (typeof raw === "string") data = JSON.parse(raw);
    } catch (e) {
      data = { type: "chat", text: String(raw) };
    }
    if (!data || !data.type) return;

    if (data.type === "hello") {
      if (isHost && hostPass) {
        if ((data.pass || "") !== hostPass) {
          addMsg("peer rejected (bad passphrase)", "sys");
          try { conn.send(JSON.stringify({ type: "auth", ok: false })); } catch (e) {}
          try { conn.close(); } catch (e) {}
          return;
        }
        try { conn.send(JSON.stringify({ type: "auth", ok: true })); } catch (e) {}
      }
      peerName = (data.name && String(data.name).trim()) || "Peer";
      if (el("peer-label")) el("peer-label").textContent = peerName;
      addMsg(peerName + " joined", "sys");
      return;
    }
    if (data.type === "auth") {
      if (data.ok === false) {
        setStatus(el("join-status"), "wrong passphrase", "err");
        addMsg("auth failed", "sys");
        try { conn.close(); } catch (e) {}
        return;
      }
      return;
    }
    if (data.type === "chat") {
      var t = data.text != null ? String(data.text) : "";
      if (t) addMsg(t, "them", peerName);
      return;
    }
    if (data.type === "file-meta") {
      recvMeta = { name: data.name, size: data.size || 0, mime: data.mime };
      recvChunks = [];
      recvGot = 0;
      el("file-progress").classList.remove("hidden");
      el("file-bar").style.width = "0%";
      el("download-link").classList.add("hidden");
      addMsg("receiving file: " + (data.name || "file"), "sys");
    }
  }

  function startHost() {
    if (window.__G5_XR__ && window.__G5_XR__.joinOnly) {
      showToast("host locked");
      return;
    }
    destroy();
    el("chat-log").innerHTML = "";
    myName = (el("host-name").value && el("host-name").value.trim()) || "Host";
    peerName = "Guest";
    hostPass = el("room-pass").value || "";
    setStatus(el("host-status"), "starting…", "wait");
    el("host-info").classList.remove("hidden");
    el("btn-host-start").classList.add("hidden");
    el("btn-host-stop").classList.remove("hidden");
    try { peer = makePeer(); } catch (e) {
      setStatus(el("host-status"), e.message, "err");
      el("btn-host-start").classList.remove("hidden");
      el("btn-host-stop").classList.add("hidden");
      return;
    }
    peer.on("open", function (id) {
      var url = buildShareUrl(id);
      el("share-url").value = url;
      renderQr(url);
      setStatus(el("host-status"), "waiting for peer…", "wait");
      showToast("room open");
    });
    peer.on("connection", function (c) {
      if (conn && conn.open) { try { c.close(); } catch (e) {} return; }
      wireConn(c, "host");
    });
    peer.on("call", function (call) {
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
    });
    peer.on("error", function (err) {
      setStatus(el("host-status"), (err && err.type) || "error", "err");
    });
  }

  function stopHost() {
    destroy();
    el("host-info").classList.add("hidden");
    el("btn-host-start").classList.remove("hidden");
    el("btn-host-stop").classList.add("hidden");
    setStatus(el("host-status"), "", "");
    el("chat-log").innerHTML = "";
    el("stage").classList.add("hidden");
  }

  function joinRoom(roomId) {
    roomId = (roomId || "").trim();
    if (!roomId) {
      setStatus(el("join-status"), "room id required", "err");
      return;
    }
    destroy();
    el("chat-log").innerHTML = "";
    myName = (el("join-name").value && el("join-name").value.trim()) || "Guest";
    peerName = "Host";
    setStatus(el("join-status"), "connecting…", "wait");
    el("btn-join").classList.add("hidden");
    el("btn-leave").classList.remove("hidden");
    try { peer = makePeer(); } catch (e) {
      setStatus(el("join-status"), e.message, "err");
      el("btn-join").classList.remove("hidden");
      el("btn-leave").classList.add("hidden");
      return;
    }
    peer.on("open", function () {
      var c = peer.connect(roomId, { reliable: true });
      wireConn(c, "join");
    });
    peer.on("call", function (call) {
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
    });
    peer.on("error", function (err) {
      setStatus(el("join-status"), (err && err.type) || "error", "err");
      el("btn-join").classList.remove("hidden");
      el("btn-leave").classList.add("hidden");
    });
  }

  function leaveRoom() {
    destroy();
    el("btn-join").classList.remove("hidden");
    el("btn-leave").classList.add("hidden");
    setStatus(el("join-status"), "left", "");
    el("chat-log").innerHTML = "";
    el("stage").classList.add("hidden");
  }

  function copyUrl() {
    var v = el("share-url").value;
    if (!v) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v).then(function () { showToast("copied"); })
        .catch(function () { el("share-url").select(); showToast("copy manually"); });
    } else {
      el("share-url").select();
      showToast("copy manually");
    }
  }

  function onSendChat(e) {
    e.preventDefault();
    var text = (el("chat-input").value || "").trim();
    if (!text || !conn || !conn.open) return;
    try {
      conn.send(JSON.stringify({ type: "chat", text: text }));
      addMsg(text, "me", myName);
      el("chat-input").value = "";
    } catch (err) {
      showToast("send failed");
    }
  }

  function onFilePick() {
    var f = el("file-input").files && el("file-input").files[0];
    selectedFile = f || null;
    el("file-meta").textContent = f ? (f.name + " · " + f.size + " B") : "";
    el("btn-file-send").disabled = !f || !conn || !conn.open;
  }

  function sendFile() {
    if (!selectedFile || !conn || !conn.open) return;
    var file = selectedFile;
    el("file-progress").classList.remove("hidden");
    el("file-bar").style.width = "0%";
    try {
      conn.send(JSON.stringify({
        type: "file-meta",
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream"
      }));
    } catch (e) {
      showToast("send failed");
      return;
    }
    var offset = 0;
    var reader = new FileReader();
    function next() {
      if (offset >= file.size) {
        addMsg("file sent: " + file.name, "sys");
        el("file-bar").style.width = "100%";
        return;
      }
      var slice = file.slice(offset, offset + CHUNK);
      reader.onload = function (ev) {
        try { conn.send(ev.target.result); } catch (err) {
          showToast("transfer error");
          return;
        }
        offset += CHUNK;
        el("file-bar").style.width = Math.min(100, (offset / file.size) * 100) + "%";
        setTimeout(next, 0);
      };
      reader.readAsArrayBuffer(slice);
    }
    next();
  }

  function startScreen() {
    if (!peer || !conn || !conn.open) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      showToast("screen share unsupported");
      return;
    }
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
      localStream = stream;
      el("screen-wrap").classList.remove("hidden");
      el("local-video").srcObject = stream;
      el("local-video").classList.remove("hidden");
      el("btn-screen").classList.add("hidden");
      el("btn-screen-stop").classList.remove("hidden");
      var remoteId = conn.peer;
      mediaCall = peer.call(remoteId, stream);
      stream.getVideoTracks()[0].addEventListener("ended", stopScreen);
      addMsg("sharing screen", "sys");
    }).catch(function () {
      showToast("screen share cancelled");
    });
  }

  function stopScreen() {
    destroyMedia();
    addMsg("screen share stopped", "sys");
  }
})();
