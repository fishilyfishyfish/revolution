import { setupCanvas } from './charts';
import { speciesColor } from './mapview';

export interface SpRec { id: number; parent: number; born: number; died: number; peak: number; count: number }

// 종 계통수: x=시간, y=잎 순서. 부모에서 자식 출생 시점으로 수직 연결.
export function drawTree(c: HTMLCanvasElement, recs: SpRec[], tick: number, pruneExtinct: boolean, minPeak: number) {
  const { ctx, w, h } = setupCanvas(c); ctx.clearRect(0, 0, w, h);
  const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = fg; ctx.fillText('계통수 (종 A: 게놈 거리 클러스터)', 8, 12);
  const byId = new Map(recs.map((r) => [r.id, r]));
  // 의미 있는 종만 (최대 개체 수 ≥ minPeak). 부모가 걸러지면 조상 중 살아남은 것으로 연결.
  const keep = new Set(recs.filter((r) => r.peak >= minPeak && (!pruneExtinct || r.died < 0)).map((r) => r.id));
  if (pruneExtinct) { // 살아있는 종의 조상은 남긴다
    for (const r of recs) if (r.died < 0 && r.peak >= minPeak) { let p = byId.get(r.parent); while (p) { if (p.peak >= minPeak) keep.add(p.id); p = byId.get(p.parent); } }
  }
  const eff = (id: number): number => { let p = byId.get(id)?.parent ?? -1; while (p >= 0 && !keep.has(p)) p = byId.get(p)?.parent ?? -1; return p; };
  const kids = new Map<number, number[]>(); const roots: number[] = [];
  for (const r of recs) if (keep.has(r.id)) { const p = eff(r.id); if (p < 0 || p === r.id) roots.push(r.id); else { if (!kids.has(p)) kids.set(p, []); kids.get(p)!.push(r.id); } }
  if (!roots.length) { ctx.fillStyle = muted; ctx.fillText('표시할 종 없음', 10, h / 2); return; }
  const y = new Map<number, number>(); let leaf = 0;
  const walk = (id: number) => { const ch = (kids.get(id) ?? []).sort((a, b) => byId.get(a)!.born - byId.get(b)!.born); if (!ch.length) { y.set(id, leaf++); return; } ch.forEach(walk); y.set(id, (y.get(ch[0])! + y.get(ch[ch.length - 1])!) / 2); };
  roots.forEach(walk);
  const L = 10, R = 40, T = 20, B = 14; const tmax = Math.max(tick, 1);
  const px = (t: number) => L + (t / tmax) * (w - L - R), py = (v: number) => T + ((v + 0.5) / Math.max(1, leaf)) * (h - T - B);
  for (const id of keep) {
    const r = byId.get(id)!, yy = py(y.get(id)!); const p = eff(id);
    ctx.strokeStyle = speciesColor(id); ctx.lineWidth = 2;
    if (p >= 0 && y.has(p)) { ctx.beginPath(); ctx.moveTo(px(r.born), py(y.get(p)!)); ctx.lineTo(px(r.born), yy); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(px(r.born), yy); ctx.lineTo(px(r.died < 0 ? tmax : r.died), yy); ctx.stroke();
    if (r.died >= 0) { ctx.fillStyle = '#c33'; ctx.fillRect(px(r.died) - 1, yy - 4, 2, 8); }
    else { ctx.fillStyle = fg; ctx.fillText(`#${id} (${r.count})`, px(tmax) + 3, yy + 4); }
  }
}
