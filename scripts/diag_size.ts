// 진단: 큰 몸이 왜 불리한가. 창시 집단의 몸집을 넓게 퍼뜨려 놓고(초기 조건), 태어난 개체를 몸집 구간별로 추적한다(읽기 전용).
// 지표: 성체(150틱) 도달률, 평생 낳은 새끼 수(사망 확인된 개체), 평균 수명, 사망 원인 비율. 몸집 구간은 태어난 개체의 형질 크기.
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { PRESETS } from '../src/sim/genome';
import { CAUSE_NAMES } from '../src/sim/lineage';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const over = JSON.parse(arg('cfg', '{}')), seed = +arg('seed', '1'), ticks = +arg('ticks', '15000'), from = +arg('from', '0');
const SIZES = [0.0, 0.15, 0.3, 0.45, 0.6, 0.75];
const fnd = SIZES.map((v, k) => { PRESETS.push({ name: `hs${k}`, label: 'x', icon: 'x', water: false, traits: { ARMOR: 0.25, HEAR: 0.3, SIZE: v } }); return { preset: `hs${k}`, count: 50 }; });
const w = World.create(defaultConfig({ seed, founders: fnd, ...over, features: { ...STAGES[7], ...(over.features ?? {}) } }));
const sizeOf = new Map<number, number>();
const note = () => { for (const i of w.inds) if (!sizeOf.has(i.id)) sizeOf.set(i.id, i.t.size); };
note();
for (let t = 0; t < ticks; t++) { stepSim(w); note(); }
const L = w.lineage; const kids = new Int32Array(L.n);
for (let id = 0; id < L.n; id++) { if (L.pa[id] >= 0) kids[L.pa[id]]++; if (L.pb[id] >= 0 && L.pb[id] !== L.pa[id]) kids[L.pb[id]]++; }
// 부모별 새끼 출생 틱 모으기(번식 횟수·한 번에 낳는 수 계산용)
const kidTicks: Map<number, number[]> = new Map();
for (let id = 0; id < L.n; id++) { for (const p of new Set([L.pa[id], L.pb[id]])) { if (p < 0) continue; const a = kidTicks.get(p) ?? []; a.push(L.birth[id]); kidTicks.set(p, a); } }
const bins = [[0, 0.8], [0.8, 1.2], [1.2, 1.7], [1.7, 3.1]];
console.log(`${JSON.stringify(over)} s${seed} (${ticks}틱, 창시 몸집 분산) 마지막 개체 ${w.inds.length}, 평균크기 ${(w.inds.reduce((a, i) => a + i.t.size, 0) / Math.max(1, w.inds.length)).toFixed(2)}`);
for (const [lo, hi] of bins) {
  let n = 0, adult = 0, dead = 0, ageSum = 0, kidSum = 0, adultTicks = 0, broods = 0; const causes: Record<number, number> = {};
  for (const [id, sz] of sizeOf) {
    if (id >= L.n || sz < lo || sz >= hi) continue; if (L.birth[id] < from) continue; n++;
    const d = L.death[id];
    if (d >= 0) { dead++; ageSum += d - L.birth[id]; kidSum += kids[id]; causes[L.cause[id]] = (causes[L.cause[id]] ?? 0) + 1; if (d - L.birth[id] >= 150) adult++; adultTicks += Math.max(0, d - L.birth[id] - 150); broods += new Set(kidTicks.get(id) ?? []).size; } else adult++;
  }
  const cs = Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, k]) => `${CAUSE_NAMES[+c]} ${(k / Math.max(1, dead)).toFixed(2)}`).join(' ');
  console.log(`  크기 ${lo}~${hi}: 태어남 ${n} 성체도달 ${(adult / Math.max(1, n)).toFixed(2)} 사망확인 ${dead} 평균수명 ${(ageSum / Math.max(1, dead)).toFixed(0)} 평생새끼 ${(kidSum / Math.max(1, dead)).toFixed(2)} 번식횟수/1000성체틱 ${((broods / Math.max(1, adultTicks)) * 1000).toFixed(2)} 한번에낳는수 ${(kidSum / Math.max(1, broods)).toFixed(2)} 사인 ${cs}`);
}
