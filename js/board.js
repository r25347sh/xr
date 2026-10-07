(function () {
  "use strict";
  var peer = null, conn = null, started = false, drawing = false, last = null, eraser = false;
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
    el("btn-clear").addEventListener("click", function () { clear(true); });
    el("btn-eraser").addEventListener("click", function () {
      eraser = !eraser;
      el("btn-eraser").textContent = eraser ? "pen" : "eraser";
    });
    setupCanvas();
    var r = new URLSearchParams(location.search).get("r");
    if (r) {
      el("panel-host").classList.add("hidden");
      el("panel-join").classList.remove("hidden");
      el("room-input").value = r;
      G5Peer.waitPeer(function () { join(r); });
    }
  }

  function setupCanvas() {
    var c = el("board");
    var ctx = c.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    function pos(e) {
      var r = c.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      var y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      return { x: x * (c.width / r.width), y: y * (c.height / r.height) };
    }
    function start(e) { e.preventDefault(); drawing = true; last = pos(e); }
    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      var p = pos(e);
      var col = eraser ? "#0a0a12" : el("color").value;
      var sz = eraser ? 18 : +el("size").value;
      stroke(last.x, last.y, p.x, p.y, col, sz, true);
      last = p;
    }
    function end() { drawing = false; last = null; }
    c.addEventListener("mousedown", start);
    c.addEventListener("mousemove", move);
    c.addEventListener("mouseup", end);
    c.addEventListener("mouseleave", end);
    c.addEventListener("touchstart", start, { passive: false });
    c.addEventListener("touchmove", move, { passive: false });
    c.addEventListener("touchend", end);
  }

  function stroke(x0, y0, x1, y1, color, size, emit) {
    var ctx = el("board").getContext("2d");
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    if (emit && conn && conn.open) {
      try {
        conn.send(JSON.stringify({ type: "s", x0: x0, y0: y0, x1: x1, y1: y1, c: color, z: size }));
      } catch (e) {}
    }
  }

  function clear(emit) {
    var c = el("board");
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    if (emit && conn && conn.open) {
      try { conn.send(JSON.stringify({ type: "clear" })); } catch (e) {}
    }
  }

  function destroy() {
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
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
      toast("connected");
    });
    c.on("data", function (raw) {
      try {
        var d = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (d.type === "s") stroke(d.x0, d.y0, d.x1, d.y1, d.c, d.z, false);
        if (d.type === "clear") clear(false);
      } catch (e) {}
    });
    c.on("close", function () {
      var b = el("badge");
      if (b) { b.textContent = "offline"; b.classList.remove("on"); }
    });
  }

  function startHost() {
    destroy();
    G5Peer.waitPeer(function () {
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
  }

  function join(id) {
    id = (id || "").trim();
    if (!id) return;
    destroy();
    G5Peer.waitPeer(function () {
      peer = G5Peer.makePeer();
      peer.on("open", function () {
        wire(peer.connect(id, { reliable: true }));
        status(el("join-status"), "connecting…", "wait");
      });
    });
  }
})();
