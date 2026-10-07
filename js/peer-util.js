(function (global) {
  "use strict";
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
  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._tm);
    toast._tm = setTimeout(function () { t.classList.remove("show"); }, 1600);
  }
  function status(el, text, cls) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "status" + (cls ? " " + cls : "");
  }
  function waitPeer(cb) {
    var n = 0;
    (function tick() {
      if (typeof Peer !== "undefined") return cb();
      if (++n > 80) return cb(new Error("peerjs load failed"));
      setTimeout(tick, 100);
    })();
  }
  function buildShare(id) {
    var u = new URL(location.href);
    u.search = "?r=" + encodeURIComponent(id);
    return u.toString();
  }
  function renderQr(box, url) {
    if (!box) return;
    box.innerHTML = "";
    if (typeof QRCode === "undefined") return;
    try {
      new QRCode(box, { text: url, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M });
    } catch (e) {}
  }
  function copyText(v) {
    if (!v) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v).then(function () { toast("copied"); })
        .catch(function () { toast("copy manually"); });
    } else toast("copy manually");
  }
  global.G5Peer = {
    makePeer: makePeer,
    toast: toast,
    status: status,
    waitPeer: waitPeer,
    buildShare: buildShare,
    renderQr: renderQr,
    copyText: copyText
  };
})(window);
