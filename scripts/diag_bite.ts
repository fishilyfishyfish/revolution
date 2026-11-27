// 진단: 누가 누구를 무는가(공격자·피해자의 고기 식성 구간별 피해량). 구간 0: <0.2(초식), 1: <0.5(잡식), 2: 그 이상(육식)
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const over = JSON.parse(arg('cfg', '{}')), seed = +arg('seed', '1'), ticks = +arg('ticks', '30000'), every = +arg('every', '10000');
const w = World.create(defaultConfig({ seed, founders: [{ preset: 'herb', count: 300 }], ...over, features: { ...STAGES[7], ...(over.features ?? {}) } }));
let line = `s${seed}:`; let prev = new Float64Array(9), atkT = 0, nT = 0;
for (let t = 1; t <= ticks; t++) {
  stepSim(w);
  for (const i of w.inds) { nT++; if (i.oAtk > 0) atkT++; }
  if (t % every === 0) {
    const d = w.dmgByClass.map((x, k) => x - prev[k]); prev = w.dmgByClass.slice();
    const tot = d.reduce((a, b) => a + b, 0) || 1;
    line += ` [t${t / 1000}k 개체${w.inds.length} 공격출력비${(atkT / Math.max(1, nT)).toFixed(2)} 피해합${tot.toFixed(0)} 초식→초식${(d[0] / tot).toFixed(2)} 초식→잡식이상${((d[1] + d[2]) / tot).toFixed(2)} 잡식이상→초식${((d[3] + d[6]) / tot).toFixed(2)} 잡식이상→잡식이상${((d[4] + d[5] + d[7] + d[8]) / tot).toFixed(2)}]`;
    atkT = 0; nT = 0;
  }
}
console.log(line);
