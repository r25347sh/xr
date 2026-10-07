(function () {
  "use strict";
  var peer = null, mediaCall = null, localStream = null, started = false;
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
    el("btn-mute").addEventListener("click", toggleMute);
    el("btn-cam").addEventListener("click", toggleCam);
    el("btn-hang").addEventListener("click", hang);
    var r = new URLSearchParams(location.search).get("r");
    if (r) {
      el("panel-host").classList.add("hidden");
      el("panel-join").classList.remove("hidden");
      el("room-input").value = r;
      G5Peer.waitPeer(function () { join(r); });
    }
  }

  function destroyMedia() {
    if (mediaCall) { try { mediaCall.close(); } catch (e) {} mediaCall = null; }
    if (localStream) {
      localStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      localStream = null;
    }
    var lv = el("local-video"), rv = el("remote-video");
    if (lv) lv.srcObject = null;
    if (rv) rv.srcObject = null;
  }

  function destroy() {
    destroyMedia();
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    el("stage").classList.add("hidden");
    var b = el("badge");
    if (b) { b.textContent = "offline"; b.classList.remove("on"); }
  }

  function onCall(call) {
    mediaCall = call;
    call.on("stream", function (stream) {
      el("remote-video").srcObject = stream;
      el("stage").classList.remove("hidden");
    });
    call.on("close", function () {
      el("remote-video").srcObject = null;
      toast("call ended");
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
      peer.on("call", function (call) {
        navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(function (stream) {
          localStream = stream;
          el("local-video").srcObject = stream;
          el("stage").classList.remove("hidden");
          call.answer(stream);
          onCall(call);
          status(el("host-status"), "in call", "ok");
          var b = el("badge");
          if (b) { b.textContent = "online"; b.classList.add("on"); }
        }).catch(function (e) {
          status(el("host-status"), e.message || "media error", "err");
        });
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
        status(el("join-status"), "getting media…", "wait");
        navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(function (stream) {
          localStream = stream;
          el("local-video").srcObject = stream;
          el("stage").classList.remove("hidden");
          var call = peer.call(id, stream);
          onCall(call);
          status(el("join-status"), "in call", "ok");
          var b = el("badge");
          if (b) { b.textContent = "online"; b.classList.add("on"); }
        }).catch(function (e) {
          status(el("join-status"), e.message || "media error", "err");
        });
      });
    });
  }

  function toggleMute() {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(function (t) {
      t.enabled = !t.enabled;
      el("btn-mute").textContent = t.enabled ? "mute" : "unmute";
    });
  }

  function toggleCam() {
    if (!localStream) return;
    localStream.getVideoTracks().forEach(function (t) {
      t.enabled = !t.enabled;
      el("btn-cam").textContent = t.enabled ? "cam off" : "cam on";
    });
  }

  function hang() {
    destroy();
    toast("hung up");
  }
})();
