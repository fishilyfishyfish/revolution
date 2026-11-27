// 진단: 프리셋별 식성과 소화 효율, 그리고 40000틱 뒤 정착한 초식 집단의 식성 분포
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
const cfg = defaultConfig();
for (const name of ['herb', 'omni', 'predator']) {
  const w = World.create(defaultConfig({ seed: 1, initPop: 0, founders: [{ preset: name, count: 60 }], features: { ...STAGES[7] } }));
  const n = w.inds.length; const m = [0, 0, 0, 0], e = [0, 0, 0, 0];
  for (const i of w.inds) for (let k = 0; k < 4; k++) { m[k] += i.t.diet[k] / n; e[k] += i.t.eff[k] / n; }
  console.log(name, '식성', m.map((x) => x.toFixed(2)).join('/'), '효율', e.map((x) => x.toFixed(2)).join('/'));
}
const seed = +(process.argv[2] ?? 1), ticks = +(process.argv[3] ?? 30000);
const w = World.create(defaultConfig({ seed, founders: [{ preset: 'herb', count: 300 }], features: { ...STAGES[7] } }));
for (let t = 0; t < ticks; t++) stepSim(w);
const n = w.inds.length; const m = [0, 0, 0, 0]; let maxPlant = 0, sumMax = 0;
for (const i of w.inds) { for (let k = 0; k < 4; k++) m[k] += i.t.diet[k] / n; const mp = Math.max(i.t.eff[0], i.t.eff[1], i.t.eff[2]); sumMax += mp; if (mp > maxPlant) maxPlant = mp; }
console.log(`정착 초식(시드 ${seed}, ${ticks}틱, 개체 ${n}) 평균 식성`, m.map((x) => x.toFixed(2)).join('/'), `가장 잘 먹는 식물 종 효율 평균 ${(sumMax / n).toFixed(2)} 최대 ${maxPlant.toFixed(2)}`);
// 식물 종 분포(전체 바이오매스)
const tot = w.plants.map((p) => p.reduce((a, b) => a + b, 0)); const T = tot[0] + tot[1] + tot[2];
console.log('식물 바이오매스 비율(A/B/C)', tot.map((x) => (x / T).toFixed(2)).join('/'));
