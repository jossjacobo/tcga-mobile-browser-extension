// Dev helper: evaluate JS in the tcg-arena.fr tab of a Firefox (Android) instance started by `web-ext run`.
// Usage: node scripts/rdp.mjs <tcp port printed by web-ext> "<javascript expression>"
// Minimal Firefox Remote Debugging Protocol client: evaluate JS in the first tcg-arena tab.
import net from "node:net";
const port = Number(process.argv[2]); const code = process.argv[3];
setTimeout(() => { console.log("rdp timeout"); process.exit(1); }, 25000);
const sock = net.connect(port, "127.0.0.1");
// Packets are "<byteLength>:<json>". Work in bytes: a response with non-ASCII text (an en dash, an emoji)
// has a byte length longer than its string length and would otherwise never parse.
let buf = Buffer.alloc(0); const waiters = [];
sock.on("data", d => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const i = buf.indexOf(0x3a); if (i < 0) return;                 // ':'
    const len = Number(buf.subarray(0, i).toString("latin1")); if (!Number.isFinite(len)) { buf = Buffer.alloc(0); return; }
    if (buf.length < i + 1 + len) return;
    const msg = JSON.parse(buf.subarray(i + 1, i + 1 + len).toString("utf8"));
    buf = buf.subarray(i + 1 + len);
    const w = waiters.findIndex(x => x.match(msg)); if (w >= 0) waiters.splice(w, 1)[0].res(msg);
  }
});
const send = (o) => { const s = JSON.stringify(o); sock.write(`${Buffer.byteLength(s, "utf8")}:${s}`); };
const wait = (match) => new Promise(res => waiters.push({ match, res }));
const req = (o, extra) => { const p = wait(m => m.from === o.to && !m.type && (!extra || extra(m)) || (m.from === o.to && extra && extra(m))); send(o); return p; };
await wait(m => m.from === "root" && m.applicationType);
const root = await req({ to: "root", type: "getRoot" });
const addons = await req({ to: root.addonsActor, type: "listAddons" });
console.log("addons:", Array.isArray(addons.addons) ? addons.addons.filter(a => !a.isSystem).map(a => `${a.name} (${a.id}) temporary=${a.temporarilyInstalled}`).join("; ") || "(none)" : JSON.stringify(addons).slice(0,300));
const tabs = await req({ to: "root", type: "listTabs" });
console.log("tabs:", tabs.tabs.map(t => t.url).join(" | "));
const tab = tabs.tabs.find(t => /tcg-arena/.test(t.url)) || tabs.tabs[0];
const target = await req({ to: tab.actor, type: "getTarget" });
const consoleActor = target.frame.consoleActor;
const resultId = "r" + Date.now();
const p = wait(m => m.from === consoleActor && m.type === "evaluationResult");
send({ to: consoleActor, type: "evaluateJSAsync", text: code, resultID: resultId });
const r = await p;
let out = r.result;
if (out && typeof out === "object" && out.type === "longString") {
  const sub = await req({ to: out.actor, type: "substring", start: 0, end: out.length });
  out = sub.substring;
}
console.log("result:", typeof out === "string" ? out : JSON.stringify(r.exceptionMessage ?? out));
sock.end(); process.exit(0);
