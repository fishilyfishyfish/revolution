import { describe, it, expect } from 'vitest';
import { STAGES, defaultConfig } from '../src/sim/config';
import { World, Intervention } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';

// 매 틱 "유입 − 유출 = 총량 변화" 검사
function audit(w: World, ticks: number, ivAt: Record<number, Intervention[]> = {}) {
  let worst = 0;
  for (let t = 0; t < ticks; t++) {
    for (const iv of ivAt[w.tick] ?? []) w.intervene(iv);
    const before = w.totalEnergy().total;
    stepSim(w);
    const after = w.totalEnergy().total;
    const lhs = after - before, rhs = w.tickIn - w.tickOut;
    const err = Math.abs(lhs - rhs) / Math.max(1, after);
    if (err > worst) worst = err;
    expect(err, `tick ${w.tick}: Δ=${lhs} in-out=${rhs}`).toBeLessThan(1e-9);
  }
  return worst;
}
const small = (stage: number, seed = 1) =>
  World.create(defaultConfig({ w: 48, h: 36, seed, initPop: stage === 1 ? 0 : 120, features: STAGES[stage] }));

describe('에너지 회계 불변식', () => {
  for (const stage of [1, 2, 3, 4, 5, 6]) {
    it(`단계 ${stage}: 매 틱 유입−유출=총량변화`, () => { audit(small(stage, stage), 600); });
  }
  it('전 기능 + 모든 개입에서도 보존', () => {
    const w = small(7, 3);
    const ivs: Record<number, Intervention[]> = {
      50: [{ kind: 'terrain', shape: 'rect', x: 20, y: 0, x2: 26, y2: 36, r: 0, value: 1 }],
      100: [{ kind: 'meteor', x: 10, y: 10, r: 8 }],
      150: [{ kind: 'plague', x: 30, y: 20, r: 10 }],
      200: [{ kind: 'food', x: 24, y: 18, r: 10, delta: 1 }, { kind: 'biome', x: 12, y: 18, r: 6, plant: 2, zone: 0 }],
      250: [{ kind: 'global', sun: 1.5, meanTemp: 10, seasonAmp: 12, seasonPeriod: 300 }, { kind: 'climate', delta: -10, duration: 200 }],
      300: [{ kind: 'terrain', shape: 'rect', x: 20, y: 0, x2: 26, y2: 36, r: 0, value: 0 }, { kind: 'terrain', x: 40, y: 30, r: 4, value: 2 }],
    };
    audit(w, 900, ivs);
  });
  it('전멸 후 재시작에서도 보존 (식물에서 이전)', () => {
    const w = small(7, 5);
    const ivs: Record<number, Intervention[]> = { 30: [{ kind: 'meteor', shape: 'rect', x: 0, y: 0, x2: 48, y2: 36, r: 0 }] };
    audit(w, 200, ivs);
    expect(w.cnt.restarts).toBeGreaterThan(0);
  });
  it('개체 에너지·사체·토양은 음수가 되지 않는다', () => {
    const w = small(7, 2);
    for (let t = 0; t < 800; t++) {
      stepSim(w);
      for (const i of w.inds) expect(i.reserve).toBeGreaterThan(0);
    }
    for (let c = 0; c < w.n; c++) {
      expect(w.soil[c]).toBeGreaterThanOrEqual(0); expect(w.corpse[c]).toBeGreaterThanOrEqual(-1e-12);
      for (const p of w.plants) expect(p[c]).toBeGreaterThanOrEqual(-1e-12);
    }
  });
});
