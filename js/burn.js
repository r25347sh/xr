(function () {
  "use strict";
  var peer = null, conn = null, secret = "", claimed = false, started = false;
  function el(id) { return document.getElementById(id); }
  function toast(m) { if (window.G5Peer) G5Peer.toast(m); }
  function status(n, t, c) { if (window.G5Peer) G5Peer.status(n, t, c); }
  function boot() {
    if (started) return; var g = window.__G5_XR__; if (!g || !g.ok) return; started = true;
    el("btn-host").addEventListener("click", createDrop);
    el("btn-join-mode").addEventListener("click", function () { el("join-box").classList.remove("hidden"); });
    el("btn-claim").addEventListener("click", function () { claim(el("room-input").value); });
    el("btn-copy").addEventListener("click", function () { G5Peer.copyText(el("share-url").value); });
    var r = new URLSearchParams(location.search).get("r");
    if (r) { el("join-box").classList.remove("hidden"); el("room-input").value = r; G5Peer.waitPeer(function () { claim(r); }); }
  }
  window.addEventListener("g5-xr-ready", boot); setTimeout(boot, 50);
  function createDrop() {
    secret = el("secret").value; if (!secret) { toast("empty"); return; }
    G5Peer.waitPeer(function () {
      peer = G5Peer.makePeer();
      peer.on("open", function (id) {
        el("share-url").value = G5Peer.buildShare(id); el("host-info").classList.remove("hidden"); el("btn-host").disabled = true;
        status(el("host-status"), "waiting for claim…", "wait");
        var b = el("badge"); if (b) { b.textContent = "armed"; b.classList.add("on"); }
      });
      peer.on("connection", function (c) {
        if (claimed) { try { c.close(); } catch (e) {} return; }
        conn = c;
        c.on("open", function () {
          try { c.send(JSON.stringify({ type: "secret", text: secret })); } catch (e) {}
          claimed = true; secret = ""; el("secret").value = "";
          status(el("host-status"), "claimed · burned on host", "ok"); toast("burned");
          setTimeout(function () { try { c.close(); } catch (e) {} if (peer) { try { peer.destroy(); } catch (e) {} } }, 800);
        });
      });
    });
  }
  function claim(id) {
    id = (id || "").trim(); if (!id) return;
    G5Peer.waitPeer(function () {
      peer = G5Peer.makePeer();
      peer.on("open", function () {
        conn = peer.connect(id, { reliable: true }); status(el("join-status"), "claiming…", "wait");
        conn.on("data", function (raw) {
          try {
            var d = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (d && d.type === "secret") {
              el("reveal").classList.remove("hidden"); el("revealed").value = d.text || "";
              status(el("join-status"), "claimed · one view only", "ok"); toast("claimed");
              setTimeout(function () { try { conn.close(); } catch (e) {} if (peer) { try { peer.destroy(); } catch (e) {} } }, 500);
            }
          } catch (e) {}
        });
        conn.on("error", function () { status(el("join-status"), "failed", "err"); });
      });
    });
  }
})();
