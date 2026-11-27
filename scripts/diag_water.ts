// 진단: 저장 월드에서 물 셀 위의 육상 개체가 누구인가(나이), 물에 들어온 경로(새로 태어났나 걸어 들어갔나)
import { readFileSync } from 'node:fs';
import { snapshotFromJSON, deserialize } from '../src/sim/snapshot';
import { stepSim } from '../src/sim/runner';
const w = deserialize(snapshotFromJSON(readFileSync(process.argv[2], 'utf8')));
const ticks = +(process.argv[3] ?? 3000);
const wasLand = new Map<number, boolean>(); let firstInWater = 0, bornInWater = 0, walkedIn = 0, ageSum = 0; const ages: number[] = [];
const h0 = w.cnt.habitat;
for (let t = 0; t < ticks; t++) {
  for (const i of w.inds) if (i.alive) wasLand.set(i.id, w.terrain[((i.y | 0) * w.w) + (i.x | 0)] !== 1);
  stepSim(w);
  for (const i of w.inds) {
    if (!i.alive || i.t.aq >= 0.7) continue;
    const inW = w.terrain[((i.y | 0) * w.w) + (i.x | 0)] === 1;
    if (!inW) continue;
    const prev = wasLand.get(i.id);
    if (prev === undefined) { bornInWater++; } else if (prev) { walkedIn++; ages.push(i.age); }
  }
}
ages.sort((a, b) => a - b);
console.log(`${ticks}틱: 서식지 사망 ${w.cnt.habitat - h0} · 물 셀에서 새로 태어난 육상 개체 ${bornInWater} · 땅에서 물로 걸어 들어온 건수 ${walkedIn} (나이 중앙값 ${ages[ages.length >> 1] ?? '-'})`);
