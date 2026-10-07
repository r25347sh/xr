(function () {
  "use strict";
  var CHUNK = 64 * 1024;
  var peer = null, conn = null, started = false, selected = null;
  var recvChunks = [], recvMeta = null, recvGot = 0;
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
    el("btn-send").addEventListener("click", sendFile);
    el("file-input").addEventListener("change", function () {
      selected = el("file-input").files[0] || null;
      if (selected) {
        el("file-meta").textContent = selected.name + " · " + selected.size + " B";
        el("btn-send").disabled = !conn || !conn.open;
      }
    });
    var zone = el("drop-zone");
    if (zone) {
      zone.addEventListener("dragover", function (e) { e.preventDefault(); zone.classList.add("over"); });
      zone.addEventListener("dragleave", function () { zone.classList.remove("over"); });
      zone.addEventListener("drop", function (e) {
        e.preventDefault();
        zone.classList.remove("over");
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        selected = f;
        el("file-meta").textContent = f.name + " · " + f.size + " B";
        el("btn-send").disabled = !conn || !conn.open;
        toast("file ready");
      });
    }
    var r = new URLSearchParams(location.search).get("r");
    if (r) {
      el("panel-host").classList.add("hidden");
      el("panel-join").classList.remove("hidden");
      el("room-input").value = r;
      G5Peer.waitPeer(function () { join(r); });
    }
  }

  function destroy() {
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    el("stage").classList.add("hidden");
    var b = el("badge");
    if (b) { b.textContent = "offline"; b.classList.remove("on"); }
    el("btn-send").disabled = true;
  }

  function wire(c) {
    conn = c;
    c.on("open", function () {
      el("stage").classList.remove("hidden");
      var b = el("badge");
      if (b) { b.textContent = "online"; b.classList.add("on"); }
      el("btn-send").disabled = !selected;
      toast("connected");
    });
    c.on("data", handleData);
    c.on("close", function () {
      var b = el("badge");
      if (b) { b.textContent = "offline"; b.classList.remove("on"); }
      el("btn-send").disabled = true;
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
        var url = URL.createObjectURL(blob);
        var a = el("dl");
        a.href = url;
        a.download = recvMeta.name || "file";
        a.textContent = "download " + (recvMeta.name || "file");
        a.classList.remove("hidden");
        toast("received");
        recvChunks = [];
        recvMeta = null;
        recvGot = 0;
      }
      return;
    }
    var data = raw;
    try { if (typeof raw === "string") data = JSON.parse(raw); } catch (e) { return; }
    if (data && data.type === "meta") {
      recvMeta = { name: data.name, size: data.size || 0, mime: data.mime };
      recvChunks = [];
      recvGot = 0;
      el("prog").classList.remove("hidden");
      el("bar").style.width = "0%";
      el("dl").classList.add("hidden");
      toast("receiving " + (data.name || "file"));
    }
  }

  function sendFile() {
    if (!selected || !conn || !conn.open) return;
    var f = selected;
    conn.send(JSON.stringify({ type: "meta", name: f.name, size: f.size, mime: f.type || "application/octet-stream" }));
    el("prog").classList.remove("hidden");
    el("bar").style.width = "0%";
    var offset = 0;
    var reader = new FileReader();
    function next() {
      if (offset >= f.size) {
        el("bar").style.width = "100%";
        toast("sent");
        return;
      }
      var slice = f.slice(offset, offset + CHUNK);
      reader.onload = function (e) {
        try { conn.send(e.target.result); } catch (err) { toast("send error"); return; }
        offset += slice.size;
        el("bar").style.width = Math.min(100, (offset / f.size) * 100) + "%";
        setTimeout(next, 0);
      };
      reader.readAsArrayBuffer(slice);
    }
    next();
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
