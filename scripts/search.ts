// 월드 설정 탐색(바깥 루프): 기존 옵션을 라틴 하이퍼큐브로 훑어서 "포식자가 유지되는 조건"의 지도를 만든다.
// 시뮬레이션 안에는 아무 장치도 넣지 않는다(개체에게 보상·점수 없음). 개체의 뇌는 여전히 진화로만 바뀐다.
// 사용: npx tsx scripts/search.ts --id 3 --n 60 --seeds 1,2 --ticks 15000 --out out/search
//       npx tsx scripts/search.ts --summary out/search --n 60
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
// 탐색 범위(전부 기존 옵션). [이름, 최소, 최대, 현실 범위 메모]
const DIMS: [string, number, number][] = [
  ['cBasal', 0.02, 0.07], ['cAttack', 0.05, 0.5], ['meatBase', 0, 0.7], ['atkRatio', 0, 0.6], ['refuge', 0, 1], ['dominance', 0, 0.8],
  ['sunRate', 0.03, 0.12], ['effPlant', 0.5, 0.9], ['dietCurve', 0.5, 1], ['seasonGrowthAmp', 0.3, 0.95], ['attackK', 1, 4], ['predStart', 0, 1],
];
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function samples(n: number): Record<string, number>[] { // 라틴 하이퍼큐브: 차원마다 층을 한 번씩 쓴다
  const r = rng(12345); const out: Record<string, number>[] = Array.from({ length: n }, () => ({}));
  for (const [name, lo, hi] of DIMS) {
    const perm = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < n; i++) out[i][name] = lo + ((perm[i] + r()) / n) * (hi - lo);
  }
  return out;
}
function runOne(c: Record<string, number>, seed: number, ticks: number) {
  const { predStart, ...cfg } = c;
  const founders = [{ preset: 'herb', count: 300 }, ...(predStart > 0.5 ? [{ preset: 'predator', count: 30 }] : [])];
  const w = World.create(defaultConfig({ seed, founders, ...cfg, features: { ...STAGES[7] } }));
  const preds: number[] = [], pops: number[] = [], meat: number[] = [];
  for (let t = 1; t <= ticks; t++) {
    stepSim(w);
    if (t >= 5000 && t % 1000 === 0) { let p = 0, m = 0; for (const i of w.inds) { if (i.t.diet[3] > 0.5) p++; m += i.t.diet[3]; } preds.push(p); pops.push(w.inds.length); meat.push(m / Math.max(1, w.inds.length)); }
  }
  const persist = preds.filter((p, k) => p >= 5 && pops[k] >= 100).length / Math.max(1, preds.length);
  return { persist, maxPred: Math.max(...preds), lastPred: preds[preds.length - 1], pop: pops[pops.length - 1], meat: meat[meat.length - 1], restarts: w.cnt.restarts };
}
if (process.argv.includes('--print')) { // 설정 하나를 JSON으로 출력(재현용): --print --id 41 --n 60
  const c = samples(+arg('n', '60'))[+arg('id', '0')]; const { predStart, ...cfg } = c; console.log(JSON.stringify({ cfg, predStart: predStart > 0.5 }));
} else if (process.argv.includes('--summary')) {
  const dir = arg('summary', 'out/search'), n = +arg('n', '60'); const S = samples(n); const rows: any[] = [];
  for (let i = 0; i < n; i++) { const f = `${dir}_${i}.json`; if (existsSync(f)) { try { rows.push({ i, c: S[i], ...JSON.parse(readFileSync(f, 'utf8')) }); } catch { /* 미완료 */ } } }
  rows.sort((a, b) => b.score - a.score);
  console.log(`완료 ${rows.length}/${n}개. 점수 = 시드 평균 "육식(고기 식성>0.5) 5마리 이상이 유지된 시점 비율(5000틱 이후)", 재시작이 있으면 신뢰 낮음(표시)`);
  console.log('상위 8:'); for (const r of rows.slice(0, 8)) console.log(`  #${r.i} 점수 ${r.score.toFixed(2)} 최대육식 ${r.maxPred} 최종육식 ${r.lastPred} 개체 ${r.pop} 고기식성 ${r.meat.toFixed(3)} 재시작 ${r.restarts}${r.restarts ? ' (재시작!)' : ''} | ` + Object.entries(r.c).map(([k, v]) => `${k}=${(v as number).toFixed(2)}`).join(' '));
  const pos = rows.filter((r) => r.score > 0).length; console.log(`점수>0 설정: ${pos}개 / 최대 점수 ${rows[0]?.score.toFixed(2)}`);
  console.log('차원별 평균 점수(낮은 절반 / 높은 절반):'); for (const [name] of DIMS) { const s = [...rows].sort((a, b) => a.c[name] - b.c[name]); const h = Math.floor(s.length / 2); const m = (x: any[]) => (x.reduce((a, r) => a + r.score, 0) / Math.max(1, x.length)).toFixed(3); console.log(`  ${name}: ${m(s.slice(0, h))} / ${m(s.slice(h))}`); }
} else {
  const id = +arg('id', '0'), n = +arg('n', '60'), seeds = arg('seeds', '1,2').split(',').map(Number), ticks = +arg('ticks', '15000'), out = arg('out', 'out/search');
  const c = samples(n)[id]; const rs = seeds.map((s) => runOne(c, s, ticks));
  const avg = (k: string) => rs.reduce((a, r: any) => a + r[k], 0) / rs.length;
  writeFileSync(`${out}_${id}.json`, JSON.stringify({ score: avg('persist'), maxPred: Math.max(...rs.map((r) => r.maxPred)), lastPred: Math.round(avg('lastPred')), pop: Math.round(avg('pop')), meat: avg('meat'), restarts: rs.reduce((a, r) => a + r.restarts, 0), seeds, ticks }));
}
