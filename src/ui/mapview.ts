import type { FrameMsg } from '../worker/protocol';

export type ViewBg = 'plants' | 'biome' | 'temp' | 'sun';
export type ViewInd = 'hue' | 'speciesA' | 'speciesB' | 'energy';
export interface ViewOpts { bg: ViewBg; ind: ViewInd; showInd: boolean; selected: number; hl?: number; brush: { x: number; y: number; r: number } | null }
export interface Maps { terrain: Uint8Array; dom: Uint8Array; zone: Uint8Array; sun: Float32Array; devast: Uint16Array }

const PC = [[70, 200, 90], [225, 175, 60], [90, 170, 230]];
const BIOME = [[60, 150, 70], [190, 150, 60], [70, 130, 190]];

export function hsl(h: number, s: number, l: number): string { return `hsl(${((h % 1) + 1) % 1 * 360},${s}%,${l}%)`; }
export const speciesColor = (id: number) => (id < 0 ? '#888' : hsl((id * 0.61803398875) % 1, 70, 58));

export class MapView {
  ctx: CanvasRenderingContext2D;
  off = document.createElement('canvas');
  img: ImageData | null = null;
  maps: Maps | null = null;
  frame: FrameMsg | null = null;
  constructor(public canvas: HTMLCanvasElement) { this.ctx = canvas.getContext('2d')!; }

  setFrame(f: FrameMsg) {
    this.frame = f;
    if (f.maps) this.maps = f.maps;
  }

  draw(o: ViewOpts) {
    const f = this.frame, m = this.maps; if (!f || !m) return;
    const { w, h } = f;
    if (this.off.width !== w) { this.off.width = w; this.off.height = h; this.img = new ImageData(w, h); }
    const d = this.img!.data, L = f.layers;
    for (let c = 0; c < w * h; c++) {
      let r: number, g: number, b: number; const t = m.terrain[c];
      if (t === 1) { r = 28; g = 66; b = 130; const a = (L[c * 5 + 2] / 255) * 0.7; r += 40 * a; g += 140 * a; b += 70 * a; }
      else if (t === 2) { r = 105; g = 105; b = 115; }
      else if (o.bg === 'plants') {
        r = 26; g = 32; b = 26;
        for (let s = 0; s < 3; s++) { const a = (L[c * 5 + s] / 255) * 0.85; r += PC[s][0] * a; g += PC[s][1] * a; b += PC[s][2] * a; }
      } else if (o.bg === 'biome') {
        const k = BIOME[m.dom[c]], z = 0.55 + 0.25 * m.zone[c]; r = k[0] * z; g = k[1] * z; b = k[2] * z;
      } else if (o.bg === 'temp') {
        const z = m.zone[c] / 2; r = 60 + 190 * z; g = 90 + 40 * (1 - Math.abs(z - 0.5) * 2); b = 230 - 190 * z;
      } else { const s = Math.min(1, m.sun[c] / 2); r = 30 + 200 * s; g = 30 + 170 * s; b = 40 + 20 * s; if (m.sun[c] < 0.99) { r = 40; g = 40; b = 60 + 60 * m.sun[c]; } }
      if (t === 0) {
        const cp = L[c * 5 + 3] / 255; if (cp > 0) { r += 190 * cp; g -= 20 * cp; b -= 20 * cp; }
        const pa = L[c * 5 + 4] / 255; if (pa > 0) { r += 120 * pa; b += 150 * pa; g -= 20 * pa; }
        const dv = m.devast[c]; if (dv > 0) { const k = 1 - 0.6 * Math.min(1, dv / 800); r *= k; g *= k; b *= k; }
      }
      const i = c * 4; d[i] = r < 0 ? 0 : r > 255 ? 255 : r; d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g; d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b; d[i + 3] = 255;
    }
    this.off.getContext('2d')!.putImageData(this.img!, 0, 0);
    const ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height, sc = cw / w;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, 0, cw, ch);
    if (o.showInd) {
      const a = f.ind; const n = a.length / 11;
      for (let i = 0; i < n; i++) {
        const k = i * 11, x = a[k] * sc, y = a[k + 1] * sc, ang = a[k + 2], rad = Math.max(1.6, a[k + 3] * sc * 0.9);
        const sid = o.ind === 'speciesA' ? a[k + 5] : o.ind === 'speciesB' ? a[k + 6] : -2;
        ctx.globalAlpha = o.hl !== undefined && o.hl >= 0 && sid !== o.hl ? 0.18 : 1; // 범례에서 고른 종만 강조
        ctx.fillStyle = o.ind === 'hue' ? hsl(a[k + 4], 80, 55) : o.ind === 'speciesA' ? speciesColor(a[k + 5]) : o.ind === 'speciesB' ? speciesColor(a[k + 6])
          : `hsl(${Math.round(a[k + 9] * 120)},80%,50%)`;
        const cls = a[k + 10] % 10, aqua = a[k + 10] >= 10;
        ctx.beginPath();
        if (cls === 2) { // 육식: 삼각형 (진행 방향이 뾰족한 쪽)
          const r2 = rad * 1.5; ctx.moveTo(x + Math.cos(ang) * r2, y + Math.sin(ang) * r2);
          ctx.lineTo(x + Math.cos(ang + 2.5) * r2, y + Math.sin(ang + 2.5) * r2); ctx.lineTo(x + Math.cos(ang - 2.5) * r2, y + Math.sin(ang - 2.5) * r2); ctx.closePath();
        } else if (cls === 1) { // 잡식: 마름모
          const r2 = rad * 1.35; ctx.moveTo(x + r2, y); ctx.lineTo(x, y + r2); ctx.lineTo(x - r2, y); ctx.lineTo(x, y - r2); ctx.closePath();
        } else ctx.arc(x, y, rad, 0, 6.2832); // 초식: 원
        ctx.fill();
        if (aqua) { ctx.strokeStyle = '#7fd4ff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, rad * 1.7 + 1, 0, 6.2832); ctx.stroke(); } // 수생: 파란 테두리
        ctx.strokeStyle = a[k + 7] ? '#d0f' : 'rgba(0,0,0,.6)'; ctx.lineWidth = a[k + 7] ? 1.6 : 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * rad * 1.7, y + Math.sin(ang) * rad * 1.7); ctx.stroke();
        if (a[k + 8] === o.selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rad + 4, 0, 6.2832); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    }
    if (o.brush) {
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.arc(o.brush.x * sc, o.brush.y * sc, o.brush.r * sc, 0, 6.2832); ctx.stroke();
    }
  }

  toWorld(ev: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect(); const f = this.frame;
    const w = f ? f.w : 128, h = f ? f.h : 96;
    return { x: ((ev.clientX - r.left) / r.width) * w, y: ((ev.clientY - r.top) / r.height) * h };
  }
  pick(x: number, y: number): number {
    const f = this.frame; if (!f) return -1; const a = f.ind; let best = -1, bd = 4;
    for (let i = 0; i < a.length / 11; i++) {
      const dx = a[i * 11] - x, dy = a[i * 11 + 1] - y, d = Math.sqrt(dx * dx + dy * dy) - a[i * 11 + 3];
      if (d < bd) { bd = d; best = a[i * 11 + 8]; }
    }
    return best;
  }
}
