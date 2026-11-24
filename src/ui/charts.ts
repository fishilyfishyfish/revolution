// 의존성 없는 소형 차트 (Canvas 2D)
export interface Series { label: string; color: string; x: ArrayLike<number>; y: ArrayLike<number>; dash?: number[] }
export interface Marker { x: number; label: string; color: string }
export interface ChartOpts {
  title?: string; markers?: Marker[]; ymin?: number; ymax?: number; band?: { x: ArrayLike<number>; lo: ArrayLike<number>; hi: ArrayLike<number>; color: string };
  stacked?: boolean; xmin?: number; xmax?: number; logy?: boolean;
}

export function setupCanvas(c: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = c.getBoundingClientRect();
  const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
  if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (v: number) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));

export function lineChart(c: HTMLCanvasElement, series: Series[], o: ChartOpts = {}) {
  const { ctx, w, h } = setupCanvas(c);
  ctx.clearRect(0, 0, w, h);
  const L = 44, R = 8, T = o.title ? 18 : 8, B = 18;
  const fg = css('--fg'), grid = css('--grid'), muted = css('--muted');
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = muted;
  if (o.title) { ctx.fillStyle = fg; ctx.fillText(o.title, L, 12); }
  let xmin = o.xmin ?? Infinity, xmax = o.xmax ?? -Infinity, ymin = o.ymin ?? Infinity, ymax = o.ymax ?? -Infinity;
  const acc = new Float64Array(0);
  void acc;
  for (const s of series) for (let i = 0; i < s.x.length; i++) {
    if (o.xmin === undefined && s.x[i] < xmin) xmin = s.x[i];
    if (o.xmax === undefined && s.x[i] > xmax) xmax = s.x[i];
    if (o.ymin === undefined && s.y[i] < ymin) ymin = s.y[i];
    if (o.ymax === undefined && s.y[i] > ymax) ymax = s.y[i];
  }
  if (o.band) for (let i = 0; i < o.band.x.length; i++) {
    if (o.ymin === undefined) ymin = Math.min(ymin, o.band.lo[i]); if (o.ymax === undefined) ymax = Math.max(ymax, o.band.hi[i]);
  }
  if (!isFinite(xmin) || xmax <= xmin) { ctx.fillStyle = muted; ctx.fillText('데이터 없음', L + 10, h / 2); return; }
  if (!isFinite(ymin)) { ymin = 0; ymax = 1; }
  if (ymax - ymin < 1e-9) { ymax = ymin + 1; }
  const pad = (ymax - ymin) * 0.06; if (o.ymin === undefined && ymin !== 0) ymin -= pad; if (o.ymax === undefined) ymax += pad;
  const px = (x: number) => L + ((x - xmin) / (xmax - xmin)) * (w - L - R);
  const py = (y: number) => T + (1 - (y - ymin) / (ymax - ymin)) * (h - T - B);
  ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = muted; ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const v = ymin + ((ymax - ymin) * i) / 3, y = py(v);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.fillText(fmt(v), L - 4, y + 4);
  }
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) { const v = xmin + ((xmax - xmin) * i) / 4; ctx.fillText(fmt(v), px(v), h - 4); }
  ctx.textAlign = 'left';
  if (o.band) {
    ctx.fillStyle = o.band.color; ctx.globalAlpha = 0.18; ctx.beginPath();
    const n = o.band.x.length;
    for (let i = 0; i < n; i++) ctx[i ? 'lineTo' : 'moveTo'](px(o.band.x[i]), py(o.band.hi[i]));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(px(o.band.x[i]), py(o.band.lo[i]));
    ctx.fill(); ctx.globalAlpha = 1;
  }
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.setLineDash(s.dash ?? []); ctx.beginPath();
    const step = Math.max(1, Math.floor(s.x.length / (w * 1.5)));
    for (let i = 0; i < s.x.length; i += step) ctx[i ? 'lineTo' : 'moveTo'](px(s.x[i]), py(s.y[i]));
    ctx.stroke(); ctx.setLineDash([]);
  }
  for (const m of o.markers ?? []) {
    if (m.x < xmin || m.x > xmax) continue;
    ctx.strokeStyle = m.color; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px(m.x), T); ctx.lineTo(px(m.x), h - B); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = m.color; ctx.fillText(m.label, px(m.x) + 2, T + 9);
  }
  // 범례
  let lx = L + 4; ctx.textAlign = 'left';
  for (const s of series) {
    if (!s.label) continue;
    ctx.fillStyle = s.color; ctx.fillRect(lx, h - B - 12, 8, 3);
    ctx.fillStyle = fg; ctx.fillText(s.label, lx + 11, h - B - 8); lx += 18 + ctx.measureText(s.label).width;
  }
}

// 누적 영역 차트 (종별 개체 수)
export function stackedArea(c: HTMLCanvasElement, xs: number[], layers: { color: string; y: number[] }[], title: string) {
  const { ctx, w, h } = setupCanvas(c); ctx.clearRect(0, 0, w, h);
  const L = 44, R = 8, T = 18, B = 18; const fg = css('--fg'), muted = css('--muted');
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = fg; ctx.fillText(title, L, 12);
  if (xs.length < 2) { ctx.fillStyle = muted; ctx.fillText('데이터 없음', L + 10, h / 2); return; }
  const tot = xs.map((_, i) => layers.reduce((s, l) => s + l.y[i], 0)); const ymax = Math.max(1, ...tot);
  const px = (i: number) => L + ((xs[i] - xs[0]) / (xs[xs.length - 1] - xs[0])) * (w - L - R);
  const py = (v: number) => T + (1 - v / ymax) * (h - T - B);
  const base = new Array(xs.length).fill(0);
  for (const l of layers) {
    ctx.fillStyle = l.color; ctx.beginPath();
    for (let i = 0; i < xs.length; i++) ctx[i ? 'lineTo' : 'moveTo'](px(i), py(base[i] + l.y[i]));
    for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(px(i), py(base[i]));
    ctx.fill();
    for (let i = 0; i < xs.length; i++) base[i] += l.y[i];
  }
  ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.fillText(fmt(ymax), L - 4, T + 8); ctx.fillText('0', L - 4, h - B);
  ctx.textAlign = 'center'; ctx.fillText(fmt(xs[0]), L, h - 4); ctx.fillText(fmt(xs[xs.length - 1]), w - R - 10, h - 4);
}

export function histChart(c: HTMLCanvasElement, bins: number[], lo: number, hi: number, title: string, color: string) {
  const { ctx, w, h } = setupCanvas(c); ctx.clearRect(0, 0, w, h);
  const L = 44, R = 8, T = 18, B = 18; const fg = css('--fg'), muted = css('--muted');
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = fg; ctx.fillText(title, L, 12);
  const mx = Math.max(1, ...bins), bw = (w - L - R) / bins.length;
  ctx.fillStyle = color;
  bins.forEach((v, i) => { const bh = (v / mx) * (h - T - B); ctx.fillRect(L + i * bw + 1, h - B - bh, bw - 2, bh); });
  ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.fillText(String(mx), L - 4, T + 8);
  ctx.textAlign = 'center'; ctx.fillText(fmt(lo), L, h - 4); ctx.fillText(fmt(hi), w - R - 8, h - 4); ctx.fillText(fmt((lo + hi) / 2), (L + w - R) / 2, h - 4);
}

export function barChart(c: HTMLCanvasElement, labels: string[], vals: number[], colors: string[], title: string) {
  const { ctx, w, h } = setupCanvas(c); ctx.clearRect(0, 0, w, h);
  const fg = css('--fg'); ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = fg; ctx.fillText(title, 8, 12);
  const tot = vals.reduce((a, b) => a + b, 0) || 1; let y = 22; const bh = Math.min(16, (h - 26) / labels.length - 3);
  labels.forEach((l, i) => {
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.fillText(l, 8, y + bh - 3);
    ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(100, y, ((w - 150) * vals[i]) / tot, bh);
    ctx.fillStyle = fg; ctx.fillText(((100 * vals[i]) / tot).toFixed(1) + '%', 104 + ((w - 150) * vals[i]) / tot, y + bh - 3);
    y += bh + 3;
  });
}
