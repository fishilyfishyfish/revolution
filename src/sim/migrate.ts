import { defaultConfig } from './config';
import { B1, B2, FOUNDER_MID, G, GENE, NH, NIN, NM, NOUT, NT, W1, W2, BO, MO, M_H, M_W2 } from './genome';
import { Snapshot, validateSnapshot } from './snapshot';
import { STAT_COLS } from './analysis';

// 과거 버전의 게놈 구조. 게놈 길이(G)로 어느 버전인지 알아낸다.
// (뇌 입력/출력은 뒤에 덧붙이는 식으로만 늘어났고, 형질도 뒤에 덧붙었다.)
export interface OldLayout { G: number; NT: number; NIN: number; NOUT: number; masks: boolean; note: string }
const mk = (nt: number, nin: number, nout: number, masks: boolean, note: string): OldLayout => {
  const nb = nin * NH + NH + NH * nout + nout; const nm = masks ? nin * NH + NH * nout + NH : 0;
  return { G: nt + nb + nm, NT: nt, NIN: nin, NOUT: nout, masks, note };
};
export const OLD: OldLayout[] = [
  mk(16, 15, 5, false, '형질 16 · 뇌 15-8-5'),
  mk(17, 15, 5, false, '형질 17 · 뇌 15-8-5'),
  mk(18, 15, 5, false, '형질 18 · 뇌 15-8-5'),
  mk(28, 18, 7, false, '형질 28 · 뇌 18-8-7'),
  mk(28, 19, 7, false, '형질 28 · 뇌 19-8-7'),
  mk(28, 19, 7, true, '형질 28 · 뇌 19-8-7 + 구조 마스크'),
  mk(29, 19, 7, true, '형질 29 · 뇌 19-8-7 + 구조 마스크'),
];

// 옛 게놈 → 현재 구조. 같은 자리의 형질·뇌 가중치는 그대로 옮기고, 새로 생긴 것은 중립값으로 채운다.
function mapGenome(old: ArrayLike<number>, L: OldLayout, neat: boolean, id: number): Float32Array {
  const g = new Float32Array(G);
  for (let i = 0; i < NT; i++) g[i] = i < L.NT ? old[i] : FOUNDER_MID[i];
  if (L.NT <= GENE.IMM) g[GENE.IMM] = (id * 0.61803398875) % 1; // 새 형질 '면역형'은 개체마다 다양하게
  const OB = L.NT;
  for (let i = 0; i < L.NIN; i++) for (let j = 0; j < NH; j++) g[BO + W1 + i * NH + j] = old[OB + i * NH + j]; // 옛 입력은 같은 번호 그대로
  const oB1 = L.NIN * NH, oW2 = oB1 + NH, oB2 = oW2 + NH * L.NOUT;
  for (let j = 0; j < NH; j++) g[BO + B1 + j] = old[OB + oB1 + j];
  for (let j = 0; j < NH; j++) for (let k = 0; k < L.NOUT; k++) g[BO + W2 + j * NOUT + k] = old[OB + oW2 + j * L.NOUT + k];
  for (let k = 0; k < NOUT; k++) g[BO + B2 + k] = k < L.NOUT ? old[OB + oB2 + k] : -0.8; // 새 출력(웅크림·휴식)은 기본 꺼짐
  // 구조 마스크
  if (!neat) { for (let i = 0; i < NM; i++) g[MO + i] = 1; return g; }
  const oM = OB + L.NIN * NH + NH + NH * L.NOUT + L.NOUT; // 옛 마스크 시작 위치
  for (let i = 0; i < L.NIN; i++) for (let j = 0; j < NH; j++) g[MO + i * NH + j] = L.masks ? old[oM + i * NH + j] : 1;
  for (let j = 0; j < NH; j++) for (let k = 0; k < L.NOUT; k++) g[MO + M_W2 + j * NOUT + k] = L.masks ? old[oM + L.NIN * NH + j * L.NOUT + k] : 1;
  for (let j = 0; j < NH; j++) g[MO + M_H + j] = L.masks ? old[oM + L.NIN * NH + NH * L.NOUT + j] : 1;
  return g;
}

export interface Prepared { snap: Snapshot | null; note: string; error: string | null }

// 불러오기 전 처리: 현재 구조면 그대로, 옛 구조면 변환, 알 수 없으면 이유와 함께 거부
export function prepareSnapshot(raw: any): Prepared {
  const err0 = validateSnapshot(raw);
  if (!err0) return { snap: raw as Snapshot, note: '', error: null };
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !raw.cfg || !raw.indGenome || !raw.lineage || raw.layout) return { snap: null, note: '', error: err0 };
  const nInd: number = raw.nInd;
  const oldG = nInd > 0 ? raw.indGenome.length / nInd : 0;
  const L = OLD.find((x) => x.G === oldG);
  if (!L) return { snap: null, note: '', error: `${err0} (이 게놈 길이 ${oldG}는 변환할 수 없어요)` };
  try {
    const neat = !!raw.cfg.features?.neat;
    const s = raw as any;
    // 개체 숫자 필드 (12/13/14개 → 14개)
    const nf: number = s.indNum.length / nInd, NF = 14;
    const num = new Float64Array(nInd * NF);
    for (let k = 0; k < nInd; k++) for (let f = 0; f < Math.min(nf, NF); f++) num[k * NF + f] = s.indNum[k * nf + f];
    const gen = new Float32Array(nInd * G);
    for (let k = 0; k < nInd; k++) gen.set(mapGenome(s.indGenome.subarray(k * L.G, (k + 1) * L.G), L, neat, num[k * NF]), k * G);
    // 설정: 세계를 정의하는 값만 가져오고 비용 계수는 현재 값을 쓴다
    const o = s.cfg;
    const cfg = defaultConfig({ w: o.w, h: o.h, seed: o.seed, initPop: o.initPop, waterLevel: o.waterLevel, restartOnExtinction: o.restartOnExtinction,
      features: { ...(o.features ?? {}) }, meanTemp: o.meanTemp, seasonAmp: o.seasonAmp, seasonPeriod: o.seasonPeriod, sun: o.sun, genTerrain: o.genTerrain });
    const cent = (r: any) => ({ ...r, centroid: r.centroid && r.centroid.length === L.G ? mapGenome(r.centroid, L, neat, 0) : null });
    // 통계 이력: 열 이름으로 옮기고 없는 열은 비워 둔다
    const oc: string[] = s.history?.cols ?? [];
    const rows = (s.history?.rows ?? []).map((r: number[]) => STAT_COLS.map((c) => { const i = oc.indexOf(c); return i >= 0 ? r[i] : NaN; }));
    const snap: Snapshot = {
      ...s, version: 1, layout: { G, NT, NIN, NH, NOUT }, cfg, indNum: num, indGenome: gen,
      env: { strain: 0.5, sunG: cfg.sun, meanTempG: cfg.meanTemp, seasonAmpG: cfg.seasonAmp, seasonPeriodG: cfg.seasonPeriod, climShift: 0, climTarget: 0, climRate: 0, ...(s.env ?? {}) },
      ledger: { ...s.ledger, cnt: { births: 0, sexBirths: 0, asexBirths: 0, starved: 0, eaten: 0, disease: 0, meteor: 0, aged: 0, tempDeaths: 0, habitat: 0, matings: 0, matingFails: 0, restarts: 0, ...(s.ledger?.cnt ?? {}) } },
      spA: (s.spA ?? []).map(cent), spB: (s.spB ?? []).map(cent), history: { cols: STAT_COLS, rows }, hists: {},
    };
    const err = validateSnapshot(snap);
    if (err) return { snap: null, note: '', error: `변환 결과가 올바르지 않아요: ${err}` };
    return { snap, note: `옛 버전(${L.note}) 파일을 현재 구조로 변환해서 불러왔어요. 새 형질은 기본값으로 채워졌고, 이후는 현재 규칙으로 진행돼요.`, error: null };
  } catch (e) { return { snap: null, note: '', error: `옛 파일 변환에 실패했어요: ${(e as Error).message}` }; }
}
