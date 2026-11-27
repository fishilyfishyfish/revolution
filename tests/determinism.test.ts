import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/sim/config';
import { World, Intervention } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { deserialize, serialize, snapshotFromJSON, snapshotToJSON } from '../src/sim/snapshot';

const mk = (seed: number) => World.create(defaultConfig({ w: 48, h: 36, seed, initPop: 150 }));
const IVS: Record<number, Intervention> = {
  100: { kind: 'terrain', shape: 'rect', x: 20, y: 0, x2: 26, y2: 36, r: 0, value: 1 },
  200: { kind: 'plague', x: 10, y: 10, r: 8 },
  300: { kind: 'meteor', x: 35, y: 25, r: 6 },
  400: { kind: 'climate', delta: -8, duration: 300 },
  500: { kind: 'food', x: 10, y: 25, r: 6, delta: 1 },
};
function run(w: World, n: number, ivs: Record<number, Intervention> = IVS) {
  for (let i = 0; i < n; i++) { const iv = ivs[w.tick]; if (iv) w.intervene(iv); stepSim(w); }
  return w;
}

describe('재현성', () => {
  it('같은 시드 + 같은 개입 로그 → 같은 결과', () => {
    expect(run(mk(7), 800).checksum()).toBe(run(mk(7), 800).checksum());
  });
  it('다른 시드 또는 다른 개입 → 다른 결과', () => {
    const a = run(mk(7), 600).checksum();
    expect(run(mk(8), 600).checksum()).not.toBe(a);
    expect(run(mk(7), 600, {}).checksum()).not.toBe(a);
  });
  it('기록된 개입 로그를 새 월드에 재생하면 같은 결과', () => {
    const a = run(mk(3), 800);
    const b = mk(3);
    for (const e of a.log) b.schedule(e.tick, e.iv);
    for (let i = 0; i < 800; i++) stepSim(b);
    expect(b.checksum()).toBe(a.checksum());
  });
  it('스냅샷에서 이어 돌려도 원본과 같다 (RNG 상태 포함)', () => {
    const a = run(mk(5), 450);
    const snap = serialize(a);
    run(a, 400);
    const b = deserialize(snap); run(b, 400);
    expect(b.checksum()).toBe(a.checksum());
    expect(b.log.length).toBe(a.log.length);
  });
  it('JSON 저장/불러오기를 거쳐도 같다', () => {
    const a = run(mk(9), 350);
    const b = deserialize(snapshotFromJSON(snapshotToJSON(serialize(a))));
    run(a, 300); run(b, 300);
    expect(b.checksum()).toBe(a.checksum());
  });
  it('분기: 같은 스냅샷에서 개입 없는 쪽/한 쪽이 갈라진다', () => {
    const a = run(mk(2), 300, {});
    const snap = serialize(a);
    const noIv = deserialize(snap), withIv = deserialize(snap);
    withIv.intervene({ kind: 'meteor', x: 24, y: 18, r: 12 });
    run(noIv, 200, {}); run(withIv, 200, {});
    expect(withIv.checksum()).not.toBe(noIv.checksum());
    expect(withIv.cnt.meteor).toBeGreaterThan(0);
  });
});

import { validateSnapshot } from '../src/sim/snapshot';
import { G } from '../src/sim/genome';
describe('저장 파일 호환성 검사', () => {
  const base = () => serialize(mk(11));
  it('새로 저장한 파일은 통과', () => { expect(validateSnapshot(snapshotFromJSON(snapshotToJSON(base())))).toBeNull(); });
  it('게놈 구조가 다른(옛) 파일은 이유와 함께 거부', () => {
    const s: any = base(); delete s.layout; s.indGenome = new Float32Array(s.nInd * (G - 40));
    expect(validateSnapshot(s)).toMatch(/옛 버전/);
    const t: any = base(); t.layout = { ...t.layout, G: G - 1 };
    expect(validateSnapshot(t)).toMatch(/다른 버전/);
  });
  it('시뮬레이터 파일이 아니면 거부', () => { expect(validateSnapshot({ hello: 1 })).toMatch(/저장한 파일이 아니/); expect(validateSnapshot(null)).not.toBeNull(); });
});

describe('저장 뒤에 추가된 설정 항목', () => {
  it('설정에 없는 항목은 기본값으로 채워져 NaN이 퍼지지 않는다', () => {
    const w = mk(13); for (let t = 0; t < 100; t++) stepSim(w);
    const s: any = serialize(w);
    for (const k of ['effPlant', 'endemicRate', 'refuge', 'lifeSizeExp', 'seedK', 'juvenileFrac']) delete s.cfg[k]; // 옛 저장 파일 흉내
    const w2 = deserialize(snapshotFromJSON(snapshotToJSON(s)));
    expect(w2.cfg.effPlant).toBe(defaultConfig().effPlant);
    for (let t = 0; t < 300; t++) stepSim(w2);
    let bad = 0;
    for (let c = 0; c < w2.n; c++) { if (!Number.isFinite(w2.soil[c]) || !Number.isFinite(w2.plants[0][c])) bad++; }
    for (const i of w2.inds) if (!Number.isFinite(i.reserve) || i.t.eff.some((x) => !Number.isFinite(x))) bad++;
    expect(bad).toBe(0);
  });
});

describe('실행 중 뇌 규칙 변경(neat/memory)', () => {
  const live: Record<number, Intervention> = {
    100: { kind: 'global', neat: true, memory: true },
    300: { kind: 'global', memory: false },
    500: { kind: 'global', neat: false },
  };
  it('로그 재생·스냅샷 이어달리기가 같고, 에너지 회계가 맞는다', () => {
    const a = mk(4);
    for (let i = 0; i < 700; i++) {
      const iv = live[a.tick]; if (iv) a.intervene(iv);
      const b0 = a.totalEnergy().total; stepSim(a);
      expect(Math.abs(a.totalEnergy().total - b0 - (a.tickIn - a.tickOut)) / Math.max(1, b0)).toBeLessThan(1e-9);
    }
    expect(a.cfg.features.neat).toBe(false); expect(a.cfg.features.memory).toBe(false);
    const b = mk(4);
    for (const e of a.log) b.schedule(e.tick, e.iv);
    for (let i = 0; i < 700; i++) stepSim(b);
    expect(b.checksum()).toBe(a.checksum());
    const c = mk(4); run(c, 350, live);
    const d = deserialize(serialize(c)); run(c, 350, live); run(d, 350, live);
    expect(d.checksum()).toBe(c.checksum());
  });
  it('켜면 실제로 결과가 달라진다', () => {
    expect(run(mk(4), 400, live).checksum()).not.toBe(run(mk(4), 400, {}).checksum());
  });
});

describe('일시정지 중 개입과 사용자 지정 지도', () => {
  it('applyPending은 틱을 올리지 않고, 같은 개입을 다음 틱에 적용한 것과 결과가 같다', () => {
    const iv: Intervention = { kind: 'terrain', shape: 'rect', x: 10, y: 5, x2: 20, y2: 20, r: 0, value: 1 };
    const a = mk(11); run(a, 50, {});
    const t0 = a.tick; a.intervene(iv); a.applyPending();
    expect(a.tick).toBe(t0); expect(a.log.at(-1)?.tick).toBe(t0); expect(a.terrain[10 * a.w + 12]).toBe(1);
    run(a, 100, {});
    const b = mk(11); run(b, 50, {}); b.intervene(iv); run(b, 100, {}); // 기존 방식: 다음 step() 시작에서 적용
    expect(a.checksum()).toBe(b.checksum());
    const c = mk(11); for (const e of a.log) c.schedule(e.tick, e.iv); for (let i = 0; i < 150; i++) stepSim(c);
    expect(c.checksum()).toBe(a.checksum());
  });
  it('customMap은 지형·바이옴을 그대로 쓰고, 개체는 물/산에 놓이지 않으며, 저장 설정에는 남지 않는다', () => {
    const w0 = 48, h0 = 36, n = w0 * h0;
    const terrain = new Array(n).fill(0), dom = new Array(n).fill(1), zone = new Array(n).fill(2);
    for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) { if (x >= 20 && x < 28) terrain[y * w0 + x] = 1; if (y < 3) terrain[y * w0 + x] = 2; }
    const w = World.create(defaultConfig({ w: w0, h: h0, seed: 3, initPop: 80, customMap: { terrain, dom, zone } }));
    for (let i = 0; i < n; i++) { expect(w.terrain[i]).toBe(terrain[i]); expect(w.dom[i]).toBe(1); expect(w.zone[i]).toBe(2); }
    for (const i of w.inds) expect(w.terrain[(i.y | 0) * w0 + (i.x | 0)]).toBe(0);
    expect(w.cfg.customMap).toBeNull();
    expect(JSON.stringify(snapshotToJSON(serialize(w))).length).toBeLessThan(2_000_000);
    for (let t = 0; t < 200; t++) { const b = w.totalEnergy().total; stepSim(w); expect(Math.abs(w.totalEnergy().total - b - (w.tickIn - w.tickOut)) / Math.max(1, b)).toBeLessThan(1e-9); }
  });
  it('지도를 주지 않으면 기존과 같은 결과이고, 생물 없는 준비 월드도 만들어진다', () => {
    const a = World.create(defaultConfig({ w: 48, h: 36, seed: 4, initPop: 100 }));
    const b = World.create(defaultConfig({ w: 48, h: 36, seed: 4, initPop: 100, customMap: null }));
    expect(a.checksum()).toBe(b.checksum());
    const e = World.create(defaultConfig({ w: 48, h: 36, seed: 4, founders: [] }));
    expect(e.inds.length).toBe(0);
  });
});

describe('수명 내 학습(learnRate)', () => {
  const mkL = (seed: number, learnRate?: number) => World.create(defaultConfig({ w: 48, h: 36, seed, initPop: 120, ...(learnRate === undefined ? {} : { learnRate }) }));
  it('0이면 기존과 같은 결과이고, 켜면 달라진다', () => {
    expect(run(mkL(5), 300, {}).checksum()).toBe(run(mkL(5, 0), 300, {}).checksum());
    expect(run(mkL(5, 0.05), 300, {}).checksum()).not.toBe(run(mkL(5, 0), 300, {}).checksum());
  });
  it('켜도 에너지 회계가 맞고(학습은 에너지를 만들지 않는다), 같은 시드는 같은 결과', () => {
    const a = mkL(6, 0.05);
    for (let i = 0; i < 400; i++) { const b = a.totalEnergy().total; stepSim(a); expect(Math.abs(a.totalEnergy().total - b - (a.tickIn - a.tickOut)) / Math.max(1, b)).toBeLessThan(1e-9); }
    expect(run(mkL(6, 0.05), 400, {}).checksum()).toBe(a.checksum());
  });
  it('가중치 변화는 생기되 한도 안이고, 자식은 0에서 시작한다(물려주지 않는다)', () => {
    const a = run(mkL(7, 0.1), 400, {});
    let moved = 0; for (const i of a.inds) { if (i.lw) { let m = 0; for (const v of i.lw) { expect(Math.abs(v)).toBeLessThanOrEqual(2); m += Math.abs(v); } if (m > 0.01) moved++; } }
    expect(moved).toBeGreaterThan(5);
    const young = a.inds.filter((i) => i.age < 3 && i.lw); for (const i of young) { let m = 0; for (const v of i.lw!) m += Math.abs(v); expect(m).toBeLessThan(1); }
  });
  it('스냅샷에서 이어 돌려도 같다(학습 상태 포함)', () => {
    const a = run(mkL(8, 0.05), 350, {}); const snap = serialize(a); run(a, 300, {});
    const b = deserialize(snap); run(b, 300, {});
    expect(b.checksum()).toBe(a.checksum());
  });
});

describe('수풀(coverFrac)과 갈증(thirstRate)', () => {
  const mkE = (seed: number, over: Record<string, number> = {}) => World.create(defaultConfig({ w: 48, h: 36, seed, initPop: 120, waterLevel: 0.3, ...over }));
  it('끄면 기존과 같은 결과', () => {
    expect(run(mkE(3), 300, {}).checksum()).toBe(run(mkE(3, { coverFrac: 0, thirstRate: 0 }), 300, {}).checksum());
  });
  it('수풀: 평지의 대략 그 비율이 덮이고, 회계·결정론·스냅샷 이어달리기가 맞는다', () => {
    const a = mkE(4, { coverFrac: 0.2 }); let pl = 0, cv = 0; for (let c = 0; c < a.n; c++) if (a.terrain[c] === 0) { pl++; if (a.cover[c]) cv++; }
    expect(cv / pl).toBeGreaterThan(0.12); expect(cv / pl).toBeLessThan(0.28);
    for (let i = 0; i < 300; i++) { const b = a.totalEnergy().total; stepSim(a); expect(Math.abs(a.totalEnergy().total - b - (a.tickIn - a.tickOut)) / Math.max(1, b)).toBeLessThan(1e-9); }
    expect(run(mkE(4, { coverFrac: 0.2 }), 300, {}).checksum()).toBe(a.checksum());
    const c = run(mkE(4, { coverFrac: 0.2 }), 200, {}); const d = deserialize(serialize(c)); run(c, 200, {}); run(d, 200, {}); expect(d.checksum()).toBe(c.checksum());
  });
  it('갈증: 수분이 줄고 물가에서 채워지며, 회계·결정론·스냅샷 이어달리기가 맞는다', () => {
    const a = mkE(5, { thirstRate: 0.004 });
    for (let i = 0; i < 400; i++) { const b = a.totalEnergy().total; stepSim(a); expect(Math.abs(a.totalEnergy().total - b - (a.tickIn - a.tickOut)) / Math.max(1, b)).toBeLessThan(1e-9); }
    const ws = a.inds.map((i) => i.water); expect(Math.min(...ws)).toBeLessThan(0.9); expect(Math.max(...ws)).toBeGreaterThan(0.95);
    expect(run(mkE(5, { thirstRate: 0.004 }), 400, {}).checksum()).toBe(a.checksum());
    const c = run(mkE(5, { thirstRate: 0.004 }), 200, {}); const d = deserialize(serialize(c)); run(c, 200, {}); run(d, 200, {}); expect(d.checksum()).toBe(c.checksum());
  });
});
