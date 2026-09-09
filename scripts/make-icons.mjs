// Generates placeholder PNG icons (navy rounded square with a card silhouette) without any dependencies.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const sizes = [48, 96, 128, 256, 512];
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c;
});
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const inRounded = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

mkdirSync("src/icons", { recursive: true });
for (const s of sizes) {
  const raw = Buffer.alloc((s * 4 + 1) * s);
  for (let y = 0; y < s; y++) {
    raw[y * (s * 4 + 1)] = 0;
    for (let x = 0; x < s; x++) {
      let rgba = [0, 0, 0, 0];
      if (inRounded(x, y, 0, 0, s - 1, s - 1, s * .22)) rgba = [24, 41, 61, 255];            // #18293d
      if (inRounded(x, y, s * .30, s * .18, s * .70, s * .82, s * .06)) rgba = [233, 69, 96, 255]; // #e94560 card
      if (inRounded(x, y, s * .36, s * .25, s * .64, s * .55, s * .03)) rgba = [255, 255, 255, 255]; // art box
      raw.set(rgba, y * (s * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0); ihdr.writeUInt32BE(s, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(`src/icons/icon-${s}.png`, png);
  console.log(`icon-${s}.png`);
}
