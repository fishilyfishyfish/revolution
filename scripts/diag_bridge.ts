// 다리 조건: 살아남을 수 있는 환경에서 방향 능력이 이득인 환경으로 이어 주면 조향이 진화하는가(환경만 바꾸는 진단, 규칙은 그대로).
// grad: 평지 전체가 처음엔 보통(햇빛 배율 1)이고 RAMP틱에 걸쳐 오아시스(비율 P만 1/P, 나머지 0)로 바뀐다.
// half: 지도 왼쪽 절반은 보통, 오른쪽 절반만 오아시스.
// 사용: npx tsx scripts/diag_bridge.ts <grad|half> <seed> [ticks] [every] [P] [RAMP]
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { serialize, deserialize } from '../src/sim/snapshot';
import { brainForward, NIN, NH, NOUT } from '../src/sim/genome';
const mode = process.argv[2] ?? 'grad', seed = +(process.argv[3] ?? 1), ticks = +(process.argv[4] ?? 60000), every = +(process.argv[5] ?? 10000);
const P = +(process.argv[6] ?? 0.25), RAMP = +(process.argv[7] ?? 40000);
const w = World.create(defaultConfig({ seed, founders: [{ preset: 'herb', count: 300 }], ...JSON.parse(process.env.CFG ?? '{}'), features: { ...STAGES[7] } }));
let a = (seed * 2654435761) >>> 0; const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const mask = new Uint8Array(w.n); for (let c = 0; c < w.n; c++) mask[c] = r() < P ? 1 : 0;
const right = (c: number) => c % w.w >= w.w / 2;
function setEnv(t: number) {
  const al = mode === 'grad' ? Math.min(1, t / RAMP) : 1;
  for (let c = 0; c < w.n; c++) {
    if (w.terrain[c] !== 0) continue;
    if (mode === 'half' && !right(c)) { w.sunMul[c] = 1; continue; }
    w.sunMul[c] = (1 - al) + al * (mask[c] ? 1 / P : 0);
  }
}
function probe(world: World) {
  world.buildHash(); const inp = new Float64Array(NIN), hid = new Float64Array(NH), out = new Float64Array(NOUT);
  const s = { L: [0, 0, 0], R: [0, 0, 0] } as Record<string, number[]>; // [식물쪽 일치, 식물 보임, 개체 수]
  for (const ind of world.inds) {
    const side = mode === 'half' && right(((ind.y | 0) * world.w) + (ind.x | 0)) ? 'R' : 'L'; s[side][2]++;
    world.sense(ind, inp, false); brainForward(ind.genome, inp, hid, out, !!world.cfg.features.neat, ind.lw ?? null, null);
    if (inp[1] > 0 && Math.abs(inp[0]) > 0.05) { s[side][1]++; if (out[0] * inp[0] > 0) s[side][0]++; }
  }
  const f = (v: number[]) => `${v[1] ? (v[0] / v[1]).toFixed(2) : '-'}(${v[1]}) 개체${v[2]}`;
  let dm = 0, carn = 0, omn = 0; for (const i of world.inds) { dm += i.t.diet[3]; if (i.t.diet[3] > 0.5) carn++; else if (i.t.diet[3] > 0.2) omn++; }
  const diet = ` 고기식성${(dm / Math.max(1, world.inds.length)).toFixed(2)} 잡식${omn} 육식${carn} 피식${world.cnt.eaten}`;
  return (mode === 'half' ? `왼쪽(보통) ${f(s.L)} / 오른쪽(오아시스) ${f(s.R)}` : `식물쪽 ${f(s.L)}`) + diet;
}
let line = `${mode} s${seed} P${P}${mode === 'grad' ? ` RAMP${RAMP}` : ''}:`;
for (let t = 1; t <= ticks; t++) {
  if (mode === 'grad' ? t <= RAMP + 1 && (t % 50 === 1) : t === 1) setEnv(t); // 점진 변화는 50틱마다 갱신
  stepSim(w);
  if (t % every === 0) line += `\n  [t${t / 1000}k 재시작${w.cnt.restarts} ${probe(w)}]`;
}
// 마지막: 완벽한 조향 대조(식물 섭취 비율)
const snap = serialize(w);
function run(ideal: boolean) { const x = deserialize(snap); if (ideal) x.thinkHook = (_i, inp, out) => { if (inp[1] > 0) out[0] = Math.max(-1, Math.min(1, inp[0] * 2.6)); }; const g0 = x.plantEat.reduce((p, q) => p + q, 0); for (let t = 0; t < 3000; t++) stepSim(x); return { eat: x.plantEat.reduce((p, q) => p + q, 0) - g0, pop: x.inds.length }; }
const c = run(false), id = run(true);
line += `\n  [마지막 대조 3000틱] 그대로 섭취 ${c.eat.toFixed(0)} 개체 ${c.pop} / 완벽한 조향 섭취 ${id.eat.toFixed(0)} 개체 ${id.pop} / 비율 ${(id.eat / Math.max(1, c.eat)).toFixed(2)}`;
console.log(line);
