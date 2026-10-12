// Generates .github/assets/architecture.svg. Run with `pnpm assets`.
//
// All text is converted to vector paths with opentype.js and the Geist fonts, so the SVG renders
// identically everywhere, including GitHub's image proxy, which never loads web fonts.
// opentype.js 2.0's toPathData() can emit NaN for some coordinates, so paths are serialized here.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('geist/font/sans')), 'fonts');
const out = fileURLToPath(new URL('../../.github/assets/architecture.svg', import.meta.url));

const C = {
  ink: '#0d0f12',
  ground: '#0f1a20',
  panel: '#11151a',
  raised: '#181c22',
  edge: '#262b33',
  edgeStrong: '#353c47',
  fg: '#f5f7fa',
  fgSoft: '#dfe6ee',
  muted: '#9aa6b4',
  subtle: '#6f7b89',
  cyan: '#22d3ee',
  cyanBright: '#67e8f9',
  magenta: '#f0468a',
};

const load = (file) => {
  const buffer = readFileSync(join(fontDir, file));
  return opentype.parse(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
};
const F = {
  medium: load('geist-sans/Geist-Medium.ttf'),
  regular: load('geist-sans/Geist-Regular.ttf'),
  mono: load('geist-mono/GeistMono-Regular.ttf'),
  monoMedium: load('geist-mono/GeistMono-Medium.ttf'),
};

function layout(font, str, size, tracking = 0) {
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(str);
  for (const [i, g] of glyphs.entries()) {
    if (g.index === 0) throw new Error(`missing glyph for "${[...str][i]}" in "${str}"`);
  }
  const advances = glyphs.map((g, i) => {
    let advance = g.advanceWidth * scale;
    if (i < glyphs.length - 1) {
      const kerning = font.getKerningValue(g, glyphs[i + 1]);
      advance += (Number.isFinite(kerning) ? kerning : 0) * scale + tracking;
    }
    return advance;
  });
  return { glyphs, advances, width: advances.reduce((sum, a) => sum + a, 0) };
}

const num = (v) => {
  if (!Number.isFinite(v)) throw new Error(`non-finite path coordinate ${v}`);
  return String(Math.round(v * 10) / 10);
};
const toD = (commands) =>
  commands
    .map((c) => {
      switch (c.type) {
        case 'M':
        case 'L':
          return `${c.type}${num(c.x)} ${num(c.y)}`;
        case 'Q':
          return `Q${num(c.x1)} ${num(c.y1)} ${num(c.x)} ${num(c.y)}`;
        case 'C':
          return `C${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)}`;
        case 'Z':
          return 'Z';
        default:
          throw new Error(`unknown path command ${c.type}`);
      }
    })
    .join('');

const measure = (font, str, size, tracking) => layout(font, str, size, tracking).width;

function text(font, str, x, y, size, { tracking = 0, anchor = 'start', fill = C.fg } = {}) {
  const { glyphs, advances, width } = layout(font, str, size, tracking);
  let cx = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  let d = '';
  glyphs.forEach((g, i) => {
    d += toD(g.getPath(cx, y, size).commands);
    cx += advances[i];
  });
  return `<path d="${d}" fill="${fill}"/>`;
}

const W = 1280;
const H = 600;
const X = 48;
const INNER = W - 2 * X;
// Type scale. The SVG is shown at ~70% in a README, so nothing goes below 14px.
const T = { title: 19, sub: 14, label: 14, pill: 15 };

const SPARK =
  'M12 2.5c.6 4.9 3.6 7.9 8.5 8.5-4.9.6-7.9 3.6-8.5 8.5-.6-4.9-3.6-7.9-8.5-8.5 4.9-.6 7.9-3.6 8.5-8.5Z';

/** Lays out a row of nodes across the full width with equal gaps. */
function row(specs, y) {
  const widths = specs.map(({ title, sub }) =>
    Math.max(
      150,
      Math.ceil(Math.max(measure(F.medium, title, T.title), measure(F.mono, sub, T.sub)) + 36),
    ),
  );
  const gap = (INNER - widths.reduce((a, b) => a + b, 0)) / (specs.length - 1);
  if (gap < 24) throw new Error(`row too wide (gap ${gap})`);
  let x = X;
  return specs.map((spec, i) => {
    const node = { ...spec, x, y, w: widths[i], h: 84 };
    node.cx = x + node.w / 2;
    node.cy = y + node.h / 2;
    x += node.w + gap;
    return node;
  });
}

function node(n) {
  const stroke = n.highlight ? C.cyan : C.edgeStrong;
  const strokeOpacity = n.highlight ? 0.6 : 1;
  const icon = n.icon
    ? `<path transform="translate(${n.x + 16} ${n.y + 19}) scale(0.8)" d="${SPARK}" fill="${C.cyan}"/>`
    : '';
  const titleX = n.x + 18 + (n.icon ? 25 : 0);
  return `
    <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12" fill="${C.raised}" stroke="${stroke}" stroke-opacity="${strokeOpacity}"/>
    ${icon}
    ${text(F.medium, n.title, titleX, n.y + 36, T.title, { fill: n.highlight ? C.cyanBright : C.fg })}
    ${text(F.mono, n.sub, n.x + 18, n.y + 62, T.sub, { fill: C.muted })}`;
}

function arrowHead(x, y, direction) {
  const s = 5;
  const points = {
    right: [
      [x, y],
      [x - s * 1.6, y - s],
      [x - s * 1.6, y + s],
    ],
    up: [
      [x, y],
      [x - s, y + s * 1.6],
      [x + s, y + s * 1.6],
    ],
    down: [
      [x, y],
      [x - s, y - s * 1.6],
      [x + s, y - s * 1.6],
    ],
  }[direction];
  return `<path d="M${points.map(([px, py]) => `${num(px)} ${num(py)}`).join('L')}Z" fill="${C.edgeStrong}"/>`;
}

function chain(nodes, pulseClass) {
  return nodes
    .slice(0, -1)
    .map((a, i) => {
      const b = nodes[i + 1];
      const x1 = a.x + a.w + 6;
      const x2 = b.x - 6;
      const d = `M${num(x1)} ${num(a.cy)}H${num(x2)}`;
      return `<path d="${d}" stroke="${C.edgeStrong}" stroke-width="1.5" fill="none"/>
        ${arrowHead(x2, a.cy, 'right')}
        <path class="pulse ${pulseClass}" style="animation-delay:${(i * 0.45).toFixed(2)}s" d="${d}" pathLength="100" stroke="${C.cyanBright}" stroke-width="2" stroke-linecap="round" fill="none"/>`;
    })
    .join('');
}

function laneLabel(label, detail, y) {
  const labelWidth = measure(F.monoMedium, label, T.label, 1.6);
  return `
    ${text(F.monoMedium, label, X + 2, y, T.label, { tracking: 1.6, fill: C.cyan })}
    ${text(F.mono, detail, X + labelWidth + 16, y, T.label, { fill: C.muted })}`;
}

const build = row(
  [
    { title: 'Pages', sub: 'Markdown · MDX · HTML' },
    { title: 'Chunk', sub: 'per heading, overlapped' },
    { title: 'Embed', sub: 'embedMany, any model' },
    { title: 'Quantize', sub: 'int8 → base64' },
    { title: 'ask-index.json', sub: 'static · committed', highlight: true },
  ],
  84,
);

const request = row(
  [
    { title: 'Ask dialog', sub: 'Cmd+I · AskDialog', icon: true },
    { title: 'Embed question', sub: 'one embedding call' },
    { title: 'Hybrid search', sub: 'BM25 + int8 cosine' },
    { title: 'Fuse and gate', sub: 'RRF · relevance floor' },
    { title: 'Stream answer', sub: 'streamText · [n] cites' },
  ],
  332,
);

const index = build[4];
const search = request[2];
const gate = request[3];
const answer = request[4];
const dialog = request[0];

// The index feeds retrieval: loaded once per server instance, then searched in memory.
const busY = 250;
const loadPath = `M${num(index.cx)} ${index.y + index.h + 6}V${busY}H${num(search.cx)}V${search.y - 6}`;
const loadLabel = 'loaded into memory once per instance · no vector database';
const loadLabelX = (index.cx + search.cx) / 2;

// Refusal branch.
const refusal = 'nothing relevant → “I don’t know”, model never called';
const refusalWidth = measure(F.regular, refusal, T.pill) + 36;
const pillY = 446;
const pillX = Math.min(gate.cx - refusalWidth / 2, W - X - refusalWidth);

// Response path back to the dialog.
const returnY = 540;
const returnPath = `M${num(answer.cx)} ${answer.y + answer.h + 6}V${returnY}H${num(dialog.cx)}V${dialog.y + dialog.h + 6}`;
const returnLabel = 'SSE: metadata, then numbered sources, then the cited answer';
const returnLabelX = (dialog.cx + gate.cx) / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">
  <title id="title">ondocs architecture</title>
  <desc id="desc">Build time: pages are chunked per heading, embedded, quantized to int8 and written to a static ask-index.json. Request time: the dialog posts a question, the handler embeds it, runs BM25 and cosine search over the index in memory, fuses the rankings with reciprocal rank fusion behind a relevance gate, and either answers "I don't know" without calling the model or streams a cited answer back over Server-Sent Events.</desc>
  <style>
    .pulse{stroke-dasharray:14 1000;stroke-dashoffset:14;animation:flow 3.2s cubic-bezier(.45,0,.55,1) infinite both}
    @keyframes flow{0%{stroke-dashoffset:14}40%{stroke-dashoffset:-100}100%{stroke-dashoffset:-100}}
    @media (prefers-reduced-motion: reduce){.pulse{animation:none;opacity:0}}
  </style>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.ink}"/><stop offset="1" stop-color="${C.ground}"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="${C.cyan}" stop-opacity=".07"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#fff" stroke-opacity=".035"/></pattern>
    <clipPath id="clip"><rect width="${W}" height="${H}" rx="20"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#grid)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>

    <rect x="${X - 20}" y="28" width="${INNER + 40}" height="160" rx="16" fill="${C.panel}" fill-opacity=".72" stroke="${C.edge}"/>
    ${laneLabel('BUILD TIME', 'npx ondocs index · once per deploy', 62)}
    ${chain(build, 'build')}
    ${build.map(node).join('')}

    <rect x="${X - 20}" y="276" width="${INNER + 40}" height="${H - 276 - 24}" rx="16" fill="${C.panel}" fill-opacity=".72" stroke="${C.edge}"/>
    ${laneLabel('REQUEST TIME', 'createAskHandler · per question', 310)}

    <path d="${loadPath}" stroke="${C.cyan}" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="5 5" fill="none"/>
    ${arrowHead(search.cx, search.y - 6, 'down').replace(C.edgeStrong, C.cyan)}
    <rect x="${num(loadLabelX - measure(F.mono, loadLabel, T.label) / 2 - 12)}" y="${busY - 14}" width="${num(measure(F.mono, loadLabel, T.label) + 24)}" height="28" rx="14" fill="${C.ink}" stroke="${C.edge}"/>
    ${text(F.mono, loadLabel, loadLabelX, busY + 5, T.label, { anchor: 'middle', fill: C.muted })}

    ${chain(request, 'request')}

    <path d="M${num(gate.cx)} ${gate.y + gate.h + 6}V${pillY - 6}" stroke="${C.magenta}" stroke-opacity=".6" stroke-width="1.5" fill="none"/>
    ${arrowHead(gate.cx, pillY - 6, 'down').replace(C.edgeStrong, C.magenta)}
    <rect x="${num(pillX)}" y="${pillY}" width="${num(refusalWidth)}" height="38" rx="19" fill="#1a1016" stroke="${C.magenta}" stroke-opacity=".55"/>
    ${text(F.regular, refusal, pillX + refusalWidth / 2, pillY + 24, T.pill, { anchor: 'middle', fill: C.fgSoft })}
    <path d="M${num(gate.cx)} ${pillY + 38}V${returnY}" stroke="${C.magenta}" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="4 4" fill="none"/>

    <path d="${returnPath}" stroke="${C.edgeStrong}" stroke-width="1.5" fill="none"/>
    ${arrowHead(dialog.cx, dialog.y + dialog.h + 6, 'up')}
    <path class="pulse request" style="animation-delay:1.9s" d="${returnPath}" pathLength="100" stroke="${C.cyanBright}" stroke-width="2" stroke-linecap="round" fill="none"/>
    <rect x="${num(returnLabelX - measure(F.mono, returnLabel, T.label) / 2 - 12)}" y="${returnY - 14}" width="${num(measure(F.mono, returnLabel, T.label) + 24)}" height="28" rx="14" fill="${C.panel}" stroke="${C.edge}"/>
    ${text(F.mono, returnLabel, returnLabelX, returnY + 5, T.label, { anchor: 'middle', fill: C.muted })}

    ${request.map(node).join('')}
    <rect y="${H - 2}" width="${W}" height="2" fill="${C.cyan}" fill-opacity=".45"/>
  </g>
</svg>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg.replace(/\n\s*/g, '\n'));
console.log(
  `wrote .github/assets/architecture.svg (${(Buffer.byteLength(svg) / 1024).toFixed(1)} kB)`,
);
