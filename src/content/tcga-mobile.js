/* TCGA Mobile content script. Runs at document_start on tcg-arena.fr.
 * All visual changes are driven by classes on <html>, so the CSS file does the heavy lifting
 * and React never sees DOM it doesn't own. */
(function () {
  "use strict";

  var T = globalThis.TCGAM; // NOT window.TCGAM: in Firefox content scripts `window` is the page, not the sandbox
  var current = Object.assign({}, T.DEFAULTS);

  // Never cache the root element: at document_start Firefox can still swap it, and a cached
  // reference ends up parented to the Document itself (observed: a stray .tcgam-ui-fab whose
  // parentNode === document). Always resolve it at call time.
  function root() { return document.documentElement; }

  // A second injection into the same document (add-on reload during development) takes over:
  // drop the previous instance's UI so it is rebuilt with the new code.
  if (root()) {
    root().setAttribute("data-tcgam", "");
    Array.prototype.forEach.call(document.querySelectorAll('[class^="tcgam-ui-"]'), function (e) { e.remove(); });
  }

  function apply(settings) {
    current = settings;
    var html = root();
    if (!html) return;
    html.classList.toggle("tcgam", !!settings.enabled);
    T.SCHEMA.forEach(function (f) {
      if (f.key === "enabled") return;
      if (f.type === "bool") {
        html.classList.toggle("tcgam-" + f.key, !!settings.enabled && !!settings[f.key]);
      } else if (f.type === "range") {
        html.style.setProperty("--tcgam-" + f.key, settings[f.key] + (f.unit || ""));
      }
    });
    fixViewport();
    applyFullscreenScale();
    renderPanel();
  }

  /* Firefox for Android ignores the viewport meta while an element is fullscreen and lays the page
   * out at device width again. Emulate the virtual width there by scaling the root font size:
   * rem-based text and spacing shrink, vh-based board geometry is untouched. */
  function applyFullscreenScale() {
    var html = root();
    if (!html) return;
    // The viewport meta is ignored in fullscreen and in Firefox's "Desktop site" mode; in both the layout
    // width is whatever the browser chose. Scale the root font so rem-based UI matches the virtual width.
    var honored = Math.abs(window.innerWidth - current.layoutWidth) <= 4;
    var inGame = !!document.querySelector(".game");   // don't scale the site's home/portrait screens
    if (current.enabled && current.layoutWidth > 0 && !honored && inGame) {
      var z = window.innerWidth / current.layoutWidth;    // < 1 on a phone in fullscreen, > 1 in desktop mode
      html.style.setProperty("--tcgam-fsScale", z.toFixed(4));
      html.classList.add("tcgam-fsscale");
    } else {
      html.classList.remove("tcgam-fsscale");
      html.style.removeProperty("--tcgam-fsScale");
    }
  }
  window.addEventListener("resize", applyFullscreenScale);

  /* --- Viewport: cover the notch and stop iOS Safari zooming on input focus --- */
  function fixViewport() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      (document.head || root()).appendChild(meta);
    }
    var width = current.enabled && current.layoutWidth > 0 ? String(current.layoutWidth) : "device-width";
    var content = "width=" + width + ", viewport-fit=cover";
    if (width === "device-width") content += ", initial-scale=1";
    if (current.enabled && current.noZoom) content += ", user-scalable=no";
    if (meta.getAttribute("content") !== content) meta.setAttribute("content", content);
  }

  /* --- Fullscreen: the only way to hide the browser's own toolbar. Needs a user gesture,
   * so we piggyback on the first tap inside the board. --- */
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function requestFullscreen() {
    var el = root();
    var fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return Promise.reject(new Error("Fullscreen API unavailable"));
    try {
      var r = fn.call(el, { navigationUI: "hide" });
      return r && r.then ? r : Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }
  function exitFullscreen() {
    var fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (fn) fn.call(document);
  }
  var fsArmed = true;
  function onFirstTap(e) {
    if (!current.enabled || !current.autoFullscreen || !fsArmed || isFullscreen()) return;
    if (!e.target.closest || !e.target.closest(".game")) return;
    if (e.target.closest(".tcgam-ui-panel, .tcgam-ui-fab")) return;
    fsArmed = false;                 // one attempt per fullscreen session; re-armed on exit below
    requestFullscreen().catch(function () {});
  }
  document.addEventListener("pointerup", onFirstTap, true);
  function onFullscreenChange() {
    if (!isFullscreen()) fsArmed = false;
    applyFullscreenScale();
    renderPanel();
  }
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  /* Re-arm auto-fullscreen only when a new game screen appears, so leaving fullscreen on purpose sticks. */
  new MutationObserver(function () {
    if (!document.querySelector(".game")) fsArmed = true;
    applyFullscreenScale();            // .game can mount/unmount on rotation; keep scaling in sync
  }).observe(root(), { childList: true, subtree: true });

  /* --- Visual viewport: the on-screen keyboard shrinks it while 100dvh stays put. Expose its size so
   * overlays (chat) can size to the visible area and keep the input above the keyboard. --- */
  function trackVisualViewport() {
    var vv = window.visualViewport;
    if (!vv) return;
    function update() {
      var h = root();
      if (!h) return;
      h.style.setProperty("--tcgam-vvh", Math.round(vv.height) + "px");
      h.style.setProperty("--tcgam-vvtop", Math.round(vv.offsetTop) + "px");
      h.classList.toggle("tcgam-keyboard", vv.height < window.innerHeight * 0.75);
      placeNotesForKeyboard();
    }
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
  }
  trackVisualViewport();

  /* --- Side drawer: the game's left bar slides in from the left edge via a handle --- */
  var handle;
  function setDrawer(open) {
    root().classList.toggle("tcgam-drawer-open", !!open);
    var lb = document.querySelector(".left-bar"); if (lb) lb.scrollLeft = 0;   // never show it scrolled sideways
    if (handle) handle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function ensureHandle() {
    if (handle || !document.body) return;
    handle = document.querySelector(".tcgam-ui-handle");
    if (!handle) {
      handle = document.createElement("button");
      handle.type = "button";
      handle.className = "tcgam-ui-handle";
      handle.setAttribute("aria-label", "Toggle game side bar");
      handle.innerHTML = '<span class="tcgam-ui-chev"></span><span class="tcgam-ui-turn"></span><span class="tcgam-ui-time"></span>';
      document.body.appendChild(handle);
    }
    // Mirror the turn counter and turn timer from inside the (hidden) bar onto the handle
    setInterval(function () {
      var tc = document.querySelector(".left-bar .turn-count");
      var tt = document.querySelector(".left-bar .game-timer.turn-time");
      var turnEl = handle.querySelector(".tcgam-ui-turn"), timeEl = handle.querySelector(".tcgam-ui-time");
      var turn = tc ? tc.textContent.trim().replace(/^Turn\s*/i, "T") : "";
      var time = tt ? tt.textContent.trim() : "";
      if (turnEl.textContent !== turn) turnEl.textContent = turn;
      if (timeEl.textContent !== time) timeEl.textContent = time;
      handle.classList.toggle("tcgam-ui-hasinfo", !!(turn || time));
    }, 1000);
    handle.addEventListener("click", function (e) {
      e.stopPropagation();
      setDrawer(!root().classList.contains("tcgam-drawer-open"));
    });
    // Tap anywhere outside the bar closes it
    document.addEventListener("pointerdown", function (e) {
      if (!root().classList.contains("tcgam-drawer-open")) return;
      if (e.target.closest && (e.target.closest(".left-bar") || e.target.closest(".tcgam-ui-handle"))) return;
      setDrawer(false);
    }, true);
  }

  /* --- Chat / reactions overlays: a tap anywhere outside dismisses them --- */
  document.addEventListener("pointerdown", function (e) {
    var h = root();
    if (!h || !e.target.closest) return;
    var inside = e.target.closest(".history, .tcgam-ui-chat, .tcgam-ui-emoji, .tcgam-ui-panel, .tcgam-ui-fab");
    if (inside) return;
    if (h.classList.contains("tcgam-chat-peek")) { h.classList.remove("tcgam-chat-peek"); renderPanel(); }
    if (h.classList.contains("tcgam-emoji-open")) h.classList.remove("tcgam-emoji-open");
  }, true);

  /* --- Card counters: the site focuses the new counter's number field for typing; on a phone that just
   * raises the keyboard over the board. Use the arrows instead. --- */
  function blurCounterInput() {
    var a = document.activeElement;
    if (a && a.matches && a.matches(".card-counters .counter input")) a.blur();
  }
  document.addEventListener("focusin", function (e) {
    if (!current.enabled || !e.target || !e.target.matches) return;
    if (e.target.matches(".card-counters .counter input")) {
      e.target.blur();
      setTimeout(blurCounterInput, 0);
    }
    // Touching anything in the player block momentarily mounts the notes panel (site hover state) and its
    // textarea autofocuses: the keyboard flashes. Only allow focus when the panel was opened on purpose.
    if (e.target.matches(".notes-content textarea") && !e.target.closest(".tcgam-notes-open")) {
      e.target.blur();
    }
  }, true);
  // the +/- handlers re-focus the field after updating; a focused field also disables the game's hotkeys
  document.addEventListener("click", function (e) {
    if (current.enabled && e.target.closest && e.target.closest(".card-counters .number-controls")) setTimeout(blurCounterInput, 80);
  }, true);

  /* --- Player notes: the site shows the toggle and its text panel on hover only. The panel is only
   * *rendered* while React's onPointerEnter state is true, so fake the pointer hover along with our
   * open/close class, and swallow the pointerout that a lifted finger produces while it is open. --- */
  // With the keyboard up, move the open notes panel into the visible strip. position:fixed will not do:
  // the counters block is transformed, so fixed descendants stay relative to it.
  function placeNotesForKeyboard() {
    var c = document.querySelector(".notes.tcgam-notes-open .notes-content");
    if (!c) return;
    var vv = window.visualViewport;
    if (!vv || !root().classList.contains("tcgam-keyboard")) { c.style.translate = ""; c.style.height = ""; return; }
    var margin = Math.round(window.innerHeight * 0.015);
    c.style.height = Math.round(vv.height - margin * 2 - window.innerHeight * 0.05) + "px";
    c.style.translate = "";
    var top = c.getBoundingClientRect().top;
    c.style.translate = "0 " + Math.round(margin - top) + "px";
  }
  var notesSync = false;
  function setNotesOpen(notes, open) {
    notes.classList.toggle("tcgam-notes-open", open);
    var btn = document.querySelector(".tcgam-ui-notes"); if (btn) btn.classList.toggle("tcgam-ui-held", open);
    if (!open) { var c = notes.querySelector(".notes-content"); if (c) { c.style.translate = ""; c.style.height = ""; } }
    notesSync = true;
    try {
      if (open) notes.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      else notes.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: document.body }));
    } finally { notesSync = false; }
  }
  document.addEventListener("pointerup", function (e) {
    if (!current.enabled || !e.target.closest) return;
    if (e.target.closest(".notes-content, .tcgam-ui-notes")) return;   // typing inside, or the toggle button
    Array.prototype.forEach.call(document.querySelectorAll(".notes.tcgam-notes-open"), function (n) {
      setNotesOpen(n, false);                                            // any other tap closes the panel
    });
  }, true);
  ["pointerout", "pointerleave", "mouseout", "mouseleave"].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (notesSync) return;
      var notes = e.target.closest && e.target.closest(".notes.tcgam-notes-open");
      if (notes) e.stopPropagation();
    }, true);
  });

  /* --- Scheduled-pause diamonds: long-press shows the tooltip (hover-only on the site), a quick tap
   * toggles the pause as before and the tooltip a tap leaves behind is closed. --- */
  var lpTimer = null, lpTarget = null, lpFired = false;
  function tooltipOver(el)  { el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); }
  function tooltipOut(el)   { el.dispatchEvent(new MouseEvent("mouseout",  { bubbles: true, relatedTarget: document.body })); }
  document.addEventListener("pointerdown", function (e) {
    var w = e.target.closest && e.target.closest(".scheduled-pauses .wrapper");
    if (!w || !current.enabled) return;
    lpTarget = w; lpFired = false;
    clearTimeout(lpTimer);
    lpTimer = setTimeout(function () { lpFired = true; tooltipOver(w); }, 450);
  }, true);
  function endLongPress() {
    if (!lpTarget) return;
    clearTimeout(lpTimer);
    var w = lpTarget; lpTarget = null;
    setTimeout(function () { tooltipOut(w); }, lpFired ? 2000 : 250);
  }
  document.addEventListener("pointerup", endLongPress, true);
  document.addEventListener("pointercancel", endLongPress, true);
  document.addEventListener("click", function (e) {
    if (lpFired && e.target.closest && e.target.closest(".scheduled-pauses .wrapper")) {
      e.stopPropagation(); e.preventDefault(); lpFired = false;      // a long press only shows the tooltip
    }
  }, true);
  // the life total field: the +/- arrows re-focus it, same as card counters
  document.addEventListener("click", function (e) {
    if (current.enabled && e.target.closest && e.target.closest(".player-counters .number-controls, .custom-section .number-controls")) {
      setTimeout(function () { var a = document.activeElement; if (a && a.matches && a.matches(".player-counters input, .custom-section input")) a.blur(); }, 80);
    }
  }, true);

  /* --- Stack column: cards peek in from the right edge; first tap slides them in, a tap elsewhere hides.
   * The zone's action row (Resolve...) counts as inside. While a modifier key is held (adding cards) the
   * pile is left alone, and it opens by itself when a card is added and closes when it empties. --- */
  var heldKey = function () { return null; };
  var stackCount = -1;
  function setStackOpen(open) { root().classList.toggle("tcgam-stack-open", !!open); }
  document.addEventListener("pointerdown", function (e) {
    var h = root();
    if (!h || !current.enabled || !e.target.closest) return;
    var onStack = e.target.closest(".game-card.Stack");
    var onZone = e.target.closest(".stack-wrapper, .stack, [class^=\"tcgam-ui-\"]");   // zone row and our own buttons
    var open = h.classList.contains("tcgam-stack-open");
    if (onStack && !open) {
      e.stopPropagation();
      e.preventDefault();              // swallow this tap so the card's own menu does not open yet
      setStackOpen(true);
    } else if (!onStack && !onZone && open && !heldKey()) {
      setStackOpen(false);
    }
  }, true);
  new MutationObserver(function () {
    var n = document.querySelectorAll(".game-card.Stack").length;
    if (n === stackCount) return;
    if (stackCount >= 0) {
      if (n > stackCount) setStackOpen(true);       // something was added: show it
      else if (n === 0) setStackOpen(false);        // pile emptied: tuck it away
    }
    stackCount = n;
  }).observe(root(), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

  /* --- Floating quick-menu button + in-page panel (the extension popup is awkward to reach on iOS) --- */
  var fab, panel;

  function ensureUi() {
    if (!document.body) return;
    var existing = document.querySelector(".tcgam-ui-fab");
    if (existing) { fab = existing; panel = document.querySelector(".tcgam-ui-panel"); return; }
    fab = document.createElement("button");
    fab.type = "button";
    fab.className = "tcgam-ui-fab";
    fab.title = "TCGA Mobile";
    fab.setAttribute("aria-label", "TCGA Mobile menu");
    fab.textContent = "☰";
    fab.addEventListener("click", function (e) {
      e.stopPropagation();
      panel.classList.toggle("tcgam-ui-open");
    });

    panel = document.createElement("div");
    panel.className = "tcgam-ui-panel";
    panel.addEventListener("click", function (e) { e.stopPropagation(); });

    document.addEventListener("click", function (e) {
      if (e.target.closest && (e.target.closest(".tcgam-ui-fab") || e.target.closest(".tcgam-ui-panel"))) return;
      panel.classList.remove("tcgam-ui-open");
    }, true);

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    var chat = document.querySelector(".tcgam-ui-chat");
    if (!chat) {
      chat = document.createElement("button");
      chat.type = "button";
      chat.className = "tcgam-ui-chat";
      chat.title = "Show / hide chat";
      chat.setAttribute("aria-label", "Show or hide chat");
      chat.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4z"/></svg>';
      chat.addEventListener("click", function (e) {
        e.stopPropagation();
        root().classList.toggle("tcgam-chat-peek");
        renderPanel();
      });
      document.body.appendChild(chat);
    }
    // Shortcut keys. The game's hotkeys are *modifiers*: while a key is held it sets an "action mode"
    // (T = card effect, P = ping...) and the next card tap performs that action; releasing clears it.
    // Backspace is different: keydown immediately calls undo. So Backspace is a plain press and T is a
    // sticky modifier: tap to hold, then tap a card (auto-release), or tap T again to release.
    function keyEvent(type, key, code, keyCode) {
      return new KeyboardEvent(type, { key: key, code: code, keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true });
    }
    function pressKey(key, code, keyCode) {
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      document.body.dispatchEvent(keyEvent("keydown", key, code, keyCode));
      // The game stores key events in React state; a keyup in the same tick gets batched over the
      // keydown and the press is never processed. Release on a later tick like a real key would.
      setTimeout(function () { document.body.dispatchEvent(keyEvent("keyup", key, code, keyCode)); }, 80);
    }
    var held = null, heldTimer = null;
    heldKey = function () { return held; };
    function holdKey(btn, key, code, keyCode) {
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      document.body.dispatchEvent(keyEvent("keydown", key, code, keyCode));
      held = { btn: btn, key: key, code: code, keyCode: keyCode };
      btn.classList.add("tcgam-ui-held");
      armHoldTimer();
    }
    function armHoldTimer() {
      clearTimeout(heldTimer);
      heldTimer = setTimeout(releaseKey, 15000);     // safety: never stay stuck in a mode
    }
    function releaseKey() {
      if (!held) return;
      document.body.dispatchEvent(keyEvent("keyup", held.key, held.code, held.keyCode));
      held.btn.classList.remove("tcgam-ui-held");
      held = null;
      clearTimeout(heldTimer);
    }
    // A card tap while a modifier is held performs the action and releases the key right after it,
    // so the button reads as "armed for one card". Tap it again for the next card.
    document.addEventListener("pointerup", function (e) {
      if (held && e.target.closest && e.target.closest(".game-card")) setTimeout(releaseKey, 150);
    }, true);

    function keyButton(cls, label, title, onTap) {
      var b = document.querySelector("." + cls);
      if (b) return b;
      b = document.createElement("button");
      b.type = "button";
      b.className = "tcgam-ui-key " + cls;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.textContent = label;
      b.addEventListener("click", function (e) { e.stopPropagation(); onTap(b); });
      document.body.appendChild(b);
      return b;
    }
    keyButton("tcgam-ui-key-back", "\u232B", "Backspace: undo last action", function () {
      pressKey("Backspace", "Backspace", 8);
    });
    keyButton("tcgam-ui-key-t", "T", "T: hold, then tap a card", function (b) {
      if (held && held.btn === b) releaseKey(); else holdKey(b, "t", "KeyT", 84);
    });
    var endBtn = keyButton("tcgam-ui-key-end", "", "End your turn (space)", function () {
      pressKey(" ", "Space", 32);
    });
    endBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 9v6h16V9"/></svg>';   // spacebar glyph

    // Fullscreen toggle (same as the entry in the quick menu)
    var fsBtn = keyButton("tcgam-ui-key-fs", "", "Fullscreen", function () {
      if (isFullscreen()) exitFullscreen(); else requestFullscreen().catch(function () {});
    });
    function syncFsIcon() {
      var fs = isFullscreen();
      if (fs) fsBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
      else    fsBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
      fsBtn.title = fs ? "Exit fullscreen" : "Fullscreen";
    }
    syncFsIcon();
    document.addEventListener("fullscreenchange", syncFsIcon);
    document.addEventListener("webkitfullscreenchange", syncFsIcon);
    var notesBtn = keyButton("tcgam-ui-notes", "\u270E", "Player notes", function () {
      var n = document.querySelector(".player-counters-wrapper:not(.opponent) .notes");
      if (n) setNotesOpen(n, !n.classList.contains("tcgam-notes-open"));
    });
    function syncNotesIcon() {
      if (notesBtn.querySelector("img")) return;
      var img = document.querySelector(".player-counters-wrapper:not(.opponent) .notes img.notes-toggle");
      if (img) { notesBtn.textContent = ""; var im = document.createElement("img"); im.src = img.getAttribute("src"); im.alt = ""; notesBtn.appendChild(im); }
    }
    syncNotesIcon();
    setInterval(syncNotesIcon, 2000);

    var emoji = document.querySelector(".tcgam-ui-emoji");
    if (!emoji) {
      emoji = document.createElement("button");
      emoji.type = "button";
      emoji.className = "tcgam-ui-emoji";
      emoji.title = "Quick reactions";
      emoji.setAttribute("aria-label", "Show or hide quick reactions");
      emoji.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>';
      emoji.addEventListener("click", function (e) {
        e.stopPropagation();
        var h = root();
        var open = !h.classList.contains("tcgam-emoji-open");
        h.classList.toggle("tcgam-emoji-open", open);
        if (open && !document.querySelector(".history .emoji-row")) {
          // The site only renders the row when its own "quick emojis" toggle is on; flip it for the user.
          var img = document.querySelector('.chatbox-wrapper img[alt="Quick Emojis"]');
          var btn = img && img.closest("button");
          if (btn) btn.click();
        }
      });
      document.body.appendChild(emoji);
    }
    renderPanel();
  }

  function renderPanel() {
    if (!panel) return;
    panel.innerHTML = "";
    var title = document.createElement("div");
    title.className = "tcgam-ui-panel-title";
    title.textContent = "TCGA Mobile \u2013 Settings";
    panel.appendChild(title);

    T.SCHEMA.forEach(function (f) {
      var row = document.createElement("label");
      row.className = "tcgam-ui-row";
      if (f.type === "bool") {
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!current[f.key];
        cb.addEventListener("change", function () {
          var next = Object.assign({}, current); next[f.key] = cb.checked; T.save(next);
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(" " + f.label));
      } else if (f.type === "range") {
        var text = document.createElement("span");
        text.textContent = f.label + ": " + current[f.key] + (f.unit || "");
        var range = document.createElement("input");
        range.type = "range"; range.min = f.min; range.max = f.max; range.step = f.step; range.value = current[f.key];
        range.addEventListener("input", function () {
          text.textContent = f.label + ": " + range.value + (f.unit || "");
        });
        range.addEventListener("change", function () {
          var next = Object.assign({}, current); next[f.key] = Number(range.value); T.save(next);
        });
        row.appendChild(text);
        row.appendChild(range);
      }
      panel.appendChild(row);
    });

  }


  function boot() {
    ensureUi();
    ensureHandle();
  }

  T.load().then(function (s) {
    apply(s);
    if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot, { once: true });
  });

  T.onChange(function (s) { apply(s); });
})();
