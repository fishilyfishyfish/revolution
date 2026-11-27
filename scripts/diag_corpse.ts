// 진단: 사체의 흐름. 사체로 들어온 양, 분해되어 토양으로 간 양, 먹힌 양(먹는 개체 식성 구간별)과 식물 섭취 대비 비율(읽기 전용).
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const over = JSON.parse(arg('cfg', '{}')), seed = +arg('seed', '1'), ticks = +arg('ticks', '20000'), every = +arg('every', '5000');
const w = World.create(defaultConfig({ seed, founders: [{ preset: 'herb', count: 300 }], ...over, features: { ...STAGES[7], ...(over.features ?? {}) } }));
let pIn = 0, pDec = 0, pE = new Float64Array(3), pP = new Float64Array(3);
let line = `${JSON.stringify(over)} s${seed}:`;
for (let t = 1; t <= ticks; t++) {
  stepSim(w);
  if (t % every === 0) {
    const cin = w.corpseIn - pIn, cdec = w.corpseDec - pDec; const ce = w.corpseEat.map((x, k) => x - pE[k]), pe = w.plantEat.map((x, k) => x - pP[k]);
    pIn = w.corpseIn; pDec = w.corpseDec; pE = w.corpseEat.slice(); pP = w.plantEat.slice();
    const eat = ce[0] + ce[1] + ce[2]; const plant = pe[0] + pe[1] + pe[2]; const stock = w.totalEnergy().corpse;
    line += ` [t${t / 1000}k 개체${w.inds.length} 사체유입${cin.toFixed(0)} 분해${(cdec / Math.max(1, cin) * 100).toFixed(0)}% 먹힘${(eat / Math.max(1, cin) * 100).toFixed(1)}% (초식형${ce[0].toFixed(0)} 잡식형${ce[1].toFixed(0)} 육식형${ce[2].toFixed(0)}) 사체/식물 섭취비${(eat / Math.max(1, plant) * 100).toFixed(1)}% 사체재고${stock.toFixed(0)}]`;
  }
}
console.log(line);
