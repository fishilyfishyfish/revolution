// 대조 실험: 방향 입력(식물/사체/개체의 방향)을 지운 월드와 그대로인 월드를 같은 상태에서 이어서 돌려 비교한다(읽기 전용 진단).
// 방향 정보가 쓰이고 있다면 지운 쪽의 섭취·출생·개체 수가 나빠진다. 사용: npx tsx scripts/diag_ablate.ts <seed> [T0] [이후틱]
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { serialize, deserialize } from '../src/sim/snapshot';
import { brainForward, NIN, NH, NOUT } from '../src/sim/genome';
const seed = +(process.argv[2] ?? 1), T0 = +(process.argv[3] ?? 20000), after = +(process.argv[4] ?? 4000);
const over = JSON.parse(process.env.CFG ?? '{}');
const base = World.create(defaultConfig({ seed, founders: [{ preset: 'herb', count: 300 }], ...over, features: { ...STAGES[7] } }));
// 오아시스(덩어리 먹이 간이판): OASIS=비율이면 평지 칸 중 그 비율만 햇빛 배율 1/비율, 나머지는 0(초기 환경 조건, 시뮬레이션 난수와 별개의 난수로 고른다)
const OASIS = process.env.OASIS ? +process.env.OASIS : 0;
if (OASIS > 0) {
  let a = (seed * 2654435761) >>> 0; const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let c = 0; c < base.n; c++) if (base.terrain[c] === 0) base.sunMul[c] = r() < OASIS ? 1 / OASIS : 0;
}
for (let t = 0; t < T0; t++) stepSim(base);
const snap = serialize(base);
{ base.buildHash(); const inp = new Float64Array(NIN), hid = new Float64Array(NH), out = new Float64Array(NOUT); let aP = 0, nP = 0;
  for (const ind of base.inds) { base.sense(ind, inp, false); brainForward(ind.genome, inp, hid, out, !!base.cfg.features.neat, ind.lw ?? null, null); if (inp[1] > 0 && Math.abs(inp[0]) > 0.05) { nP++; if (out[0] * inp[0] > 0) aP++; } }
  console.log(`[T0 ${T0}] 개체 ${base.inds.length} 식물쪽회전 ${nP ? (aP / nP).toFixed(2) : '-'}(${nP}) 재시작 ${base.cnt.restarts} 오아시스 ${OASIS || '없음'}`); }
function run(mode: 'control' | 'blind' | 'ideal') {
  const blind = mode === 'blind';
  const w = deserialize(snap);
  if (blind) { const orig = w.sense.bind(w); (w as any).sense = (ind: any, inp: Float64Array, noise: boolean, hashed?: boolean) => { const r = orig(ind, inp, noise, hashed); inp[0] = 0; inp[3] = 0; inp[5] = 0; return r; }; }
  if (mode === 'ideal') w.thinkHook = (_i, inp, out) => { if (inp[1] > 0) out[0] = Math.max(-1, Math.min(1, inp[0] * 2.6)); }; // 식물이 보이면 회전을 식물 쪽으로(완벽한 비례 조향의 이득 상한을 재는 대조)
  const b0 = w.cnt.births, s0 = w.cnt.starved; let pop = 0, res = 0, n = 0, gain = 0; const g0 = w.plantEat.reduce((a, x) => a + x, 0);
  for (let t = 0; t < after; t++) { stepSim(w); pop += w.inds.length; for (const i of w.inds) { res += i.reserve / Math.max(1e-9, i.t.maxReserve * i.f); n++; } }
  gain = w.plantEat.reduce((a, x) => a + x, 0) - g0;
  return { 평균개체: pop / after, 출생: w.cnt.births - b0, 아사: w.cnt.starved - s0, 평균저장비: res / Math.max(1, n), 식물섭취: gain, 최종개체: w.inds.length };
}
const c = run('control'), b = run('blind'), id = run('ideal');
const f = (o: any) => Object.entries(o).map(([k, v]) => `${k} ${(v as number).toFixed(k === '평균저장비' ? 3 : 0)}`).join(' ');
console.log(`s${seed} (T0 ${T0}, 이후 ${after}틱)\n  그대로: ${f(c)}\n  방향 입력 지움: ${f(b)}\n  완벽한 조향(식물이 보이면 회전을 식물 쪽으로 강제): ${f(id)}
  비율(완벽/그대로): 출생 ${(id.출생 / Math.max(1, c.출생)).toFixed(2)} 아사 ${(id.아사 / Math.max(1, c.아사)).toFixed(2)} 식물섭취 ${(id.식물섭취 / Math.max(1, c.식물섭취)).toFixed(2)} 평균저장비 ${(id.평균저장비 / Math.max(1e-9, c.평균저장비)).toFixed(2)}
  비율(지움/그대로): 출생 ${(b.출생 / Math.max(1, c.출생)).toFixed(2)} 아사 ${(b.아사 / Math.max(1, c.아사)).toFixed(2)} 식물섭취 ${(b.식물섭취 / Math.max(1, c.식물섭취)).toFixed(2)} 평균저장비 ${(b.평균저장비 / Math.max(1e-9, c.평균저장비)).toFixed(2)}`);
