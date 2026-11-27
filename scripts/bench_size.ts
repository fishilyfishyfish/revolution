// 벤치마크: 지도 크기별 틱 속도 (읽기 전용)
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
const [w, h, pop] = [+(process.argv[2] ?? 128), +(process.argv[3] ?? 96), +(process.argv[4] ?? 300)];
const world = World.create(defaultConfig({ w, h, seed: 1, founders: [{ preset: 'herb', count: pop }], features: { ...STAGES[7] } }));
for (let i = 0; i < 300; i++) stepSim(world);
const t0 = performance.now(); for (let i = 0; i < 1200; i++) stepSim(world); const dt = (performance.now() - t0) / 1000;
console.log(`${w}x${h} 시작 ${pop}마리: 1200틱 ${dt.toFixed(1)}초 (${(1200 / dt).toFixed(0)} tick/s), 개체 ${world.inds.length}`);
