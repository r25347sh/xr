(function () {
  "use strict";
  var peer = null, conn = null, started = false, suppress = false, syncTimer = null;
  function el(id) { return document.getElementById(id); }
  function toast(m) { if (window.G5Peer) G5Peer.toast(m); }
  function status(n, t, c) { if (window.G5Peer) G5Peer.status(n, t, c); else if (n) { n.textContent = t || ""; n.className = "status" + (c ? " " + c : ""); } }
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
    if (joinOnly) { el("mode-tabs").classList.add("hidden"); el("panel-host").classList.add("hidden"); el("panel-join").classList.remove("hidden"); }
    document.querySelectorAll(".mode-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        if (joinOnly) return;
        var m = tab.getAttribute("data-mode");
        document.querySelectorAll(".mode-tab").forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-mode") === m); });
        el("panel-host").classList.toggle("hidden", m !== "host");
        el("panel-join").classList.toggle("hidden", m !== "join");
      });
    });
    el("btn-host").addEventListener("click", startHost);
    el("btn-host-stop").addEventListener("click", stopAll);
    el("btn-join").addEventListener("click", function () { join(el("room-input").value); });
    el("btn-copy").addEventListener("click", function () { G5Peer.copyText(el("share-url").value); });
    el("pad").addEventListener("input", onEdit);
    el("btn-clear").addEventListener("click", function () { el("pad").value = ""; send({ type: "full", text: "" }); });
    el("btn-export").addEventListener("click", function () {
      var blob = new Blob([el("pad").value], { type: "text/plain" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "pad-" + Date.now() + ".txt"; a.click();
    });
    var r = new URLSearchParams(location.search).get("r");
    if (r) { el("panel-host").classList.add("hidden"); el("panel-join").classList.remove("hidden"); el("room-input").value = r; G5Peer.waitPeer(function () { join(r); }); }
  }
  function send(o) { if (!conn || !conn.open) return; try { conn.send(JSON.stringify(o)); } catch (e) {} }
  function onEdit() {
    if (suppress) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { send({ type: "full", text: el("pad").value }); if (el("sync")) el("sync").textContent = "synced " + new Date().toLocaleTimeString(); }, 180);
  }
  function destroy() {
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    el("stage").classList.add("hidden");
    var b = el("badge"); if (b) { b.textContent = "offline"; b.classList.remove("on"); }
  }
  function wire(c) {
    conn = c;
    c.on("open", function () {
      el("stage").classList.remove("hidden");
      var b = el("badge"); if (b) { b.textContent = "online"; b.classList.add("on"); }
      send({ type: "full", text: el("pad").value }); toast("connected");
    });
    c.on("data", function (raw) {
      try {
        var d = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (d && d.type === "full") { suppress = true; el("pad").value = d.text || ""; suppress = false; if (el("sync")) el("sync").textContent = "remote " + new Date().toLocaleTimeString(); }
      } catch (e) {}
    });
    c.on("close", function () { var b = el("badge"); if (b) { b.textContent = "offline"; b.classList.remove("on"); } el("stage").classList.add("hidden"); });
  }
  function startHost() {
    destroy();
    G5Peer.waitPeer(function () {
      peer = G5Peer.makePeer();
      peer.on("open", function (id) {
        el("share-url").value = G5Peer.buildShare(id);
        el("host-info").classList.remove("hidden"); el("btn-host").classList.add("hidden"); el("btn-host-stop").classList.remove("hidden");
        status(el("host-status"), "waiting…", "wait");
      });
      peer.on("connection", function (c) { if (conn && conn.open) { try { c.close(); } catch (e) {} return; } wire(c); status(el("host-status"), "connected", "ok"); });
    });
  }
  function stopAll() { destroy(); el("host-info").classList.add("hidden"); el("btn-host").classList.remove("hidden"); el("btn-host-stop").classList.add("hidden"); status(el("host-status"), "", ""); }
  function join(id) {
    id = (id || "").trim(); if (!id) return; destroy();
    G5Peer.waitPeer(function () {
      peer = G5Peer.makePeer();
      peer.on("open", function () { wire(peer.connect(id, { reliable: true })); status(el("join-status"), "connecting…", "wait"); });
    });
  }
})();
