import { describe, it, expect } from 'vitest';
import { defaultConfig, STAGES } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
import { serialize, snapshotFromJSON, snapshotToJSON, deserialize } from '../src/sim/snapshot';
import { OLD, OldLayout, prepareSnapshot } from '../src/sim/migrate';
import { BO, B1, B2, G, MO, M_H, M_W2, NH, NIN, NM, NOUT, NT, W1, W2, brainForward } from '../src/sim/genome';
import { Rng } from '../src/sim/rng';

// 옛 구조의 순전파 (입력 nin, 출력 nout)
function oldForward(g: Float32Array, L: OldLayout, inp: number[]): number[] {
  const OB = L.NT, oB1 = L.NIN * NH, oW2 = oB1 + NH, oB2 = oW2 + NH * L.NOUT;
  const hid = new Array(NH).fill(0), out = new Array(L.NOUT).fill(0);
  for (let j = 0; j < NH; j++) { let s = g[OB + oB1 + j]; for (let i = 0; i < L.NIN; i++) s += g[OB + i * NH + j] * inp[i]; hid[j] = Math.tanh(s); }
  for (let k = 0; k < L.NOUT; k++) { let s = g[OB + oB2 + k]; for (let j = 0; j < NH; j++) s += g[OB + oW2 + j * L.NOUT + k] * hid[j]; out[k] = Math.tanh(s); }
  return out;
}
// 현재 구조 게놈에서 옛 구조 게놈을 만든다 (테스트용 역변환)
function downMap(cur: Float32Array, L: OldLayout): Float32Array {
  const nb = L.NIN * NH + NH + NH * L.NOUT + L.NOUT, nm = L.masks ? L.NIN * NH + NH * L.NOUT + NH : 0;
  const o = new Float32Array(L.NT + nb + nm);
  for (let i = 0; i < L.NT; i++) o[i] = cur[i];
  const OB = L.NT, oB1 = L.NIN * NH, oW2 = oB1 + NH, oB2 = oW2 + NH * L.NOUT;
  for (let i = 0; i < L.NIN; i++) for (let j = 0; j < NH; j++) o[OB + i * NH + j] = cur[BO + W1 + i * NH + j];
  for (let j = 0; j < NH; j++) o[OB + oB1 + j] = cur[BO + B1 + j];
  for (let j = 0; j < NH; j++) for (let k = 0; k < L.NOUT; k++) o[OB + oW2 + j * L.NOUT + k] = cur[BO + W2 + j * NOUT + k];
  for (let k = 0; k < L.NOUT; k++) o[OB + oB2 + k] = cur[BO + B2 + k];
  if (L.masks) { const oM = OB + nb;
    for (let i = 0; i < L.NIN * NH; i++) o[oM + i] = 1;
    for (let i = 0; i < NH * L.NOUT; i++) o[oM + L.NIN * NH + i] = 1;
    for (let j = 0; j < NH; j++) o[oM + L.NIN * NH + NH * L.NOUT + j] = 1; }
  return o;
}

describe('옛 저장 파일 변환', () => {
  it('지원하는 옛 구조 목록의 게놈 길이는 현재와 모두 다르다', () => {
    for (const L of OLD) expect(L.G).not.toBe(G);
    expect(OLD.map((l) => l.G)).toEqual([189, 190, 191, 243, 251, 467, 468, 500, 628]);
  });

  for (const L of OLD) {
    it(`[${L.note}] 변환된 뇌가 옛 뇌와 같은 출력을 낸다 (새 입력은 0)`, () => {
      const rng = new Rng(L.G);
      const base = World.create(defaultConfig({ w: 24, h: 24, seed: 1, initPop: 30, features: STAGES[7] }));
      const old = downMap(base.inds[0].genome, L);
      for (let i = L.NT; i < L.NT + L.NIN * NH + NH + NH * L.NOUT + L.NOUT; i++) old[i] = rng.gauss(); // 뇌 가중치를 무작위로
      const snap: any = serialize(base);
      // 한 마리짜리 옛 파일을 만든다
      snap.nInd = 1; snap.indGenome = old; snap.indNum = snap.indNum.slice(0, 14); delete snap.layout;
      snap.lineage = serialize(base).lineage;
      const prep = prepareSnapshot(snap);
      expect(prep.error).toBeNull();
      const g = prep.snap!.indGenome.slice(0, G);
      const inp = Array.from({ length: L.NIN }, () => rng.range(-1, 1));
      const exp = oldForward(old, L, inp);
      const hid = new Float64Array(NH), out = new Float64Array(NOUT);
      brainForward(g, [...inp, ...new Array(NIN - L.NIN).fill(0)], hid, out, false);
      for (let k = 0; k < L.NOUT; k++) expect(out[k]).toBeCloseTo(exp[k], 5);
    });

    it(`[${L.note}] 전체 파일을 변환해 불러오면 계속 돌아가고 장부가 맞는다`, () => {
      const w = World.create(defaultConfig({ w: 40, h: 30, seed: 5, initPop: 120, features: STAGES[7] }));
      for (let t = 0; t < 300; t++) stepSim(w);
      const s: any = serialize(w);
      const nf = L.G === 189 ? 12 : 13; // 옛 개체 숫자 필드 수
      const n = s.nInd; const gen = new Float32Array(n * L.G); const num = new Float64Array(n * nf);
      for (let k = 0; k < n; k++) { gen.set(downMap(s.indGenome.subarray(k * G, (k + 1) * G), L), k * L.G); for (let f = 0; f < nf; f++) num[k * nf + f] = s.indNum[k * 14 + f]; }
      s.indGenome = gen; s.indNum = num; delete s.layout; delete s.env.strain;
      s.spA = s.spA.map((r: any) => ({ ...r, centroid: r.centroid ? downMap(r.centroid, L) : null }));
      s.history = { cols: ['tick', 'pop'], rows: s.history.rows.map((r: number[]) => [r[0], r[1]]) };
      const roundTrip = snapshotFromJSON(snapshotToJSON(s)); // 실제 파일처럼 JSON을 거친다
      const prep = prepareSnapshot(roundTrip);
      expect(prep.error).toBeNull(); expect(prep.note).toMatch(/옛 버전/);
      const w2 = deserialize(prep.snap!);
      expect(w2.inds.length).toBe(n);
      for (let t = 0; t < 150; t++) {
        const b = w2.totalEnergy().total; stepSim(w2); const a = w2.totalEnergy().total;
        expect(Number.isFinite(a)).toBe(true);
        expect(Math.abs(a - b - (w2.tickIn - w2.tickOut)) / Math.max(1, a)).toBeLessThan(1e-9);
      }
      for (const i of w2.inds) for (let k = 0; k < G; k++) expect(Number.isFinite(i.genome[k])).toBe(true);
    });
  }

  it('알 수 없는 구조나 현재 파일은 그대로 처리한다', () => {
    const w = World.create(defaultConfig({ w: 24, h: 24, seed: 2, initPop: 20, features: STAGES[7] }));
    const cur = prepareSnapshot(serialize(w)); expect(cur.error).toBeNull(); expect(cur.note).toBe('');
    const bad: any = serialize(w); delete bad.layout; bad.indGenome = new Float32Array(bad.nInd * 333);
    expect(prepareSnapshot(bad).error).toMatch(/변환할 수 없어요/);
  });
});
