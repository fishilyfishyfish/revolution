// 진단: 정착한 초식 집단의 조향 품질(식물/개체가 보일 때 회전 방향이 그쪽인 비율, 무작위=0.5)을 설정별로 비교
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { brainForward, NIN, NH, NOUT } from '../src/sim/genome';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const over = JSON.parse(arg('cfg', '{}')), seed = +arg('seed', '1'), ticks = +arg('ticks', '30000'), every = +arg('every', '10000');
function probe(w: World) {
  w.buildHash();
  const inp = new Float64Array(NIN), hid = new Float64Array(NH), out = new Float64Array(NOUT);
  let aP = 0, nP = 0, aO = 0, nO = 0, sp = 0;
  for (const ind of w.inds) {
    w.sense(ind, inp, false); brainForward(ind.genome, inp, hid, out, !!w.cfg.features.neat, ind.lw ?? null, null);
    if (inp[1] > 0 && Math.abs(inp[0]) > 0.05) { nP++; if (out[0] * inp[0] > 0) aP++; }
    if (inp[6] > 0 && Math.abs(inp[5]) > 0.05) { nO++; if (out[0] * inp[5] > 0) aO++; }
    sp += Math.max(0, out[1]);
  }
  const f = (a: number, n: number) => (n ? (a / n).toFixed(2) : '-');
  return `식물쪽회전 ${f(aP, nP)}(${nP}) 개체쪽회전 ${f(aO, nO)}(${nO}) 평균가속 ${(sp / Math.max(1, w.inds.length)).toFixed(2)}`;
}
const w = World.create(defaultConfig({ seed, founders: [{ preset: 'herb', count: 300 }], ...over, features: { ...STAGES[7], ...(over.features ?? {}) } }));
let line = `${JSON.stringify(over)} s${seed}:`;
for (let t = 1; t <= ticks; t++) {
  stepSim(w);
  if (t % every === 0) line += ` [t${t / 1000}k 개체${w.inds.length} 재시작${w.cnt.restarts} ${probe(w)} 식물${(w.totalEnergy().plants / 1000).toFixed(0)}k]`;
}
console.log(line);
