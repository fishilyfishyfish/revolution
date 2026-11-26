// 범용 실험 도구: 설정 덮어쓰기 + 시작 집단 + 여러 시드를 돌려 시점별 요약을 출력한다.
// 예) npx tsx scripts/experiment.ts --cfg '{"effPlant":0.6}' --seeds 1,2,3 --ticks 60000 --every 20000 --founders herb:300,predator:40
// 주의: 백그라운드로 여러 개를 돌릴 땐 JSON 따옴표가 셸을 거치며 깨지기 쉽다. 스크립트 파일에 변수로 담아 호출하고,
//       시작 후 pgrep으로 프로세스가 떠 있는지 꼭 확인할 것(바로 죽어도 완료 표시 파일이 만들어질 수 있다).
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const over = JSON.parse(arg('cfg', '{}'));
const seeds = arg('seeds', '1,2,3').split(',').map(Number);
const ticks = +arg('ticks', '60000'), every = +arg('every', '20000');
const founders = arg('founders', 'herb:300').split(',').map((x) => { const [preset, n] = x.split(':'); return { preset, count: +n }; });
const stage = +arg('stage', '7');

for (const seed of seeds) {
  const w = World.create(defaultConfig({ seed, founders, ...over, features: { ...STAGES[stage], ...(over.features ?? {}) } }));
  let line = `${JSON.stringify(over)} s${seed}:`;
  for (let t = 1; t <= ticks; t++) {
    stepSim(w);
    if (t % every === 0) {
      const n = Math.max(1, w.inds.length); let dm = 0, sz = 0, g = 0, carn = 0;
      for (const i of w.inds) { dm += i.t.diet[3]; sz += i.t.size; g += i.t.intakeMul; if (i.t.diet[3] > 0.5) carn++; }
      line += ` [t${t / 1000}k 개체${w.inds.length} 크기${(sz / n).toFixed(2)} 고기식성${(dm / n).toFixed(2)} 육식${carn} 섭식배수${(g / n).toFixed(2)} 피식누적${w.cnt.eaten} 재시작${w.cnt.restarts}]`;
    }
  }
  console.log(line);
}
