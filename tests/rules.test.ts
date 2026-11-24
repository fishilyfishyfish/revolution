import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultConfig } from '../src/sim/config';
import { World, INTERVENTION_KINDS } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { G, NT, GENE, NIN, NH, NOUT, Traits, compatProb, genomeDistance, founderGenome, founderBrain, mutate, crossover, brainForward, NB } from '../src/sim/genome';
import { Rng } from '../src/sim/rng';

describe('원칙 점검', () => {
  it('개입 종류는 환경에 대한 것뿐 (개체 편집/소환/제거 없음)', () => {
    expect([...INTERVENTION_KINDS].sort()).toEqual(['biome', 'climate', 'food', 'global', 'meteor', 'plague', 'terrain']);
    const proto = Object.getOwnPropertyNames(World.prototype).join(' ');
    for (const bad of ['spawnIndividual', 'editGenome', 'setGenome', 'moveInd', 'cloneInd', 'removeInd', 'summon']) expect(proto.toLowerCase()).not.toContain(bad.toLowerCase());
    const proto_msg = readFileSync('src/worker/protocol.ts', 'utf8');
    expect(proto_msg).not.toMatch(/spawn|summon|cloneInd|editGenome|removeInd/i);
  });
  it('사체는 같은 셀 토양으로 분해되고 총량은 보존된다', () => {
    const w = World.create(defaultConfig({ w: 24, h: 24, seed: 1, initPop: 0 }));
    w.terrain[5 * 24 + 5] = 2; // 산: 식물 성장이 없는 셀
    w.corpse[5 * 24 + 5] = 100; const s0 = w.soil[5 * 24 + 5];
    stepSim(w);
    const d = 100 * w.cfg.corpseDecay;
    expect(w.corpse[5 * 24 + 5]).toBeCloseTo(100 - d, 9);
    expect(w.soil[5 * 24 + 5]).toBeCloseTo(s0 + d, 9);
  });
  it('운석: 죽은 개체의 에너지는 전부 사체로 남는다', () => {
    const w = World.create(defaultConfig({ w: 40, h: 40, seed: 4, initPop: 100 }));
    for (let i = 0; i < 50; i++) stepSim(w);
    const before = w.totalEnergy();
    let victimsE = 0; for (const i of w.inds) victimsE += i.reserve + i.structE;
    w.intervene({ kind: 'meteor', shape: 'rect', x: 0, y: 0, x2: 40, y2: 40, r: 0 });
    // 개입 적용 직후(틱 진행 없이) 장부 확인을 위해 한 틱 진행
    stepSim(w);
    expect(w.cnt.meteor).toBeGreaterThan(10);
    expect(w.totalEnergy().corpse).toBeGreaterThan(before.corpse + victimsE * 0.5); // 일부는 같은 틱에 분해
  });
});

describe('유전/뇌', () => {
  const rng = new Rng(1);
  const base = founderBrain(rng);
  it('식성 벡터는 합이 고정 → 하나를 올리면 다른 게 내려간다', () => {
    const cfg = defaultConfig();
    const g = founderGenome(rng, base);
    const t0 = new Traits().decode(g, cfg);
    expect(t0.diet.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    g[GENE.D0] = 1; const t1 = new Traits().decode(g, cfg);
    expect(t1.diet[0]).toBeGreaterThan(t0.diet[0]); expect(t1.diet[1]).toBeLessThan(t0.diet[1]);
    expect(t1.diet.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
  it('모든 형질은 이득과 함께 비용: 크기·시야·저항은 유지비↑', () => {
    const cfg = defaultConfig(); const g = founderGenome(rng, base);
    const t = (k: number, v: number) => { const h = g.slice(); h[k] = v; return new Traits().decode(h, cfg); };
    expect(t(GENE.SIZE, 1).basal).toBeGreaterThan(t(GENE.SIZE, 0).basal);
    expect(t(GENE.SIZE, 1).maxReserve).toBeGreaterThan(t(GENE.SIZE, 0).maxReserve);
    expect(t(GENE.SIZE, 1).turnMax).toBeLessThan(t(GENE.SIZE, 0).turnMax);
    expect(t(GENE.VIS, 1).visCost).toBeGreaterThan(t(GENE.VIS, 0).visCost);
    expect(t(GENE.RES, 1).basal).toBeGreaterThan(t(GENE.RES, 0).basal);
    expect(t(GENE.MUT, 0).basal).toBeGreaterThan(t(GENE.MUT, 1).basal); // 낮은 돌연변이율 = 교정 비용
  });
  it('호환성: 거리↑ → 성공률↓, 임계치 넘으면 0', () => {
    expect(compatProb(0, 0.5)).toBe(1);
    expect(compatProb(0.1, 0.5)).toBeGreaterThan(compatProb(0.3, 0.5));
    expect(compatProb(0.5, 0.5)).toBe(0); expect(compatProb(0.9, 0.5)).toBe(0);
  });
  it('돌연변이/교차/거리', () => {
    const a = founderGenome(rng, base), b = founderGenome(rng, base), c = new Float32Array(G);
    expect(genomeDistance(a, a)).toBe(0);
    crossover(c, a, b, rng);
    for (let i = 0; i < G; i++) expect([a[i], b[i]]).toContain(c[i]);
    const d = a.slice(); mutate(d, 0.1, rng);
    expect(genomeDistance(a, d)).toBeGreaterThan(0);
  });
  it('뇌: 고정 구조 입력 15/은닉 8/출력 5, 가중치는 게놈 안에', () => {
    expect([NIN, NH, NOUT]).toEqual([15, 8, 5]);
    expect(G).toBe(NT + NB);
    const g = founderGenome(rng, base), hid = new Float64Array(NH), out = new Float64Array(NOUT);
    brainForward(g, new Float64Array(NIN), hid, out);
    for (const v of out) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });
});

import { PRESETS, presetGenome } from '../src/sim/genome';
import { STAGES } from '../src/sim/config';
import { T_PLAIN } from '../src/sim/world';

describe('시작 생물종 프리셋 / 수중 생태계', () => {
  it('수생 적응: 물에서는 이득, 육지에서는 손해 (이득과 비용 동시)', () => {
    const cfg = defaultConfig(); const rng = new Rng(3); const base = founderBrain(rng);
    const land = presetGenome('herb', rng, base), fish = presetGenome('fish', rng, base);
    const L = new Traits().decode(land, cfg), F = new Traits().decode(fish, cfg);
    expect(F.spWater).toBeGreaterThan(L.spWater); expect(F.cWater).toBeLessThan(L.cWater);
    expect(F.spLand).toBeLessThan(L.spLand); expect(F.cLand).toBeGreaterThan(L.cLand);
  });
  it('물고기는 물에서 시작하고 수초를 먹으며, 에너지는 보존된다', () => {
    const w = World.create(defaultConfig({ w: 48, h: 36, seed: 2, waterLevel: 0.5, founders: [{ preset: 'fish', count: 80 }, { preset: 'herb', count: 40 }], features: STAGES[7] }));
    const inWater = w.inds.filter((i) => w.terrain[(i.y | 0) * w.w + (i.x | 0)] === 1).length;
    expect(inWater).toBeGreaterThanOrEqual(80);
    for (let t = 0; t < 400; t++) {
      const b = w.totalEnergy().total; stepSim(w); const a = w.totalEnergy().total;
      expect(Math.abs(a - b - (w.tickIn - w.tickOut)) / Math.max(1, a)).toBeLessThan(1e-9);
    }
    let waterPlants = 0; for (let c = 0; c < w.n; c++) if (w.terrain[c] === 1) waterPlants += w.plants[2][c];
    expect(waterPlants).toBeGreaterThan(0);
  });
  it('프리셋 목록', () => { expect(PRESETS.map((p) => p.name)).toEqual(['herb', 'omni', 'predator', 'fish', 'fishpred']); void T_PLAIN; });
});

import { CAUSE } from '../src/sim/lineage';
describe('에너지 외 사망 요인', () => {
  const mk = () => World.create(defaultConfig({ w: 32, h: 32, seed: 5, initPop: 0, genTerrain: false, features: STAGES[7] }));
  it('노화: 수명을 한참 넘기면 사망하고 몸은 사체로 남는다', () => {
    const w = mk(); w.seedIndividuals(20, true);
    for (const i of w.inds) { i.age = i.t.lifespan * 3; i.reserve = i.t.maxReserve; }
    const before = w.totalEnergy().total;
    for (let t = 0; t < 30; t++) stepSim(w);
    expect(w.cnt.aged).toBeGreaterThan(5);
    expect(w.totalEnergy().total).toBeGreaterThan(before * 0.9); // 대사 열손실 외에 사라진 에너지 없음
  });
  it('서식지: 물고기가 뭍에서 죽는다 / 장부 보존', () => {
    const w = mk(); w.seedIndividuals(30, true, 'fish');
    for (const i of w.inds) i.reserve = i.t.maxReserve; // 전부 평지 위
    for (let t = 0; t < 400; t++) {
      const b = w.totalEnergy().total; stepSim(w); const a = w.totalEnergy().total;
      expect(Math.abs(a - b - (w.tickIn - w.tickOut)) / Math.max(1, a)).toBeLessThan(1e-9);
    }
    expect(w.cnt.habitat).toBeGreaterThan(0); void CAUSE;
  });
  it('새끼는 부모와 같은 지형에 태어난다', () => {
    const w = World.create(defaultConfig({ w: 48, h: 36, seed: 2, waterLevel: 0.5, founders: [{ preset: 'fish', count: 100 }], features: STAGES[7] }));
    for (let t = 0; t < 300; t++) stepSim(w);
    const kids = w.inds.filter((i) => i.age < 3 && i.birth === w.tick - 1);
    for (const k of kids) expect(w.terrain[(k.y | 0) * w.w + (k.x | 0)]).toBe(1);
  });
});
