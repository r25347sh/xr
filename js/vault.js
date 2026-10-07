(function () {
  "use strict";
  var KEY = "g5_xr_vault";
  var started = false;
  var cryptoKey = null;
  var notes = [];

  function el(id) { return document.getElementById(id); }
  function toast(m) {
    var t = el("toast");
    if (!t) return;
    t.textContent = m;
    t.classList.add("show");
    clearTimeout(toast._tm);
    toast._tm = setTimeout(function () { t.classList.remove("show"); }, 1600);
  }

  function boot() {
    if (started) return;
    var g = window.__G5_XR__;
    if (!g || !g.ok) return;
    started = true;
    init();
  }
  window.addEventListener("g5-xr-ready", boot);
  setTimeout(boot, 50);

  function init() {
    el("btn-unlock").addEventListener("click", unlock);
    el("btn-lock").addEventListener("click", lock);
    el("btn-add").addEventListener("click", addNote);
    el("btn-save").addEventListener("click", saveCurrent);
    el("btn-del").addEventListener("click", delCurrent);
    el("pass").addEventListener("keydown", function (e) {
      if (e.key === "Enter") unlock();
    });
  }

  function bufToB64(buf) {
    var u = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }
  function b64ToBuf(b64) {
    var s = atob(b64);
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  }

  async function deriveKey(pass, salt) {
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: 120000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encrypt(text) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, cryptoKey, new TextEncoder().encode(text));
    return { iv: bufToB64(iv), ct: bufToB64(ct) };
  }

  async function decrypt(ivB64, ctB64) {
    var pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(ivB64)) },
      cryptoKey,
      b64ToBuf(ctB64)
    );
    return new TextDecoder().decode(pt);
  }

  function loadRaw() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveRaw(obj) {
    localStorage.setItem(KEY, JSON.stringify(obj));
  }

  async function unlock() {
    var pass = el("pass").value;
    if (!pass) { toast("passphrase required"); return; }
    var store = loadRaw();
    var salt;
    if (!store || !store.salt) {
      salt = crypto.getRandomValues(new Uint8Array(16));
      cryptoKey = await deriveKey(pass, salt);
      notes = [];
      saveRaw({ salt: bufToB64(salt), notes: [] });
      toast("vault created");
    } else {
      salt = new Uint8Array(b64ToBuf(store.salt));
      cryptoKey = await deriveKey(pass, salt);
      try {
        notes = [];
        for (var i = 0; i < (store.notes || []).length; i++) {
          var n = store.notes[i];
          var title = await decrypt(n.tiv, n.tct);
          var body = await decrypt(n.biv, n.bct);
          notes.push({ id: n.id, title: title, body: body });
        }
        toast("unlocked");
      } catch (e) {
        cryptoKey = null;
        toast("wrong passphrase");
        return;
      }
    }
    el("lock-panel").classList.add("hidden");
    el("vault-panel").classList.remove("hidden");
    renderList();
  }

  function lock() {
    cryptoKey = null;
    notes = [];
    el("pass").value = "";
    el("note-title").value = "";
    el("note-body").value = "";
    el("vault-panel").classList.add("hidden");
    el("lock-panel").classList.remove("hidden");
  }

  function renderList() {
    var ul = el("note-list");
    ul.innerHTML = "";
    notes.forEach(function (n, idx) {
      var li = document.createElement("li");
      li.textContent = n.title || "(untitled)";
      li.addEventListener("click", function () {
        el("note-title").value = n.title;
        el("note-body").value = n.body;
        el("note-title").dataset.idx = String(idx);
      });
      ul.appendChild(li);
    });
  }

  async function persist() {
    if (!cryptoKey) return;
    var encNotes = [];
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      var te = await encrypt(n.title || "");
      var be = await encrypt(n.body || "");
      encNotes.push({ id: n.id, tiv: te.iv, tct: te.ct, biv: be.iv, bct: be.ct });
    }
    var store = loadRaw() || {};
    store.notes = encNotes;
    saveRaw(store);
  }

  function addNote() {
    var id = Date.now().toString(36);
    notes.push({ id: id, title: "new note", body: "" });
    renderList();
    el("note-title").value = "new note";
    el("note-body").value = "";
    el("note-title").dataset.idx = String(notes.length - 1);
    persist();
  }

  async function saveCurrent() {
    var idx = parseInt(el("note-title").dataset.idx || "-1", 10);
    if (isNaN(idx) || idx < 0 || idx >= notes.length) {
      toast("select or add a note");
      return;
    }
    notes[idx].title = el("note-title").value;
    notes[idx].body = el("note-body").value;
    await persist();
    renderList();
    toast("saved");
  }

  async function delCurrent() {
    var idx = parseInt(el("note-title").dataset.idx || "-1", 10);
    if (isNaN(idx) || idx < 0 || idx >= notes.length) return;
    notes.splice(idx, 1);
    el("note-title").value = "";
    el("note-body").value = "";
    delete el("note-title").dataset.idx;
    await persist();
    renderList();
    toast("deleted");
  }
})();
