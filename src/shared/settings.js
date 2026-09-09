/* Shared settings schema. Loaded by both the content script and the popup (plain script, no modules). */
(function (global) {
  "use strict";

  var api = global.browser || global.chrome;

  // Each key becomes an `html.tcgam-<key>` class when truthy (booleans). Keys must never collide with
  // the UI element classes (tcgam-ui-*), or a rule meant for an element would hit <html> itself or a CSS
  // custom property `--tcgam-<key>` (numbers). Labels are shown in the popup and in-page panel.
  var SCHEMA = [
    { key: "enabled",      type: "bool",  default: true,  label: "Enable TCGA Mobile" },
    { key: "hideChat",     type: "bool",  default: true,  label: "Hide chat / game log" },
    { key: "hideNavbar",   type: "bool",  default: true,  label: "Hide site navigation bar in game" },
    { key: "compactBars",  type: "bool",  default: true,  label: "Compact side bar and buttons" },
    { key: "sideDrawer",   type: "bool",  default: true,  label: "Side bar as a slide-out drawer with big buttons" },
    { key: "compactLobby", type: "bool",  default: true,  label: "Simplify lobby (keep only the Connect tabs)" },
    { key: "noZoom",       type: "bool",  default: true,  label: "Block zoom and browser panning" },
    { key: "autoFullscreen", type: "bool", default: true, label: "Fullscreen on first tap (hides browser bar)" },
    { key: "lockLandscape",  type: "bool", default: true, label: "Lock to landscape while fullscreen" },
    { key: "quickMenu",    type: "bool",  default: true,  label: "Show floating menu button" },
    // Lays the page out at a desktop-like width and lets the browser scale it down, so rem-based text
    // and Bootstrap spacing shrink to match the vh-based board. 0 = use the real device width.
    { key: "layoutWidth",  type: "range", default: 1280, min: 0, max: 1920, step: 80, unit: "px", label: "Virtual screen width (0 = device width)" }
  ];

  var DEFAULTS = {};
  SCHEMA.forEach(function (f) { DEFAULTS[f.key] = f.default; });

  function load() {
    return api.storage.local.get("settings").then(function (res) {
      return Object.assign({}, DEFAULTS, (res && res.settings) || {});
    });
  }

  function save(settings) {
    return api.storage.local.set({ settings: settings });
  }

  function onChange(cb) {
    api.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes.settings) {
        cb(Object.assign({}, DEFAULTS, changes.settings.newValue || {}));
      }
    });
  }

  global.TCGAM = { api: api, SCHEMA: SCHEMA, DEFAULTS: DEFAULTS, load: load, save: save, onChange: onChange };
})(typeof globalThis !== "undefined" ? globalThis : window);
