import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const publicDir = path.resolve("public");
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Master High-Resolution Vector Logo (512x512)
// "The Cryptographic Razor Shield"
// Left wing: Dark Titanium Steel. Right wing: Luminous Electric Lime (#b9e63f).
// Center: Precision Merkle Proof Diamond Lock.
export function getMasterSoftwareOathLogo(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#141819" />
      <stop offset="50%" stop-color="#0b0e0f" />
      <stop offset="100%" stop-color="#050607" />
    </linearGradient>

    <!-- Squircle Border Gradient -->
    <linearGradient id="squircle-border" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#b9e63f" stop-opacity="0.8" />
      <stop offset="30%" stop-color="#2d373a" />
      <stop offset="70%" stop-color="#182022" />
      <stop offset="100%" stop-color="#b9e63f" stop-opacity="0.4" />
    </linearGradient>

    <!-- Electric Neon Lime Gradient -->
    <linearGradient id="lime-wing" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e3ff75" />
      <stop offset="50%" stop-color="#b9e63f" />
      <stop offset="100%" stop-color="#88c50e" />
    </linearGradient>

    <!-- Dark Titanium Metallic Gradient -->
    <linearGradient id="titanium-wing" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2c3639" />
      <stop offset="50%" stop-color="#1c2325" />
      <stop offset="100%" stop-color="#0f1415" />
    </linearGradient>

    <!-- Merkle Amber / Gold Accent -->
    <linearGradient id="amber-core" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffe37a" />
      <stop offset="100%" stop-color="#f2b84b" />
    </linearGradient>

    <!-- Ambient Center Glow -->
    <radialGradient id="center-glow" cx="60%" cy="46%" r="55%">
      <stop offset="0%" stop-color="#b9e63f" stop-opacity="0.25" />
      <stop offset="60%" stop-color="#b9e63f" stop-opacity="0.05" />
      <stop offset="100%" stop-color="#b9e63f" stop-opacity="0" />
    </radialGradient>
  </defs>

  <!-- Base App Squircle -->
  <rect x="18" y="18" width="476" height="476" rx="112" fill="url(#bg-grad)" stroke="url(#squircle-border)" stroke-width="3.5" />

  <!-- Ambient Neon Backlight -->
  <circle cx="280" cy="246" r="175" fill="url(#center-glow)" />

  <!-- Shield Left Wing (Dark Titanium Metallic with Subtle Bevel) -->
  <path d="M 242 78
           L 124 136
           C 124 290 182 394 242 444
           Z"
        fill="url(#titanium-wing)"
        stroke="#333e41"
        stroke-width="2.5" />

  <!-- Shield Right Wing (Electric Neon Lime - The Oath Promise) -->
  <path d="M 270 78
           L 388 136
           C 388 290 330 394 270 444
           Z"
        fill="url(#lime-wing)" />

  <!-- Central Cryptographic Verification Lock -->
  <g transform="translate(256, 260)">
    <!-- Outer Negative Space Diamond -->
    <polygon points="0,-38 38,0 0,38 -38,0" fill="#050607" />
    <!-- Titanium White Key -->
    <polygon points="0,-24 24,0 0,24 -24,0" fill="#ffffff" />
    <!-- Inner Neon Lime Core -->
    <polygon points="0,-12 12,0 0,12 -12,0" fill="url(#lime-wing)" />
  </g>
</svg>`;
}

// 2. Favicon SVG (High-Contrast for 16px to 64px browser tabs)
export function getFaviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="fav-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#14181a" />
      <stop offset="100%" stop-color="#060708" />
    </linearGradient>
    <linearGradient id="fav-lime" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#dfff6a" />
      <stop offset="100%" stop-color="#9ddc12" />
    </linearGradient>
    <linearGradient id="fav-dark" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2a3437" />
      <stop offset="100%" stop-color="#14191b" />
    </linearGradient>
  </defs>

  <!-- Solid dark squircle with crisp graphite border (no outer bleed) -->
  <rect x="0" y="0" width="64" height="64" rx="14" fill="url(#fav-bg)" />
  <rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="#222b2d" stroke-width="1.5" />

  <!-- Left Shield Wing -->
  <path d="M 30 10
           L 15 17
           C 15 36 22 49 30 55
           Z"
        fill="url(#fav-dark)"
        stroke="#333e41"
        stroke-width="1" />

  <!-- Right Shield Wing -->
  <path d="M 34 10
           L 49 17
           C 49 36 42 49 34 55
           Z"
        fill="url(#fav-lime)" />

  <!-- Center Diamond Notch -->
  <polygon points="32,27 37,32.5 32,38 27,32.5" fill="#060708" />
  <polygon points="32,29 35,32.5 32,36 29,32.5" fill="#ffffff" />
</svg>`;
}

// 3. Standalone Brand Mark SVG (Transparent Background)
export function getStandaloneMarkSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <linearGradient id="mark-lime" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e3ff75" />
      <stop offset="50%" stop-color="#b9e63f" />
      <stop offset="100%" stop-color="#88c50e" />
    </linearGradient>
    <linearGradient id="mark-dark" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2c3639" />
      <stop offset="50%" stop-color="#1c2325" />
      <stop offset="100%" stop-color="#0f1415" />
    </linearGradient>
  </defs>

  <!-- Shield Left Wing -->
  <path d="M 242 78
           L 124 136
           C 124 290 182 394 242 444
           Z"
        fill="url(#mark-dark)"
        stroke="#333e41"
        stroke-width="3" />

  <!-- Shield Right Wing -->
  <path d="M 270 78
           L 388 136
           C 388 290 330 394 270 444
           Z"
        fill="url(#mark-lime)" />

  <!-- Central Verification Lock -->
  <g transform="translate(256, 260)">
    <polygon points="0,-38 38,0 0,38 -38,0" fill="#050607" />
    <polygon points="0,-24 24,0 0,24 -24,0" fill="#ffffff" />
    <polygon points="0,-12 12,0 0,12 -12,0" fill="url(#mark-lime)" />
  </g>
</svg>`;
}

// Convert SVG to PNG buffer using Resvg
export function renderPng(svgString: string, width: number, height: number): Buffer {
  const resvg = new Resvg(svgString, {
    fitTo: {
      mode: "width",
      value: width,
    },
    background: "rgba(0, 0, 0, 0)",
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

// Build multi-size Windows ICO file
export function buildIco(pngBuffers: { width: number; height: number; buffer: Buffer }[]): Buffer {
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + numImages * dirEntrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(numImages, 4);

  const dirEntries: Buffer[] = [];
  for (const img of pngBuffers) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += img.buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers.map((b) => b.buffer)]);
}

async function main() {
  const masterSvg = getMasterSoftwareOathLogo();
  const faviconSvg = getFaviconSvg();
  const markSvg = getStandaloneMarkSvg();

  // Save SVGs
  fs.writeFileSync(path.join(publicDir, "icon.svg"), masterSvg, "utf8");
  fs.writeFileSync(path.join(publicDir, "favicon.svg"), faviconSvg, "utf8");
  fs.writeFileSync(path.join(publicDir, "software-oath-mark.svg"), markSvg, "utf8");

  // Render PNGs
  const png512 = renderPng(masterSvg, 512, 512);
  const png192 = renderPng(masterSvg, 192, 192);
  const png180 = renderPng(masterSvg, 180, 180); // Apple touch icon
  const png48 = renderPng(faviconSvg, 48, 48);
  const png32 = renderPng(faviconSvg, 32, 32);
  const png16 = renderPng(faviconSvg, 16, 16);

  fs.writeFileSync(path.join(publicDir, "icon-512.png"), png512);
  fs.writeFileSync(path.join(publicDir, "icon-192.png"), png192);
  fs.writeFileSync(path.join(publicDir, "apple-touch-icon.png"), png180);
  fs.writeFileSync(path.join(publicDir, "favicon-32x32.png"), png32);
  fs.writeFileSync(path.join(publicDir, "favicon-16x16.png"), png16);

  // Build multi-size favicon.ico
  const icoBuffer = buildIco([
    { width: 16, height: 16, buffer: png16 },
    { width: 32, height: 32, buffer: png32 },
    { width: 48, height: 48, buffer: png48 },
  ]);
  fs.writeFileSync(path.join(publicDir, "favicon.ico"), icoBuffer);

  // Write site.webmanifest
  const manifest = {
    name: "Software Oath",
    short_name: "SoftwareOath",
    description: "Evidence-backed repository maintenance with owner-controlled draft pull requests.",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
    theme_color: "#090b0c",
    background_color: "#090b0c",
    display: "standalone",
  };
  fs.writeFileSync(path.join(publicDir, "site.webmanifest"), JSON.stringify(manifest, null, 2), "utf8");

  console.log("Successfully generated all production assets in /public!");
}

main().catch(console.error);
