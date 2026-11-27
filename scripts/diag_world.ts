// 진단: 저장 파일을 읽어 요약하고, 육상 개체가 물을 피하는 뇌를 가졌는지 반사실 프로브로 본다(읽기 전용).
// 사용: npx tsx scripts/diag_world.ts <저장파일.json> [이어돌릴틱]
import { readFileSync } from 'node:fs';
import { snapshotFromJSON, deserialize } from '../src/sim/snapshot';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { defaultConfig } from '../src/sim/config';
import { brainForward, NIN, NH, NOUT } from '../src/sim/genome';
const snap = snapshotFromJSON(readFileSync(process.argv[2], 'utf8'));
const w = deserialize(snap);
const f = w.cfg.features as any;
console.log(`tick ${w.tick} 개체 ${w.inds.length} 기능 neat=${f.neat} memory=${f.memory} 누적 서식지사망 ${w.cnt.habitat} 출생 ${w.cnt.births} 아사 ${w.cnt.starved} 피식 ${w.cnt.eaten} 재시작 ${w.cnt.restarts}`);
const cols = w.history.cols, rows = w.history.rows; const ci = (n: string) => cols.indexOf(n);
if (rows.length) { const step = Math.max(1, Math.floor(rows.length / 12)); let prev = 0, prevT = 0; const out: string[] = [];
  for (let i = 0; i < rows.length; i += step) { const r = rows[i]; out.push(`t${(r[ci('tick')] / 1000).toFixed(0)}k:서식지 ${(r[ci('habitat')] - prev)}/${((r[ci('tick')] - prevT) / 1000).toFixed(0)}k틱`); prev = r[ci('habitat')]; prevT = r[ci('tick')]; }
  console.log('서식지 사망 추이(구간 누적차):', out.join(' ')); }
const inp = new Float64Array(NIN), hid = new Float64Array(NH), out = new Float64Array(NOUT);
function cf(world: World, label: string, fts: any) {
  world.buildHash(); let n = 0, dAcc = 0, dTurn = 0, acc0 = 0, acc1 = 0, nw = 0, accW = 0, accL = 0, nl = 0;
  for (const ind of world.inds) {
    if (world.terrain[((ind.y | 0) * world.w) + (ind.x | 0)] !== 0 || ind.t.aq > 0.3) continue;
    world.sense(ind, inp, false);
    if (inp[18] === 0.5) { nw++; brainForward(ind.genome, inp, hid, out, !!fts.neat); accW += Math.max(0, out[1]); } else if (inp[18] === 0) { nl++; brainForward(ind.genome, inp, hid, out, !!fts.neat); accL += Math.max(0, out[1]); }
    const base = inp[18]; inp[18] = 0; brainForward(ind.genome, inp, hid, out, !!fts.neat); const a0 = Math.max(0, out[1]); const t0 = out[0];
    inp[18] = 0.5; brainForward(ind.genome, inp, hid, out, !!fts.neat); const a1 = Math.max(0, out[1]); const t1 = out[0]; inp[18] = base;
    n++; acc0 += a0; acc1 += a1; dAcc += a1 - a0; dTurn += Math.abs(t1 - t0);
  }
  console.log(`${label}: 육상 개체 ${n} · 앞이 물일 때 평균 가속 ${(accW / Math.max(1, nw)).toFixed(2)}(${nw}) / 앞이 땅일 때 ${(accL / Math.max(1, nl)).toFixed(2)}(${nl}) · 반사실(앞쪽 지형 땅→물) 가속 변화 ${(dAcc / Math.max(1, n)).toFixed(3)} (땅 ${(acc0 / Math.max(1, n)).toFixed(2)} → 물 ${(acc1 / Math.max(1, n)).toFixed(2)}) 회전 변화 ${(dTurn / Math.max(1, n)).toFixed(3)}`);
}
cf(w, '저장 월드', f);
// 대조: 같은 지도·설정에서 창시 초식(무작위 뇌) 집단
const c0 = defaultConfig({ ...(w.cfg as any), founders: [{ preset: 'herb', count: 300 }], features: { ...(w.cfg.features as any) } });
const w0 = World.create(c0);
// 지형을 저장 월드와 같게
for (let i = 0; i < w0.n; i++) w0.terrain[i] = w.terrain[i];
cf(w0, '대조(창시 직후, 같은 지형)', c0.features);
const extra = +(process.argv[3] ?? 0);
if (extra > 0) { const h0 = w.cnt.habitat, b0 = w.cnt.births; for (let t = 0; t < extra; t++) stepSim(w); console.log(`이어서 ${extra}틱: 서식지 사망 ${w.cnt.habitat - h0}, 출생 ${w.cnt.births - b0}, 개체 ${w.inds.length}`); }
