// 도입 실험: 초식만으로 안정시킨 월드에 육식을 뒤늦게 넣으면 유지되는가(읽기 전용 진단, 사용자 도구 아님).
// 외래종 도입 실험과 같다. 에너지는 식물 재고에서 이전되므로(seedIndividuals) 보존은 유지된다.
// 사용: npx tsx scripts/diag_intro.ts <seed> <T0> <도입수> <이후틱> [프리셋]
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
const [seed, T0, cnt, after] = [+(process.argv[2] ?? 1), +(process.argv[3] ?? 15000), +(process.argv[4] ?? 30), +(process.argv[5] ?? 10000)];
const preset = process.argv[6] ?? 'predator';
const w = World.create(defaultConfig({ seed, founders: [{ preset: 'herb', count: 300 }], features: { ...STAGES[7] } }));
for (let t = 0; t < T0; t++) stepSim(w);
const pop0 = w.inds.length, before = w.totalEnergy().total;
const made = w.seedIndividuals(cnt, true, preset);
const drift = Math.abs(w.totalEnergy().total - before) / Math.max(1, before);
let line = `s${seed} 도입시점 ${T0} 개체 ${pop0} + ${made}마리(${preset}) 에너지변화 ${drift.toExponential(1)}:`; let e0 = w.cnt.eaten;
const at = [250, 500, 1000, 2000, 4000, 7000, after];
for (let t = 1; t <= after; t++) {
  stepSim(w);
  if (at.includes(t)) { const P = w.inds.filter((i) => i.t.diet[3] > 0.5); const rf = P.length ? P.reduce((s, i) => s + i.reserve / (i.t.maxReserve * i.f), 0) / P.length : 0; line += ` [+${t} 전체${w.inds.length} 육식${P.length} 저장${rf.toFixed(2)} 피식${w.cnt.eaten - e0}]`; e0 = w.cnt.eaten; }
}
console.log(line);
