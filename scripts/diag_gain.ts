// 진단: 공격자 고기 식성 구간별 순이득(얻은 에너지 − 공격 비용). 구간 0: <0.2, 1: <0.5, 2: 그 이상
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const over = JSON.parse(arg('cfg', '{}'));
const seed = +arg('seed', '1'), ticks = +arg('ticks', '30000'), every = +arg('every', '10000');
const fnd = arg('founders', 'herb:300').split(',').map((x) => { const [preset, n] = x.split(':'); return { preset, count: +n }; });
const w = World.create(defaultConfig({ seed, founders: fnd, ...over, features: { ...STAGES[7], ...(over.features ?? {}) } }));
let line = `${JSON.stringify(over)} s${seed}:`; let pg = new Float64Array(3), pc = new Float64Array(3);
for (let t = 1; t <= ticks; t++) {
  stepSim(w);
  if (t % every === 0) {
    const g = w.atkGain.map((x, k) => x - pg[k]), c = w.atkCost.map((x, k) => x - pc[k]); pg = w.atkGain.slice(); pc = w.atkCost.slice();
    const f = (k: number) => `얻음${g[k].toFixed(0)}/비용${c[k].toFixed(0)}/순${(g[k] - c[k]).toFixed(0)}`;
    const n = Math.max(1, w.inds.length); let dm = 0, carn = 0; for (const i of w.inds) { dm += i.t.diet[3]; if (i.t.diet[3] > 0.5) carn++; }
    line += ` [t${t / 1000}k 개체${w.inds.length} 고기식성${(dm / n).toFixed(2)} 육식${carn} 재시작${w.cnt.restarts} 피식${w.cnt.eaten} 초식형 ${f(0)} 잡식형 ${f(1)} 육식형 ${f(2)}]`;
  }
}
console.log(line);
