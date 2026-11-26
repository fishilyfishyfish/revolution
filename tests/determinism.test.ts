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
