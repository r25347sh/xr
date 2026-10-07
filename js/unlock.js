(function (global) {
  "use strict";
  var KEY = "__g5x";
  var TTL = 2 * 60 * 60 * 1000;
  var TOKEN_TTL = 15 * 60 * 1000;

  function now() { return Date.now(); }

  function parseTs(v) {
    if (v == null || v === "") return 0;
    var n = parseInt(String(v), 10);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function fresh(ts, maxAge) {
    if (!(ts > 0)) return false;
    var d = now() - ts;
    return d >= 0 && d < maxAge;
  }

  function readStore() {
    var best = 0;
    try {
      var a = parseTs(sessionStorage.getItem(KEY));
      if (fresh(a, TTL) && a > best) best = a;
    } catch (e) {}
    try {
      var b = parseTs(localStorage.getItem(KEY));
      if (fresh(b, TTL) && b > best) best = b;
    } catch (e) {}
    return best;
  }

  function writeStore(ts) {
    var s = String(ts || now());
    try { sessionStorage.setItem(KEY, s); } catch (e) {}
    try { localStorage.setItem(KEY, s); } catch (e) {}
  }

  function clearQueryX() {
    try {
      var url = new URL(location.href);
      if (!url.searchParams.has("x")) return;
      url.searchParams.delete("x");
      var q = url.searchParams.toString();
      history.replaceState(null, "", url.pathname + (q ? "?" + q : "") + url.hash);
    } catch (e) {}
  }

  function parseX() {
    try {
      var x = new URLSearchParams(location.search).get("x");
      var ts = parseTs(x);
      if (fresh(ts, TOKEN_TTL)) return ts;
    } catch (e) {}
    return 0;
  }

  function hasJoin() {
    try { return !!(new URLSearchParams(location.search).get("r")); }
    catch (e) { return false; }
  }

  function isUnlocked() {
    var fromQuery = parseX();
    if (fromQuery) {
      writeStore(fromQuery);
      clearQueryX();
      return true;
    }
    return !!readStore();
  }

  function requireUnlock(opts) {
    opts = opts || {};
    var unlocked = isUnlocked();
    var joinOk = opts.allowJoin !== false && hasJoin();
    var ok = unlocked || joinOk;
    var joinOnly = ok && !unlocked && joinOk;

    global.__G5_XR__ = { ok: ok, joinOnly: !!joinOnly, hasJoin: hasJoin() };

    var deny = document.getElementById("deny");
    var app = document.getElementById("app");
    if (!ok) {
      if (app) { app.classList.add("hidden"); app.style.display = "none"; }
      if (deny) { deny.classList.remove("hidden"); deny.style.display = ""; }
      document.body.classList.remove("on");
      return false;
    }
    if (deny) { deny.classList.add("hidden"); deny.style.display = "none"; }
    if (app) {
      app.classList.remove("hidden");
      app.style.display = "";
      app.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("on");
    try { global.dispatchEvent(new Event("g5-xr-ready")); } catch (e) {}
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

  function run() { requireUnlock(); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})(window);
