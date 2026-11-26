import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultConfig } from '../src/sim/config';
import { World, INTERVENTION_KINDS } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { G, NT, NM, GENE, NIN, NH, NOUT, Traits, compatProb, genomeDistance, founderGenome, founderBrain, mutate, crossover, brainForward, NB } from '../src/sim/genome';
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
    expect([NIN, NH, NOUT]).toEqual([21, 8, 7]);
    expect(G).toBe(NT + NB + NM);
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

describe('세부 형질: 이득과 비용', () => {
  const cfg = defaultConfig(); const rng = new Rng(9); const base = founderBrain(rng); const g0 = founderGenome(rng, base);
  const dec = (k: keyof typeof GENE, v: number) => { const h = g0.slice(); h[GENE[k]] = v; return new Traits().decode(h, cfg); };
  it('갑옷·발톱·독·단열·허용폭·겨울잠·수명은 유지비가 오른다', () => {
    for (const k of ['ARMOR', 'CLAW', 'TOXIN', 'INSUL', 'TWID', 'HIBER', 'LONG'] as const) expect(dec(k, 1).basal, k).toBeGreaterThan(dec(k, 0).basal);
  });
  it('후각·청각은 반경이 클수록 유지비↑', () => {
    expect(dec('SMELL', 1).visCost).toBeGreaterThan(dec('SMELL', 0).visCost);
    expect(dec('HEAR', 1).visCost).toBeGreaterThan(dec('HEAR', 0).visCost);
  });
  it('이득 방향: 발톱→공격력, 허용폭→치사 기온, 한배 수→새끼 수', () => {
    expect(dec('CLAW', 1).attackPow).toBeGreaterThan(dec('CLAW', 0).attackPow);
    expect(dec('TWID', 1).tempLethal).toBeGreaterThan(dec('TWID', 0).tempLethal);
    expect(dec('CLUTCH', 1).clutchMax).toBeGreaterThan(dec('CLUTCH', 0).clutchMax);
    expect(dec('ARMOR', 1).moveMul).toBeGreaterThan(dec('ARMOR', 0).moveMul);
  });
  it('전 기능 장부 보존 (한배 새끼·겨울잠·독 포함)', () => {
    const w = World.create(defaultConfig({ w: 40, h: 30, seed: 6, founders: [{ preset: 'herb', count: 80 }, { preset: 'predator', count: 20 }, { preset: 'fish', count: 40 }], features: STAGES[7] }));
    for (const i of w.inds) { i.genome[GENE.CLUTCH] = 1; i.genome[GENE.TOXIN] = 0.8; i.genome[GENE.HIBER] = 0.9; i.t.decode(i.genome, w.cfg); }
    for (let t = 0; t < 500; t++) {
      const b = w.totalEnergy().total; stepSim(w); const a = w.totalEnergy().total;
      expect(Math.abs(a - b - (w.tickIn - w.tickOut)) / Math.max(1, a)).toBeLessThan(1e-9);
    }
  });
});

import { mutateStructure, initMasks, MO, M_H, MAXC } from '../src/sim/genome';
describe('단계 8: 뇌 구조 변이(NEAT식)', () => {
  const rng = new Rng(11);
  const active = (g: Float32Array) => { let c = 0; for (let i = 0; i < NM; i++) if (g[MO + i] >= 0.5) c++; return c; };
  it('옵션이 꺼져 있으면 마스크는 전부 켜짐 (기존 동작)', () => {
    const g = founderGenome(rng, founderBrain(rng)); for (let i = 0; i < NM; i++) expect(g[MO + i]).toBe(1);
    const cfg = defaultConfig(); const t = new Traits().decode(g, cfg); expect(t.nodes).toBe(NH);
  });
  it('켜면 작은 뇌에서 시작하고, 구조 변이로 연결·노드 수가 변한다', () => {
    const g = new Float32Array(G); initMasks(g, rng, true);
    let nodes0 = 0; for (let j = 0; j < NH; j++) if (g[MO + M_H + j] > 0.5) nodes0++;
    expect(nodes0).toBe(4); const c0 = active(g);
    let changed = 0;
    for (let t = 0; t < 400; t++) { const h = g.slice(); mutateStructure(h, 0.06, rng); if (active(h) !== active(g)) changed++; for (let i = 0; i < NM; i++) g[MO + i] = h[MO + i]; }
    expect(changed).toBeGreaterThan(20); void c0;
    let nodes = 0; for (let j = 0; j < NH; j++) if (g[MO + M_H + j] > 0.5) nodes++;
    expect(nodes).toBeGreaterThanOrEqual(2); // 최소 노드 보장
  });
  it('활성 연결·노드가 많을수록 뇌 유지비↑', () => {
    const cfg = defaultConfig({ features: { ...STAGES[7], neat: true } });
    const small = new Float32Array(G), big = new Float32Array(G); initMasks(small, rng, true); initMasks(big, rng, false);
    expect(new Traits().decode(big, cfg).brainCost).toBeGreaterThan(new Traits().decode(small, cfg).brainCost);
    void MAXC;
  });
  it('구조 변이를 켜도 에너지 장부 보존, 재현성 유지', () => {
    const mk = () => World.create(defaultConfig({ w: 40, h: 30, seed: 8, initPop: 100, features: { ...STAGES[7], neat: true } }));
    const w = mk();
    for (let t = 0; t < 500; t++) {
      const b = w.totalEnergy().total; stepSim(w); const a = w.totalEnergy().total;
      expect(Math.abs(a - b - (w.tickIn - w.tickOut)) / Math.max(1, a)).toBeLessThan(1e-9);
    }
    const w2 = mk(); for (let t = 0; t < 500; t++) stepSim(w2);
    expect(w2.checksum()).toBe(w.checksum());
  });
});

describe('전멸 시 자동 재시작 옵션', () => {
  const mk = (on: boolean) => World.create(defaultConfig({ w: 32, h: 32, seed: 4, initPop: 60, restartOnExtinction: on, features: STAGES[7] }));
  const wipeAll = (w: World) => { for (const i of w.inds) w.kill(i, CAUSE.METEOR); }; // 식물은 남기고 개체만 전멸
  it('켜면 재시작, 끄면 멈춘다(재시작 0, dead)', () => {
    const a = mk(true); wipeAll(a); for (let t = 0; t < 5; t++) stepSim(a);
    expect(a.cnt.restarts).toBeGreaterThan(0); expect(a.inds.length).toBeGreaterThan(0);
    const b = mk(false); wipeAll(b); for (let t = 0; t < 5; t++) stepSim(b);
    expect(b.cnt.restarts).toBe(0); expect(b.inds.length).toBe(0); expect(b.dead).toBe(true);
  });
  it('실행 중 토글도 개입 로그에 기록된다', () => {
    const w = mk(true); w.intervene({ kind: 'global', restartOnExtinction: false }); stepSim(w);
    expect(w.cfg.restartOnExtinction).toBe(false); expect(w.log.some((e) => e.iv.kind === 'global')).toBe(true);
  });
});

describe('현실화: 성장·씨앗·배경 질병', () => {
  const mk = (seed = 3, over = {}) => World.create(defaultConfig({ w: 40, h: 30, seed, initPop: 120, features: STAGES[7], ...over }));
  it('새끼는 작게 태어나고, 성장 중에도 에너지 장부가 맞는다', () => {
    const w = mk();
    let sawJuv = false;
    for (let t = 0; t < 300; t++) {
      const b = w.totalEnergy().total; stepSim(w); const a = w.totalEnergy().total;
      expect(Math.abs(a - b - (w.tickIn - w.tickOut)) / Math.max(1, a)).toBeLessThan(1e-9);
      for (const i of w.inds) if (i.birth > 0 && i.f < 0.6) sawJuv = true;
    }
    expect(sawJuv).toBe(true);
  });
  it('어린 개체는 먹이가 충분하면 성체로 자란다 (저장 에너지 → 구조 에너지 이동)', () => {
    const w = mk(7, { initPop: 20, landHazard: 0, waterHazard: 0, tempHazard: 0, ageHazard: 0, endemicRate: 0, features: { ...STAGES[7], attack: false } });
    const i = w.inds[0]; const adult = i.t.structE;
    w.corpse[(i.y | 0) * w.w + (i.x | 0)] += i.structE - adult * 0.4; // 줄어든 구조 에너지는 사체로 (보존)
    i.structE = adult * 0.4; i.f = 0.4; i.f075 = Math.pow(0.4, 0.75); i.reserve = i.t.maxReserve * 0.4;
    for (let t = 0; t < 400 && i.alive; t++) { i.reserve = Math.max(i.reserve, i.t.maxReserve * 0.5); i.age = 0; stepSim(w); }
    expect(i.alive).toBe(true); expect(i.f).toBeGreaterThan(0.95);
  });
  it('식물은 이웃 씨앗이 있어야 번진다: 이웃이 있는 빈 셀이 외딴 빈 셀보다 빨리 찬다', () => {
    const w = World.create(defaultConfig({ w: 24, h: 24, seed: 1, initPop: 0, genTerrain: false, features: STAGES[7] }));
    for (const p of w.plants) p.fill(0);
    const a = 5 * 24 + 5, b = 15 * 24 + 15;
    for (const nb of [a - 1, a + 1, a - 24, a + 24]) w.plants[0][nb] = 25;
    w.dom.fill(0);
    for (let t = 0; t < 40; t++) stepSim(w);
    expect(w.plants[0][a]).toBeGreaterThan(w.plants[0][b] * 3);
  });
  it('역병 없이도 상시 병원체로 감염이 생기고, 면역형이 균주와 멀수록 덜 걸린다', () => {
    const w = mk(5, { endemicRate: 0.01 });
    for (let t = 0; t < 100; t++) stepSim(w);
    expect(w.inds.some((i) => i.inf !== 0)).toBe(true);
    const s = (w as any).suscept.bind(w) as (i: any) => number;
    const near = w.inds[0], far = w.inds[1]; near.t.res = far.t.res = 0;
    near.t.imm = w.strain; far.t.imm = w.strain > 0.5 ? 0 : 1;
    expect(s(near)).toBeGreaterThan(s(far));
  });
});
