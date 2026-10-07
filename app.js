(function () {
  "use strict";

  var CHUNK = 16 * 1024;
  var peer = null, conn = null, mediaCall = null;
  var localStream = null;
  var myName = "Me", peerName = "Peer";
  var selectedFile = null;
  var recvChunks = [], recvMeta = null, recvGot = 0;
  var hostPass = "";
  var started = false, isHost = false;
  var typingTimer = null, pingTimer = null;
  var boardOn = false, drawing = false, lastPt = null;
  var mediaRecorder = null, voiceChunks = [];
  var exportLog = [];

  function el(id) { return document.getElementById(id); }

  function showToast(msg) {
    var t = el("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(function () { t.classList.remove("show"); }, 1600);
  }

  function setStatus(node, text, cls) {
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
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.04;
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
    initUI(g.joinOnly);
  }
  window.addEventListener("g5-xr-ready", boot);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 30); });
  } else setTimeout(boot, 30);

  function initUI(joinOnly) {
    if (joinOnly) {
      el("mode-tabs").classList.add("hidden");
      el("panel-host").classList.add("hidden");
      el("panel-join").classList.remove("hidden");
      el("mode-badge").textContent = "join only · host requires portal unlock";
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
    el("btn-board").addEventListener("click", toggleBoard);
    el("btn-board-clear").addEventListener("click", function () { clearBoard(true); });
    el("btn-voice").addEventListener("click", toggleVoice);
    el("btn-clip").addEventListener("click", sendClipboard);
    el("btn-dice").addEventListener("click", function () { sendGame("dice"); });
    el("btn-coin").addEventListener("click", function () { sendGame("coin"); });
    el("btn-export").addEventListener("click", exportChat);
    el("chat-input").addEventListener("input", onTyping);

    var stage = el("stage");
    stage.addEventListener("dragover", function (e) {
      e.preventDefault();
      stage.classList.add("drag-over");
    });
    stage.addEventListener("dragleave", function () { stage.classList.remove("drag-over"); });
    stage.addEventListener("drop", function (e) {
      e.preventDefault();
      stage.classList.remove("drag-over");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      selectedFile = f;
      el("file-meta").textContent = f.name + " · " + f.size + " B";
      el("btn-file-send").disabled = !conn || !conn.open;
      showToast("file ready");
    });

    initBoard();

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
    var rv = el("remote-video"), lv = el("local-video");
    if (rv) rv.srcObject = null;
    if (lv) { lv.srcObject = null; lv.classList.add("hidden"); }
    el("screen-wrap").classList.add("hidden");
    el("btn-screen").classList.remove("hidden");
    el("btn-screen-stop").classList.add("hidden");
  }

  function destroy() {
    stopPing();
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try { mediaRecorder.stop(); } catch (e) {}
    }
    destroyMedia();
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    setStageEnabled(false);
    var b = el("conn-badge");
    if (b) { b.textContent = "offline"; b.classList.remove("on"); }
    if (el("peer-label")) el("peer-label").textContent = "—";
    el("typing-ind").textContent = "";
    el("rtt").textContent = "";
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

  function setStageEnabled(on) {
    el("stage").classList.toggle("hidden", !on);
    ["chat-input", "btn-send", "btn-screen", "btn-board", "btn-voice", "btn-clip", "btn-dice", "btn-coin", "btn-export"].forEach(function (id) {
      if (el(id)) el(id).disabled = !on;
    });
    el("btn-file-send").disabled = !on || !selectedFile;
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
      setStageEnabled(true);
      var b = el("conn-badge");
      if (b) { b.textContent = "online"; b.classList.add("on"); }
      if (el("peer-label")) el("peer-label").textContent = peerName;
      addMsg("connected", "sys");
      sendJson({
        type: "hello",
        name: myName,
        pass: role === "join" ? (el("join-pass").value || "") : undefined
      });
      if (role === "host") setStatus(el("host-status"), "connected", "ok");
      else setStatus(el("join-status"), "connected", "ok");
      startPing();
    });
    c.on("data", handleData);
    c.on("close", function () {
      addMsg("peer disconnected", "sys");
      var b = el("conn-badge");
      if (b) { b.textContent = "offline"; b.classList.remove("on"); }
      destroyMedia();
      setStageEnabled(false);
      stopPing();
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
      el("file-progress").classList.remove("hidden");
      el("file-bar").style.width = pct + "%";
      if (recvGot >= recvMeta.size) {
        var blob = new Blob(recvChunks, { type: recvMeta.mime || "application/octet-stream" });
        finishRecvFile(blob, recvMeta);
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
        setStatus(el("join-status"), "wrong passphrase", "err");
        addMsg("auth failed", "sys");
        try { conn.close(); } catch (e) {}
      }
      return;
    }
    if (data.type === "chat") {
      var t = data.text != null ? String(data.text) : "";
      if (t) addMsg(t, "them", peerName);
      el("typing-ind").textContent = "";
      return;
    }
    if (data.type === "typing") {
      el("typing-ind").textContent = peerName + " is typing…";
      clearTimeout(handleData._tt);
      handleData._tt = setTimeout(function () { el("typing-ind").textContent = ""; }, 2000);
      return;
    }
    if (data.type === "ping") {
      sendJson({ type: "pong", t: data.t });
      return;
    }
    if (data.type === "pong" && data.t) {
      el("rtt").textContent = "rtt " + (Date.now() - data.t) + " ms";
      return;
    }
    if (data.type === "file-meta") {
      recvMeta = { name: data.name, size: data.size || 0, mime: data.mime };
      recvChunks = []; recvGot = 0;
      el("file-progress").classList.remove("hidden");
      el("file-bar").style.width = "0%";
      el("download-link").classList.add("hidden");
      addMsg("receiving file: " + (data.name || "file"), "sys");
      return;
    }
    if (data.type === "board-stroke") { drawRemoteStroke(data); return; }
    if (data.type === "board-clear") { clearBoard(false); return; }
    if (data.type === "game") { addMsg(data.text, "sys"); return; }
    if (data.type === "voice-meta") {
      recvMeta = { name: "voice.webm", size: data.size || 0, mime: data.mime || "audio/webm", voice: true };
      recvChunks = []; recvGot = 0;
      addMsg("receiving voice…", "sys");
    }
  }

  function finishRecvFile(blob, meta) {
    var url = URL.createObjectURL(blob);
    if (meta.voice || (meta.mime && meta.mime.indexOf("audio/") === 0)) {
      var audio = document.createElement("audio");
      audio.controls = true;
      audio.src = url;
      addMsg("voice message", "them", peerName, audio);
      return;
    }
    if (meta.mime && meta.mime.indexOf("image/") === 0) {
      var img = document.createElement("img");
      img.className = "preview";
      img.src = url;
      img.alt = meta.name || "image";
      addMsg(meta.name || "image", "them", peerName, img);
      return;
    }
    var a = el("download-link");
    if (a) {
      a.href = url;
      a.download = meta.name || "file";
      a.textContent = "download " + (meta.name || "file");
      a.classList.remove("hidden");
    }
    addMsg("file received: " + (meta.name || "file"), "sys");
  }

  function startHost() {
    if (window.__G5_XR__ && window.__G5_XR__.joinOnly) { showToast("host locked"); return; }
    destroy();
    el("chat-log").innerHTML = "";
    exportLog = [];
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
    peer.on("call", onIncomingCall);
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
    if (!roomId) { setStatus(el("join-status"), "room id required", "err"); return; }
    destroy();
    el("chat-log").innerHTML = "";
    exportLog = [];
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
    peer.on("call", onIncomingCall);
    peer.on("error", function (err) {
      setStatus(el("join-status"), (err && err.type) || "error", "err");
      el("btn-join").classList.remove("hidden");
      el("btn-leave").classList.add("hidden");
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

  function onTyping() { sendJson({ type: "typing" }); }

  function onSendChat(e) {
    e.preventDefault();
    var text = (el("chat-input").value || "").trim();
    if (!text || !conn || !conn.open) return;
    sendJson({ type: "chat", text: text });
    addMsg(text, "me", myName);
    el("chat-input").value = "";
  }

  function onFilePick() {
    var f = el("file-input").files && el("file-input").files[0];
    selectedFile = f || null;
    el("file-meta").textContent = f ? (f.name + " · " + f.size + " B") : "";
    el("btn-file-send").disabled = !f || !conn || !conn.open;
  }

  function sendFile() {
    if (!selectedFile || !conn || !conn.open) return;
    transferBlob(selectedFile, selectedFile.name, selectedFile.type || "application/octet-stream", false);
  }

  function transferBlob(blob, name, mime, isVoice) {
    el("file-progress").classList.remove("hidden");
    el("file-bar").style.width = "0%";
    sendJson({ type: isVoice ? "voice-meta" : "file-meta", name: name, size: blob.size, mime: mime });
    var offset = 0;
    var reader = new FileReader();
    function next() {
      if (offset >= blob.size) {
        addMsg((isVoice ? "voice sent" : "file sent: ") + name, "sys");
        el("file-bar").style.width = "100%";
        return;
      }
      var slice = blob.slice(offset, offset + CHUNK);
      reader.onload = function (ev) {
        try { conn.send(ev.target.result); } catch (err) { showToast("transfer error"); return; }
        offset += CHUNK;
        el("file-bar").style.width = Math.min(100, (offset / blob.size) * 100) + "%";
        setTimeout(next, 0);
      };
      reader.readAsArrayBuffer(slice);
    }
    next();
  }

  function startScreen() {
    if (!peer || !conn || !conn.open) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      showToast("screen share unsupported"); return;
    }
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
      localStream = stream;
      el("screen-wrap").classList.remove("hidden");
      el("local-video").srcObject = stream;
      el("local-video").classList.remove("hidden");
      el("btn-screen").classList.add("hidden");
      el("btn-screen-stop").classList.remove("hidden");
      mediaCall = peer.call(conn.peer, stream);
      stream.getVideoTracks()[0].addEventListener("ended", stopScreen);
      addMsg("sharing screen", "sys");
    }).catch(function () { showToast("screen share cancelled"); });
  }

  function stopScreen() {
    destroyMedia();
    addMsg("screen share stopped", "sys");
  }

  function initBoard() {
    var canvas = el("board");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    function pos(e) {
      var r = canvas.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      var y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      return { x: x * (canvas.width / r.width), y: y * (canvas.height / r.height) };
    }
    function start(e) {
      if (!boardOn) return;
      e.preventDefault();
      drawing = true;
      lastPt = pos(e);
    }
    function move(e) {
      if (!drawing || !boardOn) return;
      e.preventDefault();
      var p = pos(e);
      var color = el("board-color").value || "#00f5ff";
      strokeLocal(lastPt.x, lastPt.y, p.x, p.y, color);
      sendJson({ type: "board-stroke", x0: lastPt.x, y0: lastPt.y, x1: p.x, y1: p.y, color: color });
      lastPt = p;
    }
    function end() { drawing = false; lastPt = null; }
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseup", end);
    canvas.addEventListener("mouseleave", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
  }

  function strokeLocal(x0, y0, x1, y1, color) {
    var canvas = el("board");
    var ctx = canvas.getContext("2d");
    ctx.strokeStyle = color || "#00f5ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  function drawRemoteStroke(d) {
    if (!boardOn) {
      boardOn = true;
      el("board-wrap").classList.remove("hidden");
    }
    strokeLocal(d.x0, d.y0, d.x1, d.y1, d.color);
  }

  function clearBoard(send) {
    var canvas = el("board");
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (send) sendJson({ type: "board-clear" });
  }

  function toggleBoard() {
    boardOn = !boardOn;
    el("board-wrap").classList.toggle("hidden", !boardOn);
    showToast(boardOn ? "board on" : "board off");
  }

  function toggleVoice() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      el("btn-voice").textContent = "voice";
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast("mic unsupported"); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      voiceChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function (e) {
        if (e.data && e.data.size) voiceChunks.push(e.data);
      };
      mediaRecorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(voiceChunks, { type: "audio/webm" });
        if (blob.size < 100) { showToast("voice empty"); return; }
        transferBlob(blob, "voice.webm", "audio/webm", true);
        var audio = document.createElement("audio");
        audio.controls = true;
        audio.src = URL.createObjectURL(blob);
        addMsg("voice message", "me", myName, audio);
      };
      mediaRecorder.start();
      el("btn-voice").textContent = "stop";
      showToast("recording… tap again to send");
      setTimeout(function () {
        if (mediaRecorder && mediaRecorder.state === "recording") {
          mediaRecorder.stop();
          el("btn-voice").textContent = "voice";
        }
      }, 15000);
    }).catch(function () { showToast("mic denied"); });
  }

  function sendClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      showToast("clipboard unsupported"); return;
    }
    navigator.clipboard.readText().then(function (text) {
      text = (text || "").trim();
      if (!text) { showToast("clipboard empty"); return; }
      if (text.length > 2000) text = text.slice(0, 2000);
      sendJson({ type: "chat", text: text });
      addMsg(text, "me", myName);
      showToast("clipboard sent");
    }).catch(function () { showToast("clipboard denied"); });
  }

  function sendGame(kind) {
    var text;
    if (kind === "dice") text = myName + " rolled " + (1 + Math.floor(Math.random() * 6));
    else text = myName + " flipped " + (Math.random() < 0.5 ? "heads" : "tails");
    sendJson({ type: "game", text: text });
    addMsg(text, "sys");
  }

  function exportChat() {
    if (!exportLog.length) { showToast("nothing to export"); return; }
    var lines = exportLog.map(function (row) {
      return "[" + new Date(row.t).toISOString() + "] " + (row.who ? row.who + ": " : "") + row.text;
    });
    var blob = new Blob([lines.join("\n")], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "room-chat.txt";
    a.click();
    showToast("exported");
  }
})();
