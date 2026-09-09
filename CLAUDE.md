# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A WebExtension that makes https://www.tcg-arena.fr (a React + Vite + Bootstrap card-game simulator that
officially supports desktop only) playable on phones. It ships as two builds from one `src/` folder:
Safari on iOS (Manifest V3, wrapped in an Xcode app) and Firefox for Android (Manifest V2). There is no
background script: everything is a content script (`src/content/`) plus `storage` for settings, so
behaviour is identical in both browsers. README.md covers the platform rationale, device setup and
publishing; this file covers how the code works and how to extend it safely.

## Commands

```sh
npm run build             # dist/firefox + dist/safari (copies src/ + the right manifest, stamps version)
npm run build:firefox     # only the Firefox build (what the Android dev loop watches)
npm run lint:firefox      # build + web-ext lint; must stay at 0 errors / 0 warnings (AMO rejects otherwise)
npm run run:firefox       # desktop Firefox with the extension on /play
ADB_DEVICE=emulator-5554 npm run run:android   # Firefox for Android on a device/emulator (see below)
npm run package:firefox   # zip for addons.mozilla.org
npm run safari:convert    # regenerate safari/ Xcode project from dist/safari (one-time; project references dist/)
node scripts/make-icons.mjs   # regenerate src/icons/*.png (placeholder icons, no deps)
```

There is no test suite. Verification is done live against the real site (next section). Do not edit
`dist/`; it is regenerated on every build.

### Live verification loop (Firefox for Android)

`web-ext run --target firefox-android` installs a *temporary* add-on and hot-reloads it whenever
`dist/firefox` changes, so after editing `src/` run `npm run build:firefox` and wait ~8s; the content
script re-injects into the open tab without a page reload (see "re-injection" below). It also forwards
Firefox's remote debugging protocol to a local TCP port (printed as "You can connect to this Android
device on TCP port NNNN"). `scripts/rdp.mjs` evaluates JavaScript in the tcg-arena tab through that port:

```sh
node scripts/rdp.mjs <port> 'JSON.stringify({w: innerWidth, fs: !!document.fullscreenElement})'
```

Combine it with `adb shell input tap X Y` and `adb exec-out screencap -p > shot.png` to drive and
inspect the UI. Physical pixel = 148 + cssX * dpr for X (the emulator has a 148px cutout band) and
cssY * dpr for Y while fullscreen; read `devicePixelRatio` and `visualViewport.scale` rather than
assuming. `location.reload()` triggers the site's "leave this site?" prompt; a game must be started
by hand (deck required) and the state is lost on reload, so prefer hot-reload over page reloads.
rdp.mjs does not await Promises and cannot see content-script console output; return JSON strings.

## Architecture

### Settings drive `<html>` classes; CSS does the work

`src/shared/settings.js` is the single schema (loaded by both the content script and the popup as a
plain script; it exposes `globalThis.TCGAM`). Every boolean setting `foo` becomes `html.tcgam-foo`
when on, every range setting becomes `--tcgam-foo` on `<html>`. `html.tcgam` itself is the master
switch. Almost every visual change is therefore a CSS rule gated on `html.tcgam.tcgam-<setting>` in
`src/content/tcga-mobile.css`, and toggling a setting in the popup or in-page menu applies instantly
via `storage.onChanged`. To add a simple feature: add a schema entry, add gated CSS, done; the popup and
the in-page menu render from the schema automatically.

Setting keys must never collide with UI element classes, which all use the `tcgam-ui-*` prefix. A
setting named `fab` once put `tcgam-fab` on `<html>` and the button's `display:none` hid the whole page.

State classes toggled by the content script at runtime (not settings): `tcgam-drawer-open`,
`tcgam-stack-open`, `tcgam-chat-peek`, `tcgam-emoji-open`, `tcgam-keyboard`, `tcgam-fsscale`, and
`tcgam-notes-open` (on the site's `.notes` element, not `<html>`).

### The content script (`src/content/tcga-mobile.js`)

One IIFE, organised in commented `/* --- ... --- */` sections in this order: settings apply, viewport meta,
fullscreen, visual viewport tracking, side drawer, overlay dismissal, card counters, player notes,
scheduled-pause diamonds, stack column, then `ensureUi()` which builds all injected buttons (menu, chat,
reactions, ⌫/T/End-turn/Notes/Fullscreen keys) and `renderPanel()` for the in-page settings panel.
`boot()` runs at DOMContentLoaded (the script runs at `document_start`, when `document.body` is null).

Rules that matter when editing it:

- Never cache `document.documentElement`; call `root()`. At `document_start` Firefox can still swap it.
- Read shared globals via `globalThis`, never `window.X`: in Firefox content scripts `window` is the page.
- Re-injection: on add-on reload the new instance removes every `[class^="tcgam-ui-"]` element and rebuilds.
  Old listeners stay attached but only reference removed nodes. Any new injected element must use the
  `tcgam-ui-` prefix so it is cleaned up.
- Injected elements are appended to `document.body` (React owns only `#root`). Their visibility is CSS-gated
  on `html.tcgam...:has(.game)` / `:has(.player-boards)` so they only appear in game.
- Sizes for anything touch-related are in `vh`, never `rem`/`px`: a CSS px is a different physical size in the
  virtual-width layout than in fullscreen, but 1vh is the same screen fraction in both.

### The two layout modes

"Virtual screen width" (default 1280) sets `<meta name=viewport content="width=1280">` so the site lays out
like a small desktop and the browser scales it down. Firefox for Android ignores that meta while an
element is fullscreen and snaps back to device width, so in fullscreen the script instead scales the root
`font-size` by `deviceWidth / virtualWidth` (`html.tcgam-fsscale`, `--tcgam-fsScale`). Root `zoom` was
tried and rejected: Firefox scales viewport units under zoom. Fullscreen needs a user gesture; the first
`pointerup` inside `.game` requests it (`autoFullscreen`), and there is a Fullscreen button too. While fullscreen, `screen.orientation.lock("landscape")` keeps the device in landscape (the API only works in fullscreen; the lock auto-releases on exit).

### Keyboard, chat and other overlays

`trackVisualViewport()` publishes `--tcgam-vvh` and toggles `html.tcgam-keyboard` when the on-screen
keyboard shrinks the visual viewport (`100dvh` does not shrink). Use only the height: Firefox reports a
`visualViewport.offsetTop` while the keyboard is up that it does not render for fixed elements. The chat
overlay is sized from `--tcgam-vvh`. The notes panel cannot use `position:fixed` because its ancestor is
transformed, so `placeNotesForKeyboard()` measures and translates it instead. Corner buttons hide while
`tcgam-keyboard` is set.

### Synthetic keyboard input

The game's hotkeys are React state: a window `keydown` stores the event and an effect processes it.
`pressKey()` therefore dispatches `keyup` on a later tick (80ms); keydown+keyup in the same tick get
batched and the press is lost. Most letters are *modifiers* (hold T, then click a card); Backspace calls
undo directly. `holdKey()`/`releaseKey()` implement the sticky T button (auto-released after one card tap,
15s safety timer); `heldKey()` lets the stack handler avoid closing while a modifier is held. A focused
text field disables the game's hotkeys (`isTextInputFocused`), which is why counter fields are blurred.

### Site DOM the extension depends on

Class names in the production bundle are stable and human-readable. The ones used here:

| Site element | Selector | Notes |
|---|---|---|
| Game screen root | `.game` (flex row `hstack`) | exists in lobby too; `.player-boards` only in a running game |
| Left tool bar | `.left-bar` | turned into the drawer; `.turn-count`, `.game-timer.turn-time` mirrored onto the handle |
| Chat / log | `.history` > `.content`, `.chatbox-wrapper`, `.emoji-row` | Bootstrap `end-0`/`bottom-0` on it are `!important` |
| Cards | `.game-card.<Zone>` with `index-N`/`reversed-index-N` | positioned by JS via inline `transform: translate()`; move them with CSS `translate`, which composes |
| Stack pile | `.game-card.Stack`, zone `.stack` (fixed, `right:1vh`), action row `.stack-wrapper .buttons` | top card is `reversed-index-0` |
| Board width | inline `padding-right: 32vh` on three containers + `calc(100vw - 32vh - 5rem)` zone widths | overridden to a 14.5vh strip via `[style*="padding-right: 32vh"]` |
| Player block | `.player-counters-wrapper:not(.opponent)`, `.scheduled-pauses .wrapper .diamond`, `.top-buttons .notes`, `.player-counters .number-control` | `.player-counter-position-wrapper` is the outer stacking context (z 200) |
| Counters | `.card-counters .counter .number-control`, `.custom-section .number-control` (Energy/Power) | `.number-controls` are the hover-only arrows |
| Lobby | `.box-container.step.step-1/2/3`, `.waiting-room`, `.room-player` | |
| Mobile hooks | `body.mobile` (site's own coarse-pointer detection), `.card-focus-mobile` menu | site blocks portrait entirely with its own notice |

Recurring gotchas with this site:

- Hover-only UI is often *rendered* on hover, not just shown. React derives `onMouseEnter` from
  `mouseover`/`mouseout` and `onPointerEnter` from `pointerover`/`pointerout`; the notes panel needs a
  synthetic `pointerover` to exist. Check which one a component uses before faking hover.
- The board cancels default pointer handling, so `click` may never fire there; use `pointerup`.
- Touch starts the site's `:hover` state, which can move or resize the target mid-tap (the pause
  diamonds) or mount an autofocusing field (notes textarea → keyboard flash). Pin hover layouts and blur.
- Site utilities like `.end-0`, `.w-50`, `.p-5` are `!important`; overrides need `!important` and
  higher specificity. When two extension rules tie, source order in the CSS file decides.
- Equal z-indexes fall back to DOM order (the stack showed the wrong top card); mirror the site's ordering.
- `.App-header` is `min-height:100vh` and centers; on mobile 100vh includes the toolbar area. Pinned to `100dvh`.
- Card size cannot be changed from CSS. Every `.game-card` gets inline width/height from its zone's configured
  height times `innerHeight/100`, and positions are laid out from those sizes; `.game{--card-height}` only
  feeds the deck/discard placeholders and `.hand-board-section`. A "card height" slider was removed for this.

## Adding a feature: checklist

1. Find the site element with rdp.mjs (`elementsFromPoint`, `outerHTML` slices, computed styles) or from the
   downloaded bundle (`curl https://www.tcg-arena.fr/` for the current `/assets/index-*.js|css` names).
2. Prefer a CSS rule gated on `html.tcgam` (and a setting class if it should be optional). Reach for JS only
   for state that CSS cannot see (taps, keyboard, counts).
3. Size in `vh`; keep the new element inside the left or right button column. Buttons are 8vh squares in
   9.5vh steps: right column tops are 1.5vh, 11vh, 20.5vh, 30vh…; the left column starts at 15vh below the
   12vh drawer handle (15vh, 24.5vh, 34vh…) and shifts right by 15vh while `tcgam-drawer-open`. Hide it
   under `tcgam-keyboard`.
4. `npm run build:firefox`, verify on the emulator with rdp.mjs + screenshots, then `npm run lint:firefox`.
5. Update README.md's feature notes if the behaviour is user-visible.

## Repo conventions

- Version lives only in `package.json`; `scripts/build.mjs` writes it into both manifests.
- `manifests/manifest.firefox.json` must keep `browser_specific_settings.gecko.id` stable and
  `gecko_android` present, or AMO lists the add-on as desktop-only.
- `safari/` (Xcode project) references `dist/safari` by relative path; rebuild dist, then build in Xcode.
  `safari/build/` and `xcuserdata` are ignored.
- This repo is personal: commits use the gmail identity via a conditional include in `~/.gitconfig`, and the
  remote must use the `github-personal` SSH host alias (see the memory note for this project).
