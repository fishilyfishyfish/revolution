// 종분화 실험: 맵을 물 장벽으로 반으로 나눠 충분히 돌린 뒤 장벽을 허물고, 양쪽 집단이 여전히 교배 가능한지 확인
// 사용: npx tsx scripts/barrier.ts --seed 1 --isolate 60000 --after 20000 [--control 1]
import { writeFileSync } from 'node:fs';
import { STAGES, defaultConfig } from '../src/sim/config';
import { World, Ind } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { compatProb, genomeDistance } from '../src/sim/genome';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const seed = +arg('seed', '1'), T1 = +arg('isolate', '60000'), T2 = +arg('after', '20000'), control = arg('control', '0') === '1';
const bw = +arg('width', '16');
const cfg = defaultConfig({ seed, features: STAGES[6], initPop: 600, genTerrain: false });
const w = World.create(cfg);
const x0 = cfg.w / 2 - bw / 2, x1 = cfg.w / 2 + bw / 2;
const log: string[] = []; const say = (s: string) => { log.push(s); console.log(s); };
const barrier = (v: 0 | 1) => ({ kind: 'terrain' as const, shape: 'rect' as const, x: x0, y: 0, x2: x1, y2: cfg.h, r: 0, value: v });
if (!control) w.schedule(0, barrier(1)); // 틱 0에 장벽 (같은 개입 로그 방식)
// --env 1: 양쪽 환경을 다르게 (왼쪽 온난·식물 A 우세, 오른쪽 한랭·식물 C 우세). 장벽 유무와 독립이라 대조군에도 적용 가능
if (arg('env', '0') === '1') {
  w.schedule(0, { kind: 'biome', shape: 'rect', x: 0, y: 0, x2: x0, y2: cfg.h, r: 0, plant: 0, zone: 1 });
  w.schedule(0, { kind: 'biome', shape: 'rect', x: x1, y: 0, x2: cfg.w, y2: cfg.h, r: 0, plant: 2, zone: 0 });
}
const left = (i: Ind) => i.x < x0, right = (i: Ind) => i.x > x1;
const tmean = (a: Ind[], f: (i: Ind) => number) => (a.length ? a.reduce((s, i) => s + f(i), 0) / a.length : NaN);

function pairStats(a: Ind[], b: Ind[], n = 4000) {
  let sum = 0, nz = 0, cnt = 0, dsum = 0; const rng = (k: number) => (k * 2654435761) >>> 0;
  if (!a.length || !b.length) return { d: NaN, p: NaN, fracCompat: NaN };
  for (let k = 0; k < n; k++) {
    const x = a[rng(k + 1) % a.length], y = b[rng(k + 7919) % b.length]; if (x === y) continue;
    const d = genomeDistance(x.genome, y.genome); const p = compatProb(d, cfg.dmax);
    dsum += d; sum += p; if (p > 0) nz++; cnt++;
  }
  return { d: dsum / cnt, p: sum / cnt, fracCompat: nz / cnt };
}
function report(label: string) {
  const L = w.inds.filter(left), R = w.inds.filter(right);
  const wl = pairStats(L, L), wr = pairStats(R, R), cr = pairStats(L, R);
  say(`[${label}] t=${w.tick} 좌 ${L.length} 우 ${R.length} | 좌내 d=${wl.d.toFixed(3)} p=${wl.p.toFixed(3)} | 우내 d=${wr.d.toFixed(3)} p=${wr.p.toFixed(3)} | 좌↔우 d=${cr.d.toFixed(3)} 평균교배확률=${cr.p.toFixed(3)} 교배가능쌍비율=${cr.fracCompat.toFixed(3)}`
    + ` | 종(클러스터) ${w.spA.filter((s) => s.died < 0 && s.count >= 8).length} 교배집단 ${w.spB.filter((s) => s.died < 0 && s.count >= 8).length} 유성출생 ${w.cnt.sexBirths}/${w.cnt.births}`);
  const f = (a: Ind[]) => `tOpt ${tmean(a, (i) => i.t.tOpt).toFixed(1)} 식성A/B/C ${tmean(a, (i) => i.t.diet[0]).toFixed(2)}/${tmean(a, (i) => i.t.diet[1]).toFixed(2)}/${tmean(a, (i) => i.t.diet[2]).toFixed(2)} 크기 ${tmean(a, (i) => i.t.size).toFixed(2)}`;
  say(`      형질 좌: ${f(L)} | 우: ${f(R)}`);
  return cr;
}
say(`# 장벽 실험 seed=${seed} control=${control} 장벽폭=${bw} 격리 ${T1} 틱, 철거 후 ${T2} 틱`);
const t0 = Date.now();
for (let t = 0; t < T1; t++) { stepSim(w); if (t > 0 && t % 10000 === 0) report('격리 중'); if (w.dead) break; }
const before = report('철거 직전');
if (!control) w.intervene(barrier(0));
for (let t = 0; t < T2; t++) { stepSim(w); if (t % 5000 === 4999) report('철거 후'); }
const after = report('최종');
const verdict = before.p < 0.1 || before.fracCompat < 0.05 ? '교배 불가 → 종분화 발생' : before.p < 0.5 * 1 ? '부분 격리 (교배 확률 저하)' : '여전히 교배 가능 → 종분화 없음';
say(`## 판정(철거 직전 기준): ${verdict}; 철거 후 좌↔우 평균교배확률 ${after.p.toFixed(3)} (직전 ${before.p.toFixed(3)})`);
say(`## elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s checksum ${w.checksum()}`);
writeFileSync(`out/barrier_seed${seed}${control ? "_control" : ""}${process.argv.includes("--tag") ? "_" + process.argv[process.argv.indexOf("--tag") + 1] : ""}.txt`, log.join('\n') + '\n');
