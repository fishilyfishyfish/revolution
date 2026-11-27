// 진단: 한 설정을 오래 돌리며 식성 분포·공격 비율·순이득의 시간 변화를 본다(읽기 전용).
// 사용: npx tsx scripts/diag_omni.ts <설정json파일> <seed> [ticks] [every]   (설정 파일: {"cfg":{...},"predStart":bool})
import { readFileSync } from 'node:fs';
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
const { cfg, predStart } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const seed = +(process.argv[3] ?? 1), ticks = +(process.argv[4] ?? 40000), every = +(process.argv[5] ?? 4000);
const founders = [{ preset: 'herb', count: 300 }, ...(predStart ? [{ preset: 'predator', count: 30 }] : [])];
const w = World.create(defaultConfig({ seed, founders, ...cfg, features: { ...STAGES[7] } }));
let pg = new Float64Array(3), pc = new Float64Array(3), atkT = 0, nT = 0, e0 = 0;
console.log(`설정 ${JSON.stringify(cfg)} 시작육식 ${predStart} 시드 ${seed}`);
for (let t = 1; t <= ticks; t++) {
  stepSim(w); for (const i of w.inds) { nT++; if (i.oAtk > 0) atkT++; }
  if (t % every === 0) {
    const n = Math.max(1, w.inds.length); const h = [0, 0, 0, 0, 0]; let sz = 0, dm = 0;
    for (const i of w.inds) { h[Math.min(4, Math.floor(i.t.diet[3] * 5))]++; sz += i.t.size; dm += i.t.diet[3]; }
    const g = w.atkGain.map((x, k) => x - pg[k]), c = w.atkCost.map((x, k) => x - pc[k]); pg = w.atkGain.slice(); pc = w.atkCost.slice();
    const net = (k: number) => `${g[k].toFixed(0)}/${c[k].toFixed(0)}`;
    console.log(`t${t / 1000}k 개체${w.inds.length} 크기${(sz / n).toFixed(2)} 고기식성평균${(dm / n).toFixed(2)} 식성분포[0~.2 ${h[0]} .2~.4 ${h[1]} .4~.6 ${h[2]} .6~.8 ${h[3]} .8~1 ${h[4]}] 공격출력비${(atkT / Math.max(1, nT)).toFixed(2)} 구간별 얻음/비용[초식형 ${net(0)} 잡식형 ${net(1)} 육식형 ${net(2)}] 피식(구간)${w.cnt.eaten - e0} 재시작${w.cnt.restarts}`);
    atkT = 0; nT = 0; e0 = w.cnt.eaten;
  }
}
