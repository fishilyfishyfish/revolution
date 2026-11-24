import { Config } from './config';
import { G, Traits } from './genome';
import { Lineage } from './lineage';
import { Ind, World, SpeciesRec } from './world';

// 구조화 복제 가능한 스냅샷 (타입드 배열 포함). 파일 저장 시 JSON 변환 함수 사용.
export interface Snapshot {
  version: 1;
  cfg: Config; tick: number; rng: number[];
  terrain: Uint8Array; dom: Uint8Array; zone: Uint8Array; sunMul: Float32Array; devast: Uint16Array; pathogen: Float32Array;
  plants: Float64Array[]; soil: Float64Array; corpse: Float64Array;
  indNum: Float64Array; indGenome: Float32Array; nInd: number;
  lineage: ReturnType<Lineage['pack']>;
  env: { sunG: number; meanTempG: number; seasonAmpG: number; seasonPeriodG: number; climShift: number; climTarget: number; climRate: number };
  ledger: { cumIn: number; cumOut: number; cumCosts: number[]; cnt: World['cnt'] };
  spA: any[]; nextSpA: number; spB: any[]; nextSpB: number;
  log: World['log']; pending: World['pending']; events: World['events'];
  history: World['history']; spHist: World['spHist']; hists: World['hists']; dead: boolean;
}

const NF = 13;
export function serialize(w: World): Snapshot {
  const n = w.inds.length;
  const num = new Float64Array(n * NF), gen = new Float32Array(n * G);
  w.inds.forEach((i, k) => {
    const o = k * NF;
    num[o] = i.id; num[o + 1] = i.x; num[o + 2] = i.y; num[o + 3] = i.a; num[o + 4] = i.v; num[o + 5] = i.reserve;
    num[o + 6] = i.structE; num[o + 7] = i.age; num[o + 8] = i.species; num[o + 9] = i.speciesB; num[o + 10] = i.inf; num[o + 11] = i.birth; num[o + 12] = i.rec;
    gen.set(i.genome, k * G);
  });
  const packSp = (a: SpeciesRec[]) => a.map((s) => ({ ...s, centroid: s.centroid ? s.centroid.slice() : null }));
  return {
    version: 1, cfg: structuredClone(w.cfg), tick: w.tick, rng: w.rng.getState(),
    terrain: w.terrain.slice(), dom: w.dom.slice(), zone: w.zone.slice(), sunMul: w.sunMul.slice(),
    devast: w.devast.slice(), pathogen: w.pathogen.slice(),
    plants: w.plants.map((p) => p.slice()), soil: w.soil.slice(), corpse: w.corpse.slice(),
    indNum: num, indGenome: gen, nInd: n, lineage: w.lineage.pack(),
    env: { sunG: w.sunG, meanTempG: w.meanTempG, seasonAmpG: w.seasonAmpG, seasonPeriodG: w.seasonPeriodG, climShift: w.climShift, climTarget: w.climTarget, climRate: w.climRate },
    ledger: { cumIn: w.cumIn, cumOut: w.cumOut, cumCosts: Array.from(w.cumCosts), cnt: { ...w.cnt } },
    spA: packSp(w.spA), nextSpA: w.nextSpA, spB: packSp(w.spB), nextSpB: w.nextSpB,
    log: structuredClone(w.log), pending: structuredClone(w.pending), events: structuredClone(w.events),
    history: { cols: w.history.cols.slice(), rows: w.history.rows.map((r) => r.slice()) },
    spHist: w.spHist.map(([t, a]) => [t, a.slice()] as [number, number[]]),
    hists: structuredClone(w.hists), dead: w.dead,
  };
}

export function deserialize(s: Snapshot): World {
  const w = new World(structuredClone(s.cfg));
  w.tick = s.tick; w.rng.setState(s.rng);
  w.terrain.set(s.terrain); w.dom.set(s.dom); w.zone.set(s.zone); w.sunMul.set(s.sunMul);
  w.devast.set(s.devast); w.pathogen.set(s.pathogen);
  s.plants.forEach((p, k) => w.plants[k].set(p)); w.soil.set(s.soil); w.corpse.set(s.corpse);
  w.lineage = Lineage.unpack(s.lineage);
  Object.assign(w, s.env);
  w.cumIn = s.ledger.cumIn; w.cumOut = s.ledger.cumOut; w.cumCosts.set(s.ledger.cumCosts); w.cnt = { ...w.cnt, ...s.ledger.cnt };
  const unSp = (a: any[]): SpeciesRec[] => a.map((x) => ({ ...x, centroid: x.centroid ? new Float32Array(x.centroid) : null }));
  w.spA = unSp(s.spA); w.nextSpA = s.nextSpA; w.spB = unSp(s.spB); w.nextSpB = s.nextSpB;
  w.log = structuredClone(s.log); w.pending = structuredClone(s.pending); w.events = structuredClone(s.events);
  w.history = { cols: s.history.cols.slice(), rows: s.history.rows.map((r) => r.slice()) };
  w.spHist = s.spHist.map(([t, a]) => [t, a.slice()] as [number, number[]]);
  w.hists = structuredClone(s.hists); w.dead = s.dead;
  for (let k = 0; k < s.nInd; k++) {
    const o = k * NF; const i = new Ind();
    i.id = s.indNum[o]; i.x = s.indNum[o + 1]; i.y = s.indNum[o + 2]; i.a = s.indNum[o + 3]; i.v = s.indNum[o + 4];
    i.reserve = s.indNum[o + 5]; i.structE = s.indNum[o + 6]; i.age = s.indNum[o + 7];
    i.species = s.indNum[o + 8]; i.speciesB = s.indNum[o + 9]; i.inf = s.indNum[o + 10]; i.birth = s.indNum[o + 11]; i.rec = s.indNum[o + 12];
    i.genome = s.indGenome.slice(k * G, (k + 1) * G);
    i.t = new Traits().decode(i.genome, w.cfg);
    w.inds.push(i);
  }
  return w;
}

// ── JSON 저장/불러오기 (타입드 배열은 base64) ──
function b64(buf: ArrayBufferView): string {
  const u = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode(...u.subarray(i, i + CH));
  return btoa(s);
}
function unb64(s: string): ArrayBuffer {
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
const TYPES: Record<string, any> = { u8: Uint8Array, u16: Uint16Array, i32: Int32Array, f32: Float32Array, f64: Float64Array };
export function snapshotToJSON(s: Snapshot): string {
  return JSON.stringify(s, (_k, v) => {
    if (ArrayBuffer.isView(v)) {
      const t = Object.entries(TYPES).find(([, C]) => v instanceof C)![0];
      return { __ta: t, b: b64(v) };
    }
    return v;
  });
}
export function snapshotFromJSON(txt: string): Snapshot {
  return JSON.parse(txt, (_k, v) => (v && typeof v === 'object' && v.__ta ? new TYPES[v.__ta](unb64(v.b)) : v));
}
