(function () {
  "use strict";
  var KEY = "__g5_pr";
  var TTL = 2 * 60 * 60 * 1000;

  function hasJoin() {
    try {
      return !!(new URLSearchParams(location.search).get("r"));
    } catch (e) {
      return false;
    }
  }

  function unlocked() {
    try {
      var raw = sessionStorage.getItem(KEY);
      if (!raw) return false;
      var o = JSON.parse(raw);
      if (!o || !o.t || o.v !== 1) return false;
      if (Date.now() - o.t > TTL) {
        sessionStorage.removeItem(KEY);
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  var deny = document.getElementById("deny");
  var app = document.getElementById("app");
  var joinOnly = hasJoin() && !unlocked();
  var ok = unlocked() || hasJoin();

  if (!ok) {
    if (app) app.classList.add("hidden");
    if (deny) deny.classList.remove("hidden");
    window.__G5_XR__ = { ok: false, joinOnly: false };
    return;
  }

  if (deny) deny.classList.add("hidden");
  if (app) {
    app.classList.remove("hidden");
    app.setAttribute("aria-hidden", "false");
  }
  document.body.classList.add("on");
  window.__G5_XR__ = { ok: true, joinOnly: joinOnly };
  window.dispatchEvent(new Event("g5-xr-ready"));
})();
