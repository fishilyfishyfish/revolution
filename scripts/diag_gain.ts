// 진단: 공격자 고기 식성 구간별 순이득(얻은 에너지 − 공격 비용). 구간 0: <0.2, 1: <0.5, 2: 그 이상
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const over = JSON.parse(arg('cfg', '{}'));
const seed = +arg('seed', '1'), ticks = +arg('ticks', '30000'), every = +arg('every', '10000');
const fnd = arg('founders', 'herb:300').split(',').map((x) => { const [preset, n] = x.split(':'); return { preset, count: +n }; });
const w = World.create(defaultConfig({ seed, founders: fnd, ...over, features: { ...STAGES[7], ...(over.features ?? {}) } }));
let line = `${JSON.stringify(over)} s${seed}:`; let atkT = 0, nT = 0, pd = new Float64Array(9); let pg = new Float64Array(3), pc = new Float64Array(3);
for (let t = 1; t <= ticks; t++) {
  stepSim(w);
  for (const i of w.inds) { nT++; if (i.oAtk > 0) atkT++; }
  if (t % every === 0) {
    const g = w.atkGain.map((x, k) => x - pg[k]), c = w.atkCost.map((x, k) => x - pc[k]); pg = w.atkGain.slice(); pc = w.atkCost.slice();
    const f = (k: number) => `얻음${g[k].toFixed(0)}/비용${c[k].toFixed(0)}/순${(g[k] - c[k]).toFixed(0)}`;
    const n = Math.max(1, w.inds.length); let dm = 0, carn = 0; const sz: number[] = []; for (const i of w.inds) { dm += i.t.diet[3]; if (i.t.diet[3] > 0.5) carn++; sz.push(i.t.size); } sz.sort((a, b) => a - b); const szM = sz.reduce((a, b) => a + b, 0) / Math.max(1, sz.length), szP = sz[Math.floor(sz.length * 0.9)] ?? 0;
    const d = w.dmgByClass.map((x, k) => x - pd[k]); pd = w.dmgByClass.slice(); const dt = d.reduce((a, b) => a + b, 0) || 1; const aR = atkT / Math.max(1, nT); atkT = 0; nT = 0;
    line += ` [t${t / 1000}k 공격출력비${aR.toFixed(2)} 초식끼리피해${(d[0] / dt).toFixed(2)} 개체${w.inds.length} 크기${szM.toFixed(2)}/상위10%${szP.toFixed(2)} 고기식성${(dm / n).toFixed(2)} 육식${carn} 재시작${w.cnt.restarts} 피식${w.cnt.eaten} 초식형 ${f(0)} 잡식형 ${f(1)} 육식형 ${f(2)}]`;
  }
}
console.log(line);
