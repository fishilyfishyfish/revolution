// 헤드리스 검증: npx tsx scripts/headless.ts --stage 3 --seed 1 --ticks 100000
import { writeFileSync } from 'node:fs';
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { STAT_COLS } from '../src/sim/analysis';
import { COST_NAMES } from '../src/sim/world';
import { brainForward, NIN, NH, NOUT } from '../src/sim/genome';

// 행동 프로브(읽기 전용): 식물/먹이가 보일 때 회전 방향이 먹이 쪽인 비율 (무작위=0.5)
function probe(w: World) {
  w.buildHash();
  const inp = new Float64Array(NIN), hid = new Float64Array(NH), out = new Float64Array(NOUT);
  let agreeP = 0, nP = 0, agreeO = 0, nO = 0, agreeC = 0, nC = 0, spdNear = 0, nNear = 0, spdFar = 0, nFar = 0, biteNear = 0, biteFar = 0;
  for (const ind of w.inds) {
    w.sense(ind, inp, false); brainForward(ind.genome, inp, hid, out);
    if (inp[1] > 0 && Math.abs(inp[0]) > 0.05) { nP++; if (out[0] * inp[0] > 0) agreeP++; }
    if (inp[4] > 0 && Math.abs(inp[3]) > 0.05) { nC++; if (out[0] * inp[3] > 0) agreeC++; }
    if (inp[6] > 0 && Math.abs(inp[5]) > 0.05) { nO++; if (out[0] * inp[5] > 0) agreeO++; }
    if (inp[1] > 0.8) { nNear++; spdNear += Math.max(0, out[1]); biteNear += out[2] > 0 ? 1 : 0; } else if (inp[1] === 0 || inp[1] < 0.3) { nFar++; spdFar += Math.max(0, out[1]); biteFar += out[2] > 0 ? 1 : 0; }
  }
  const f = (a: number, n: number) => (n ? (a / n).toFixed(2) : '-');
  return `probe: 식물쪽회전 ${f(agreeP, nP)}(${nP}) 사체쪽 ${f(agreeC, nC)}(${nC}) 개체쪽 ${f(agreeO, nO)}(${nO}) 가속(식물근처/먼곳) ${f(spdNear, nNear)}/${f(spdFar, nFar)} 먹기(근처/먼곳) ${f(biteNear, nNear)}/${f(biteFar, nFar)}`;
}

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const stage = +arg('stage', '7'), seed = +arg('seed', '1'), ticks = +arg('ticks', '100000');
const pop = +arg('pop', '400'), tag = arg('tag', `s${stage}_seed${seed}`);
const over = JSON.parse(arg('cfg', '{}'));
const cfg = defaultConfig({ seed, initPop: stage === 1 ? 0 : pop, ...over, features: { ...STAGES[stage], ...(over.features ?? {}) } });
const w = World.create(cfg);
const t0 = Date.now();
const e0 = w.totalEnergy().total;
let maxDrift = 0, maxPop = 0, minPop = 1e9, ever = false;
const col = (n: string) => STAT_COLS.indexOf(n);
const lines: string[] = [];
const say = (s: string) => { lines.push(s); console.log(s); };
say(`# stage ${stage} seed ${seed} ticks ${ticks} initPop ${cfg.initPop}`);
for (let t = 1; t <= ticks; t++) {
  stepSim(w);
  const n = w.inds.length; if (n > maxPop) maxPop = n; if (n < minPop && t > 500) minPop = n;
  if (t % 1000 === 0) {
    const e = w.totalEnergy().total;
    const drift = Math.abs(e - (e0 + w.cumIn - w.cumOut)) / Math.max(1, e);
    if (drift > maxDrift) maxDrift = drift;
  }
  if (t % 5000 === 0) {
    const r = w.history.rows[w.history.rows.length - 1];
    const e = w.totalEnergy();
    say(`t=${t} pop=${n} births=${w.cnt.births} starved=${w.cnt.starved} eaten=${w.cnt.eaten} dis=${w.cnt.disease} restarts=${w.cnt.restarts} `
      + `P=${e.plants.toFixed(0)} B=${e.bodies.toFixed(0)} C=${e.corpse.toFixed(0)} S=${e.soil.toFixed(0)} nA=${r?.[col('nA')]} nB=${r?.[col('nB')]} `
      + `size=${r?.[col('m_size')].toFixed(2)} v=${r?.[col('m_vmax')].toFixed(2)} vis=${r?.[col('m_vis')].toFixed(1)} sex=${r?.[col('m_sex')].toFixed(2)} `
      + `tps=${(t / ((Date.now() - t0) / 1000)).toFixed(0)}`);
  }
  if (t % 10000 === 0 && w.inds.length) say('   ' + probe(w));
  if (w.dead) { say('!! 완전 전멸'); break; }
}
// 요약: 형질 평균 이동
const rows = w.history.rows; const k = Math.max(1, Math.floor(rows.length * 0.1));
const avg = (a: number[][], c: number) => a.reduce((s, r) => s + r[c], 0) / a.length;
say('## 형질 평균 (초기 10% 구간 → 마지막 10% 구간, 개체 간 표준편차 대비 이동)');
for (const name of ['size', 'vmax', 'vis', 'ang', 'd0', 'd1', 'd2', 'dm', 'tOpt', 'res', 'thr', 'give', 'sex', 'mut', 'aq', 'long', 'brain']) {
  const c = col('m_' + name), s = col('s_' + name);
  const a = avg(rows.slice(0, k), c), b = avg(rows.slice(-k), c), sd = avg(rows.slice(-k), s) || 1e-9;
  say(`${name.padEnd(6)} ${a.toFixed(3)} → ${b.toFixed(3)}  (Δ=${(b - a).toFixed(3)}, ${((b - a) / sd).toFixed(2)}σ)`);
}
const totCost = w.cumCosts.reduce((a, b) => a + b, 0) || 1;
say('## 누적 대사 비용 비율: ' + COST_NAMES.map((n, i) => `${n} ${(100 * w.cumCosts[i] / totCost).toFixed(1)}%`).join(', '));
say(`## 요약 maxPop=${maxPop} minPop(>500)=${minPop} final=${w.inds.length} restarts=${w.cnt.restarts} births=${w.cnt.births} (유성 ${w.cnt.sexBirths}) 에너지장부 최대오차=${maxDrift.toExponential(2)}`);
say(`## 사망: 아사 ${w.cnt.starved} 피식 ${w.cnt.eaten} 질병 ${w.cnt.disease} 운석 ${w.cnt.meteor} 노화 ${w.cnt.aged} 극한기온 ${w.cnt.tempDeaths} 서식지부적합 ${w.cnt.habitat}`);
const liveA = w.spA.filter((s) => s.died < 0 && s.count >= 8).length, liveB = w.spB.filter((s) => s.died < 0 && s.count >= 8).length;
say(`## 종(클러스터) ${liveA}, 교배집단 ${liveB}, 누적 클러스터종 ${w.spA.length}`);
say(`## checksum ${w.checksum()}  elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s`);
writeFileSync(`out/${tag}.txt`, lines.join('\n') + '\n');
