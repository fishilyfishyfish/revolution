import { Config } from './config';
import { Rng } from './rng';

// ── 뇌 구조 (고정) ──
export const NIN = 15, NH = 8, NOUT = 5;
export const W1 = 0, B1 = NIN * NH, W2 = B1 + NH, B2 = W2 + NH * NOUT, NB = B2 + NOUT; // 173

// ── 게놈 레이아웃: [형질 16개][뇌 가중치 173개] ──
export const GENE = {
  SIZE: 0, VMAX: 1, VIS: 2, ANG: 3, D0: 4, D1: 5, D2: 6, DM: 7, TOPT: 8, RES: 9,
  THR: 10, GIVE: 11, SEX: 12, MUT: 13, HUE: 14, OSC: 15, AQ: 16, LONG: 17,
} as const;
export const NT = 18;
export const BO = NT;
export const G = NT + NB;
export const TAU = Math.PI * 2;

export const INPUT_NAMES = ['식물 방향', '식물 거리', '식물 종류', '사체 방향', '사체 거리', '개체 방향', '개체 거리',
  '개체 크기', '개체 색', '개체 유사도', '내 에너지', '기온', '지형', '노이즈', '진동자'];
export const OUTPUT_NAMES = ['회전', '가속', '먹기/공격', '번식 시도', '짝짓기 신호'];
export const TRAIT_NAMES = ['몸 크기', '최대 속도', '시야 거리', '시야 각도', '식물A 소화', '식물B 소화', '식물C 소화',
  '고기 소화', '적정 기온', '질병 저항', '번식 임계', '자식 에너지', '유성 성향', '돌연변이율', '색', '진동수', '수생 적응', '수명'];

const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// 유전자 → 표현형. 개체 탄생 시 한 번만 계산해 캐시.
export class Traits {
  size = 0; mass = 0; radius = 0; vmax = 0; vis = 0; ang = 0;
  eff = new Float64Array(4); diet = new Float64Array(4);
  tOpt = 0; res = 0; thr = 0; give = 0; sex = 0; mut = 0; hue = 0; osc = 0;
  maxReserve = 0; structE = 0; m075 = 0; basal = 0; visCost = 0; brainCost = 0;
  turnMax = 0; biteCap = 0; attackPow = 0; foodThr = 0;
  lifespan = 0; aq = 0; spWater = 0; spLand = 0; cWater = 0; cLand = 0;

  decode(g: Float32Array, cfg: Config): this {
    this.size = 0.5 + 2.5 * c01(g[GENE.SIZE]);
    this.mass = this.size * this.size;
    this.radius = 0.25 + 0.22 * this.size;
    this.vmax = 0.1 + 1.1 * c01(g[GENE.VMAX]);
    this.vis = 1.5 + 10.5 * c01(g[GENE.VIS]);
    this.ang = 0.35 + (TAU - 0.35) * c01(g[GENE.ANG]);
    let s = 0;
    for (let i = 0; i < 4; i++) { const v = Math.max(0.001, g[GENE.D0 + i]); this.diet[i] = v; s += v; }
    for (let i = 0; i < 4; i++) { this.diet[i] /= s; this.eff[i] = this.diet[i] * cfg.effMax; } // 합 고정 → 트레이드오프
    this.tOpt = -5 + 40 * c01(g[GENE.TOPT]);
    this.res = c01(g[GENE.RES]);
    this.thr = 0.3 + 0.65 * c01(g[GENE.THR]);
    this.give = 0.15 + 0.55 * c01(g[GENE.GIVE]);
    this.sex = c01(g[GENE.SEX]);
    const gm = c01(g[GENE.MUT]);
    this.mut = 0.003 * Math.pow(50, gm);
    this.hue = g[GENE.HUE];
    this.osc = 0.02 + 0.38 * c01(g[GENE.OSC]);
    // 수생 적응: 물에서는 빠르고 싸게, 육지에서는 느리고 비싸게 (반대는 반대). 양쪽 이득 없는 만능은 없다.
    const aq = c01(g[GENE.AQ]); this.aq = aq;
    const sw = cfg.speedMul[1], cw = cfg.costMul[1];
    this.spWater = sw + (1 - sw) * aq; this.spLand = 1 + (sw - 1) * aq;
    this.cWater = cw + (1 - cw) * aq; this.cLand = 1 + (cw - 1) * aq;
    let wa = 0;
    for (let i = 0; i < NB; i++) wa += Math.abs(g[BO + i]);
    wa /= NB;
    const lg = c01(g[GENE.LONG]);
    this.lifespan = 400 + 2600 * lg; // 이 나이를 넘기면 노화 사망 위험이 생긴다. 길수록 유지비↑
    const m075 = Math.pow(this.mass, 0.75);
    this.m075 = m075;
    this.maxReserve = cfg.kStore * this.mass;
    this.structE = cfg.kStruct * this.mass;
    this.basal = cfg.cBasal * m075 * (1 + cfg.cRes * this.res) * (1 + cfg.cRepair * (1 - gm)) * (1 + cfg.cLong * lg);
    this.visCost = cfg.cVision * 0.5 * this.vis * this.vis * this.ang;
    this.brainCost = cfg.cBrain + cfg.cBrainW * wa;
    this.turnMax = cfg.turnK / this.size;
    this.biteCap = cfg.biteK * m075;
    this.foodThr = Math.max(cfg.plantMin, 0.8 * this.biteCap); // 한 입 거리가 되는 먹이만 '보인다'
    this.attackPow = cfg.attackK * Math.pow(this.mass, 1.25);
    return this;
  }
}

export function founderBrain(rng: Rng): Float32Array {
  const b = new Float32Array(NB);
  for (let i = 0; i < NB; i++) b[i] = rng.gauss() * 0.8;
  return b;
}

// 창시 집단: 형질은 같은 중심값 주변의 좁은 변이, 뇌는 공통 원형 + 개체별 변이(σ=0.6)
export function founderGenome(rng: Rng, base: Float32Array, out = new Float32Array(G)): Float32Array {
  const mid = [0.4, 0.5, 0.5, 0.5, 0.5, 0.2, 0.2, 0.05, 0.5, 0.2, 0.5, 0.4, 0.3, 0.4, 0, 0.5, 0.05, 0.5];
  for (let i = 0; i < NT; i++) out[i] = c01(mid[i] + rng.gauss() * 0.05);
  out[GENE.HUE] = rng.next();
  for (let i = 0; i < NB; i++) out[BO + i] = base[i] + rng.gauss() * 0.6;
  return out;
}

// 창시 집단 프리셋 (새 월드 시작 때만 선택). 형질 값은 출발점일 뿐이고 이후 자유롭게 진화한다.
export interface Preset { name: string; label: string; icon: string; water: boolean; traits: Partial<Record<keyof typeof GENE, number>> }
export const PRESETS: Preset[] = [
  { name: 'herb', label: '초식동물', icon: '🦌', water: false, traits: {} },
  { name: 'omni', label: '잡식동물', icon: '🐗', water: false, traits: { D0: 0.3, D1: 0.3, D2: 0.3, DM: 0.3, SIZE: 0.45 } },
  { name: 'predator', label: '육식동물', icon: '🐺', water: false, traits: { SIZE: 0.55, VMAX: 0.75, VIS: 0.65, ANG: 0.4, D0: 0.03, D1: 0.03, D2: 0.03, DM: 0.9 } },
  { name: 'fish', label: '물고기', icon: '🐟', water: true, traits: { SIZE: 0.12, VMAX: 0.5, VIS: 0.5, AQ: 0.95, D0: 0.03, D1: 0.03, D2: 0.8, DM: 0.14 } },
  { name: 'fishpred', label: '수중 포식자', icon: '🦈', water: true, traits: { SIZE: 0.5, VMAX: 0.75, VIS: 0.65, ANG: 0.4, AQ: 0.95, D0: 0.03, D1: 0.03, D2: 0.04, DM: 0.9 } },
];
export function presetGenome(name: string, rng: Rng, base: Float32Array, out = new Float32Array(G)): Float32Array {
  founderGenome(rng, base, out);
  const pr = PRESETS.find((p) => p.name === name);
  if (pr) for (const [k, v] of Object.entries(pr.traits)) out[GENE[k as keyof typeof GENE]] = c01(v! + rng.gauss() * 0.05);
  return out;
}

export function randomGenome(rng: Rng, out = new Float32Array(G)): Float32Array {
  for (let i = 0; i < NT; i++) out[i] = rng.next();
  for (let i = 0; i < NB; i++) out[BO + i] = rng.gauss() * 0.8;
  return out;
}

// 교차: 형질은 유전자별 균등, 뇌는 은닉 뉴런 단위 블록 (입력가중치+편향+출력가중치)
export function crossover(out: Float32Array, a: Float32Array, b: Float32Array, rng: Rng) {
  for (let i = 0; i < NT; i++) out[i] = rng.next() < 0.5 ? a[i] : b[i];
  for (let j = 0; j < NH; j++) {
    const src = rng.next() < 0.5 ? a : b;
    for (let i = 0; i < NIN; i++) out[BO + W1 + i * NH + j] = src[BO + W1 + i * NH + j];
    out[BO + B1 + j] = src[BO + B1 + j];
    for (let k = 0; k < NOUT; k++) out[BO + W2 + j * NOUT + k] = src[BO + W2 + j * NOUT + k];
  }
  for (let k = 0; k < NOUT; k++) out[BO + B2 + k] = (rng.next() < 0.5 ? a : b)[BO + B2 + k];
}

// 유전자별 가우시안 돌연변이. sigma = 부모의 (진화하는) 돌연변이율.
export function mutate(g: Float32Array, sigma: number, rng: Rng) {
  for (let i = 0; i < NT; i++) {
    const s = i === GENE.MUT ? 0.04 : sigma;
    let v = g[i] + rng.gauss() * s;
    if (i === GENE.HUE) { v -= Math.floor(v); } else v = c01(v);
    g[i] = v;
  }
  const sw = sigma * 2;
  for (let i = 0; i < NB; i++) {
    let v = g[BO + i] + rng.gauss() * sw;
    if (v > 8) v = 8; else if (v < -8) v = -8;
    g[BO + i] = v;
  }
}

// 게놈 거리 (형질 절반 + 뇌 절반의 RMS). 색(원형) 처리 포함.
export function genomeDistance(a: Float32Array, b: Float32Array): number {
  let st = 0;
  for (let i = 0; i < NT; i++) {
    let d = Math.abs(a[i] - b[i]);
    if (i === GENE.HUE && d > 0.5) d = 1 - d;
    st += d * d;
  }
  let sw = 0;
  for (let i = BO; i < G; i++) { const d = (a[i] - b[i]) * (1 / 3); sw += d * d; }
  return Math.sqrt(0.5 * st / NT + 0.5 * sw / NB);
}

// 교배 호환성: 거리가 클수록 성공률↓, dmax를 넘으면 0
export function compatProb(d: number, dmax: number): number { const p = 1 - d / dmax; return p > 0 ? p : 0; }

// ── 뇌 순전파 ──
export function brainForward(g: Float32Array, inp: ArrayLike<number>, hid: Float64Array, out: Float64Array) {
  for (let j = 0; j < NH; j++) {
    let s = g[BO + B1 + j];
    for (let i = 0; i < NIN; i++) s += g[BO + W1 + i * NH + j] * inp[i];
    hid[j] = Math.tanh(s);
  }
  for (let k = 0; k < NOUT; k++) {
    let s = g[BO + B2 + k];
    for (let j = 0; j < NH; j++) s += g[BO + W2 + j * NOUT + k] * hid[j];
    out[k] = Math.tanh(s);
  }
}
