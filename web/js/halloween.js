// Halloween art (switched on by admins, setting `halloween`): jack-o'-lantern, bats, spider web, spider.
// Plain SVG strings and path data, so the app decorations, the background canvas and the bot banner
// all draw the same shapes.

/** Jack-o'-lantern, 64 × 60. */
export const PUMPKIN = `<svg class="hw-pk" viewBox="0 0 64 60" aria-hidden="true">
  <path d="M31 13c-1-5 1-9 5-11l3 3c-3 2-4 5-4 8z" fill="#3f6212"/>
  <path d="M35 6c4-3 9-3 12 0-4 0-7 1-9 3z" fill="#65a30d"/>
  <ellipse cx="19" cy="36" rx="16" ry="20" fill="#d9480f"/>
  <ellipse cx="45" cy="36" rx="16" ry="20" fill="#d9480f"/>
  <ellipse cx="32" cy="36" rx="17" ry="22" fill="#fd7e14"/>
  <path d="M25 15c-6 10-6 32 0 42M39 15c6 10 6 32 0 42" fill="none" stroke="#c2410c" stroke-width="1.8" opacity=".7"/>
  <ellipse cx="23" cy="24" rx="5" ry="3" fill="#ffb366" opacity=".55" transform="rotate(-25 23 24)"/>
  <path d="M17 31l6-8 6 8z M35 31l6-8 6 8z" fill="#ffe066" stroke="#9a3412" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M29.5 37l2.5-4 2.5 4z" fill="#ffe066" stroke="#9a3412" stroke-width="1" stroke-linejoin="round"/>
  <path d="M15 41c6 10 28 10 34 0l-4.5 2-3.5-3-3.5 3.5-3.5-3.5-3.5 3.5-3.5-3.5-3.5 3-4.5-2z" fill="#ffe066" stroke="#9a3412" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;

/**
 * A bat seen from the front, centred on 0,0, wings `span` wide on each side; `flap` (-1..1) lifts or
 * lowers the wings. One closed outline, as SVG path data (also usable with Path2D on a canvas).
 */
export function batPath(span = 30, flap = 0) {
  const s = span;
  const up = flap * s * 0.35; // the wing tips go up when flap > 0
  const p = (n) => Math.round(n * 10) / 10;
  const elbowY = p(-0.32 * s - up * 0.6);
  const tipY = p(-0.18 * s - up);
  const f1y = p(0.06 * s - up * 0.75);
  const f2y = p(0.16 * s - up * 0.5);
  const f3y = p(0.2 * s - up * 0.25);
  const pt = (k, x, y) => `${p(k * x)} ${p(y)}`;
  // trailing edge (scalloped) from the body out to the tip, then the leading edge back to the shoulder
  const out = (k) => [
    `Q${pt(k, 0.14 * s, f3y - 0.04 * s)} ${pt(k, 0.22 * s, f3y)}`,
    `Q${pt(k, 0.36 * s, f2y - 0.06 * s)} ${pt(k, 0.48 * s, f2y)}`,
    `Q${pt(k, 0.62 * s, f1y - 0.06 * s)} ${pt(k, 0.74 * s, f1y)}`,
    `Q${pt(k, 0.9 * s, (tipY + f1y) / 2 + 0.06 * s)} ${pt(k, s, tipY)}`,
    `Q${pt(k, 0.8 * s, elbowY)} ${pt(k, 0.55 * s, elbowY)}`,
    `Q${pt(k, 0.32 * s, elbowY)} ${pt(k, 0.1 * s, -0.1 * s)}`,
  ];
  // the same wing walked the other way: shoulder → tip → scallops back to the body
  const back = (k) => [
    `Q${pt(k, 0.32 * s, elbowY)} ${pt(k, 0.55 * s, elbowY)}`,
    `Q${pt(k, 0.8 * s, elbowY)} ${pt(k, s, tipY)}`,
    `Q${pt(k, 0.9 * s, (tipY + f1y) / 2 + 0.06 * s)} ${pt(k, 0.74 * s, f1y)}`,
    `Q${pt(k, 0.62 * s, f1y - 0.06 * s)} ${pt(k, 0.48 * s, f2y)}`,
    `Q${pt(k, 0.36 * s, f2y - 0.06 * s)} ${pt(k, 0.22 * s, f3y)}`,
    `Q${pt(k, 0.14 * s, f3y - 0.04 * s)} ${pt(k, 0.08 * s, 0.16 * s)}`,
  ];
  return [
    `M0 ${p(0.26 * s)}`,
    `L${pt(1, 0.08 * s, 0.16 * s)}`,
    ...out(1),
    `L${pt(1, 0.07 * s, -0.2 * s)}`,
    `L${pt(1, 0.09 * s, -0.33 * s)}`, // right ear
    `L${pt(1, 0.03 * s, -0.24 * s)}`,
    `L${pt(-1, 0.03 * s, -0.24 * s)}`,
    `L${pt(-1, 0.09 * s, -0.33 * s)}`, // left ear
    `L${pt(-1, 0.07 * s, -0.2 * s)}`,
    `L${pt(-1, 0.1 * s, -0.1 * s)}`,
    ...back(-1),
    'Z',
  ].join(' ');
}

/** One bat as an SVG, `w` px wide. */
export function batSvg(w = 64, fill = '#1b0b2b', flap = 0.3) {
  return `<svg class="hw-bat" width="${w}" height="${Math.round(w * 0.6)}" viewBox="-32 -19 64 38" aria-hidden="true"><path d="${batPath(30, flap)}" fill="${fill}"/></svg>`;
}

/** A corner spider web (the corner is at 0,0), `size` px. */
export function webSvg(size = 120) {
  const R = 118;
  const angles = [0, 16, 32, 48, 64, 80, 90].map((a) => (a * Math.PI) / 180);
  const pt = (a, r) => [Math.round(Math.cos(a) * r * 10) / 10, Math.round(Math.sin(a) * r * 10) / 10];
  const threads = angles.map((a) => `M0 0L${pt(a, R).join(' ')}`).join('');
  let rings = '';
  for (const r of [18, 34, 52, 72, 95]) {
    for (let i = 0; i < angles.length - 1; i++) {
      const [x1, y1] = pt(angles[i], r);
      const [x2, y2] = pt(angles[i + 1], r);
      const mid = (angles[i] + angles[i + 1]) / 2;
      const [cx, cy] = pt(mid, r * 0.82); // threads sag towards the corner
      rings += `M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}`;
    }
  }
  return `<svg class="hw-web" width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true"><path d="${threads}${rings}" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>`;
}

/** A little spider hanging on its thread (the thread is drawn by CSS). */
export const SPIDER = `<svg class="hw-spider-svg" viewBox="0 0 40 34" aria-hidden="true">
  <g fill="none" stroke="#120818" stroke-width="2" stroke-linecap="round">
    <path d="M14 15c-5-3-8-2-12 2M14 18c-5-1-9 1-12 6M15 21c-4 1-7 4-9 9M17 22c-2 3-3 6-3 10"/>
    <path d="M26 15c5-3 8-2 12 2M26 18c5-1 9 1 12 6M25 21c4 1 7 4 9 9M23 22c2 3 3 6 3 10"/>
  </g>
  <ellipse cx="20" cy="19" rx="7" ry="8" fill="#120818"/>
  <circle cx="20" cy="9" r="5" fill="#1c0d26"/>
  <circle cx="18" cy="8.5" r="1.3" fill="#ff8a1f"/>
  <circle cx="22" cy="8.5" r="1.3" fill="#ff8a1f"/>
</svg>`;

/** The night sky behind the app while Halloween is on (replaces the theme's background colours). */
export const NIGHT = { bg1: '#0b0614', bg2: '#2b0d46', bubble: '255,170,90' };
