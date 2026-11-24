import { setupCanvas } from './charts';
import { INPUT_NAMES, NH, NIN, NOUT, OUTPUT_NAMES } from '../sim/genome';

// 뇌 구조(15-8-5)와 현재 활성화. 선 굵기=가중치, 색=부호, 노드 밝기=활성값.
export function drawBrain(c: HTMLCanvasElement, br: { inp: number[]; hid: number[]; out: number[]; w: number[] }) {
  const { ctx, w, h } = setupCanvas(c); ctx.clearRect(0, 0, w, h);
  const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
  ctx.font = '10px system-ui, sans-serif';
  if (!br.w.length) { ctx.fillStyle = fg; ctx.fillText('사망한 개체 (뇌 정보 없음)', 10, 20); return; }
  const xs = [90, w / 2, w - 90], ys = (n: number, i: number) => 12 + ((i + 0.5) / n) * (h - 24);
  const W1 = 0, B1 = NIN * NH, W2 = B1 + NH;
  for (let i = 0; i < NIN; i++) for (let j = 0; j < NH; j++) {
    const wt = br.w[W1 + i * NH + j], a = br.inp[i];
    ctx.strokeStyle = wt > 0 ? `rgba(80,180,255,${Math.min(0.9, Math.abs(wt * a) * 0.6 + 0.04)})` : `rgba(255,110,90,${Math.min(0.9, Math.abs(wt * a) * 0.6 + 0.04)})`;
    ctx.lineWidth = Math.min(3, Math.abs(wt) * 0.8 + 0.2);
    ctx.beginPath(); ctx.moveTo(xs[0], ys(NIN, i)); ctx.lineTo(xs[1], ys(NH, j)); ctx.stroke();
  }
  for (let j = 0; j < NH; j++) for (let k = 0; k < NOUT; k++) {
    const wt = br.w[W2 + j * NOUT + k], a = br.hid[j];
    ctx.strokeStyle = wt > 0 ? `rgba(80,180,255,${Math.min(0.9, Math.abs(wt * a) * 0.6 + 0.04)})` : `rgba(255,110,90,${Math.min(0.9, Math.abs(wt * a) * 0.6 + 0.04)})`;
    ctx.lineWidth = Math.min(3, Math.abs(wt) * 0.8 + 0.2);
    ctx.beginPath(); ctx.moveTo(xs[1], ys(NH, j)); ctx.lineTo(xs[2], ys(NOUT, k)); ctx.stroke();
  }
  const node = (x: number, y: number, v: number) => { const l = Math.round(50 + 40 * v); ctx.fillStyle = `hsl(${v >= 0 ? 200 : 8},70%,${l}%)`; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.2832); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); };
  ctx.fillStyle = fg;
  for (let i = 0; i < NIN; i++) { node(xs[0], ys(NIN, i), br.inp[i]); ctx.textAlign = 'right'; ctx.fillText(`${INPUT_NAMES[i]} ${br.inp[i].toFixed(2)}`, xs[0] - 8, ys(NIN, i) + 3); }
  for (let j = 0; j < NH; j++) node(xs[1], ys(NH, j), br.hid[j]);
  for (let k = 0; k < NOUT; k++) { node(xs[2], ys(NOUT, k), br.out[k]); ctx.textAlign = 'left'; ctx.fillStyle = fg; ctx.fillText(`${OUTPUT_NAMES[k]} ${br.out[k].toFixed(2)}`, xs[2] + 8, ys(NOUT, k) + 3); }
}
