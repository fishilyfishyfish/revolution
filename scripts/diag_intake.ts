// 진단: 몸집 구간별 섭취. 한 입이 먹이 양에 막혔는가(먹이 부족) 한도에 막혔는가, 개체-틱당 섭취와 기초대사 비교(읽기 전용).
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { PRESETS } from '../src/sim/genome';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const over = JSON.parse(arg('cfg', '{}')), seed = +arg('seed', '1'), ticks = +arg('ticks', '8000'), from = +arg('from', '2000');
const SIZES = [0.0, 0.15, 0.3, 0.45, 0.6, 0.75];
const fnd = SIZES.map((v, k) => { PRESETS.push({ name: `hs${k}`, label: 'x', icon: 'x', water: false, traits: { ARMOR: 0.25, HEAR: 0.3, SIZE: v } }); return { preset: `hs${k}`, count: 50 }; });
const w = World.create(defaultConfig({ seed, founders: fnd, ...over, features: { ...STAGES[7], ...(over.features ?? {}) } }));
const it = [0, 0, 0, 0], basal = [0, 0, 0, 0], cap = [0, 0, 0, 0]; let n0 = new Float64Array(4), a0 = new Float64Array(4), g0 = new Float64Array(4);
for (let t = 1; t <= ticks; t++) {
  if (t === from) { n0 = w.biteN.slice(); a0 = w.biteAvail.slice(); g0 = w.biteGain.slice(); }
  stepSim(w);
  if (t > from) for (const i of w.inds) { const b = i.t.size < 0.8 ? 0 : i.t.size < 1.2 ? 1 : i.t.size < 1.7 ? 2 : 3; it[b]++; basal[b] += i.t.basal; cap[b] += i.t.biteCap; }
}
const names = ['0~0.8', '0.8~1.2', '1.2~1.7', '1.7~3.1'];
console.log(`${JSON.stringify(over)} s${seed} (${from}~${ticks}틱, 전체 개체)`);
for (let b = 0; b < 4; b++) {
  const bites = w.biteN[b] - n0[b], av = w.biteAvail[b] - a0[b], gain = w.biteGain[b] - g0[b], k = Math.max(1, it[b]);
  console.log(`  크기 ${names[b]}: 성체-틱 ${it[b]} 먹기/틱 ${(bites / k).toFixed(3)} 먹이양에 막힌 비율 ${(av / Math.max(1, bites)).toFixed(2)} 섭취/틱 ${(gain / k).toFixed(3)} 기초대사/틱 ${(basal[b] / k).toFixed(3)} 한입한도 ${(cap[b] / k).toFixed(2)} 섭취÷대사 ${(gain / Math.max(1e-9, basal[b])).toFixed(2)}`);
}
