// 진단: 육식 시작 개체가 사냥을 시도하는가 / 얼마나 성공하는가 / 어떻게 사라지는가
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { PRESETS } from '../src/sim/genome';
import { stepSim } from '../src/sim/runner';
const seeds = (process.argv[2] ?? '1,2,3').split(',').map(Number), ticks = +(process.argv[3] ?? 4000), every = +(process.argv[4] ?? 500);
const SZ = process.argv[5] ? +process.argv[5] : undefined;
if (SZ !== undefined) (PRESETS.find((p) => p.name === 'predator')!.traits as any).SIZE = SZ;
for (const seed of seeds) {
  const w = World.create(defaultConfig({ seed, founders: (process.env.FOUNDERS ?? 'herb:300,predator:40').split(',').map((x) => { const [preset, n] = x.split(':'); return { preset, count: +n }; }), features: { ...STAGES[7] } }));
  let line = `s${seed}:`; let eaten0 = 0, atkTicks = 0, atkN = 0, predTicks = 0;
  for (let t = 1; t <= ticks; t++) {
    stepSim(w);
    for (const i of w.inds) if (i.t.diet[3] > 0.5) { predTicks++; if (i.oAtk > 0) atkTicks++; }
    if (t % every === 0) {
      const P = w.inds.filter((i) => i.t.diet[3] > 0.5);
      const rf = P.length ? P.reduce((s, i) => s + i.reserve / (i.t.maxReserve * i.f), 0) / P.length : 0;
      line += ` [t${t} 전체${w.inds.length} 육식${P.length} 육식저장${rf.toFixed(2)} 공격출력비${(atkTicks / Math.max(1, predTicks)).toFixed(2)} 피식${w.cnt.eaten - eaten0} 굶음${w.cnt.starved}]`;
      eaten0 = w.cnt.eaten; atkTicks = 0; predTicks = 0;
    }
  }
  console.log(line);
}
