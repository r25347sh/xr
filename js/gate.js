(function (global) {
  "use strict";
  var KEY = "__g5_pr";
  var KEY_B = "__g5_pr_b";
  var TTL = 2 * 60 * 60 * 1000;
  var TOKEN_TTL = 30 * 60 * 1000;

  function b64urlDecode(u) {
    try {
      var s = String(u).replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4) s += "=";
      return atob(s);
    } catch (e) {
      return null;
    }
  }

  function parseU() {
    try {
      var u = new URLSearchParams(location.search).get("u");
      if (!u) return null;
      var raw = b64urlDecode(u);
      if (!raw) return null;
      var json = JSON.parse(raw);
      if (!json || json.v !== 1 || !json.t) return null;
      if (Date.now() - json.t > TOKEN_TTL) return null;
      return json;
    } catch (e) {
      return null;
    }
  }

  function validObj(o) {
    if (!o || o.v !== 1 || !o.t) return null;
    if (Date.now() - o.t > TTL) return null;
    return o;
  }

  function readStore() {
    try {
      var raw = sessionStorage.getItem(KEY);
      if (raw) {
        var o = validObj(JSON.parse(raw));
        if (o) return o;
        sessionStorage.removeItem(KEY);
      }
    } catch (e) {}
    try {
      var raw2 = localStorage.getItem(KEY_B);
      if (raw2) {
        var o2 = validObj(JSON.parse(raw2));
        if (o2) {
          try { sessionStorage.setItem(KEY, JSON.stringify(o2)); } catch (e) {}
          return o2;
        }
        localStorage.removeItem(KEY_B);
      }
    } catch (e) {}
    return null;
  }

  function writeStore(t) {
    var payload = JSON.stringify({ t: t || Date.now(), v: 1 });
    try { sessionStorage.setItem(KEY, payload); } catch (e) {}
    try { localStorage.setItem(KEY_B, payload); } catch (e) {}
    return true;
  }

  function hasJoin() {
    try {
      return !!(new URLSearchParams(location.search).get("r"));
    } catch (e) {
      return false;
    }
  }

  function unlockFromPortal() {
    var tok = parseU();
    if (tok) {
      writeStore(tok.t);
      try {
        var url = new URL(location.href);
        url.searchParams.delete("u");
        history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
      } catch (e) {}
      return true;
    }
    return !!readStore();
  }

  function isUnlocked() {
    return unlockFromPortal();
  }

  function requireUnlock(opts) {
    opts = opts || {};
    var joinOk = opts.allowJoin !== false && hasJoin();
    var unlocked = isUnlocked();
    var ok = unlocked || joinOk;
    var joinOnly = joinOk && !readStore() && !unlocked;

    if (unlocked) {
      ok = true;
      joinOnly = false;
    }

    global.__G5_XR__ = {
      ok: ok,
      joinOnly: !!(ok && joinOnly),
      hasJoin: hasJoin()
    };

    var deny = document.getElementById("deny");
    var app = document.getElementById("app");
    if (!ok) {
      if (app) app.classList.add("hidden");
      if (deny) deny.classList.remove("hidden");
      document.body.classList.remove("on");
      return false;
    }
    if (deny) deny.classList.add("hidden");
    if (app) {
      app.classList.remove("hidden");
      app.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("on");
    global.dispatchEvent(new Event("g5-xr-ready"));
    return true;
  }

  global.G5Gate = {
    KEY: KEY,
    writeStore: writeStore,
    readStore: readStore,
    isUnlocked: isUnlocked,
    requireUnlock: requireUnlock,
    hasJoin: hasJoin
  };

  if (document.currentScript && document.currentScript.getAttribute("data-autorun") === "1") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { requireUnlock(); });
    } else {
      requireUnlock();
    }
  }
})(window);
