import { Config } from './config';
import { Rng } from './rng';

// ── 뇌 구조 (고정) ──
export const NIN_BASE = 21; // 감각 입력 수
export const NIN = NIN_BASE + 8, NH = 8, NOUT = 8; // + 직전 틱 은닉 노드 값(기억) 8개
export const W1 = 0, B1 = NIN * NH, W2 = B1 + NH, B2 = W2 + NH * NOUT, NB = B2 + NOUT; // 173

// ── 게놈 레이아웃: [형질 16개][뇌 가중치 173개] ──
export const GENE = {
  SIZE: 0, VMAX: 1, VIS: 2, ANG: 3, D0: 4, D1: 5, D2: 6, DM: 7, TOPT: 8, RES: 9,
  THR: 10, GIVE: 11, SEX: 12, MUT: 13, HUE: 14, OSC: 15, AQ: 16, LONG: 17,
  ARMOR: 18, CLAW: 19, TOXIN: 20, SMELL: 21, HEAR: 22, TWID: 23, INSUL: 24, HIBER: 25, CLUTCH: 26, PICKY: 27, IMM: 28, GUT: 29,
} as const;
export const NT = 30;
export const BO = NT;
// 뇌 구조 마스크(NEAT식 구조 변이용): 연결·은닉 노드마다 켜짐(1)/꺼짐(0). 구조 변이를 끄면 전부 1로 고정된다.
export const NM = NIN * NH + NH * NOUT + NH;
export const MO = NT + NB;
export const M_W2 = NIN * NH, M_H = M_W2 + NH * NOUT;
export const MAXC = NIN * NH + NH * NOUT + 2 * NH;
export const G = NT + NB + NM;
export const TAU = Math.PI * 2;

export const INPUT_NAMES = ['식물 방향', '식물 거리', '식물 종류', '사체 방향', '사체 거리', '개체 방향', '개체 거리',
  '개체 크기', '개체 색', '개체 유사도', '내 에너지', '기온', '지형', '노이즈', '진동자', '최근 피해', '개체 발톱', '기온 편차', '앞쪽 지형', '개체 속도', '개체 접근', '기억 1', '기억 2', '기억 3', '기억 4', '기억 5', '기억 6', '기억 7', '기억 8'];
export const OUTPUT_NAMES = ['회전', '가속', '먹기/공격', '번식 시도', '짝짓기 신호', '웅크림(방어)', '휴식', '공격'];
export const TRAIT_NAMES = ['몸 크기', '최대 속도', '시야 거리', '시야 각도', '식물A 소화', '식물B 소화', '식물C 소화',
  '고기 소화', '적정 기온', '질병 저항', '번식 임계', '자식 에너지', '유성 성향', '돌연변이율', '색', '진동수', '수생 적응', '수명', '피부/갑옷', '이빨·발톱', '독', '후각', '청각', '기온 허용폭', '단열', '겨울잠', '한배 새끼 수', '짝 까다로움', '면역형', '소화관(섭식 용량)'];

const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// 유전자 → 표현형. 개체 탄생 시 한 번만 계산해 캐시.
export class Traits {
  size = 0; mass = 0; radius = 0; vmax = 0; vis = 0; ang = 0;
  eff = new Float64Array(4); diet = new Float64Array(4);
  tOpt = 0; res = 0; thr = 0; give = 0; sex = 0; mut = 0; hue = 0; osc = 0;
  maxReserve = 0; structE = 0; m075 = 0; basal = 0; visCost = 0; brainCost = 0;
  turnMax = 0; biteCap = 0; attackPow = 0; foodThr = 0;
  nodes = NH; conns = NIN * NH + NH * NOUT; imm = 0; gut = 0; intakeMul = 1; lifespan = 0; armor = 0; claw = 0; toxin = 0; smellR = 0; hearR = 0; tolW = 0; insul = 0; hiber = 0; clutchMax = 1; picky = 0; moveMul = 1; tempLethal = 0; aq = 0; spWater = 0; spLand = 0; cWater = 0; cLand = 0;

  decode(g: Float32Array, cfg: Config): this {
    this.size = 0.5 + 2.5 * c01(g[GENE.SIZE]);
    this.mass = this.size * this.size;
    this.radius = 0.25 + 0.22 * this.size;
    this.vmax = 0.1 + 1.1 * c01(g[GENE.VMAX]);
    this.vis = 1.5 + 10.5 * c01(g[GENE.VIS]);
    this.ang = 0.35 + (TAU - 0.35) * c01(g[GENE.ANG]);
    let s = 0;
    for (let i = 0; i < 4; i++) { const v = Math.max(0.001, g[GENE.D0 + i]); this.diet[i] = v; s += v; }
    for (let i = 0; i < 4; i++) { this.diet[i] /= s; const d = cfg.dietCurve === 1 ? this.diet[i] : Math.pow(this.diet[i], cfg.dietCurve); this.eff[i] = i < 3 ? d * cfg.effPlant : cfg.effMax * (cfg.meatBase + (1 - cfg.meatBase) * d); } // dietCurve<1: 소화 능력 교환이 직선보다 완만 (조금 투자해도 효율이 빨리 오른다) // 식물(i<3)과 고기(i=3)의 최대 소화 효율을 따로 둔다 // 합 고정 → 트레이드오프
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
    this.lifespan = (400 + 2600 * lg) * Math.pow(this.size / 1.5, cfg.lifeSizeExp); // 이 나이를 넘기면 노화 사망 위험이 생긴다. 길수록 유지비↑
    // ── 방어·감각·체온·번식 세부 형질: 전부 이득과 비용이 같이 있다 ──
    this.armor = c01(g[GENE.ARMOR]);   // 이득: 받는 피해 1/(1+2a) / 비용: 기초대사 +50%·a, 이동 질량 +60%·a
    this.claw = c01(g[GENE.CLAW]);     // 이득: 공격력 ×(1+1.5c) / 비용: 기초대사 +30%·c
    this.toxin = c01(g[GENE.TOXIN]);   // 이득: 먹으려 한 쪽이 피해량×독×0.8 열손실 / 비용: 기초대사 +40%·t
    this.smellR = 0.5 + 6 * c01(g[GENE.SMELL]); // 이득: 시야 밖(전방위)에서도 먹이·사체 감지 / 비용: 반경² 유지비
    this.hearR = 0.5 + 6 * c01(g[GENE.HEAR]);   // 이득: 시야 밖 개체 감지 / 비용: 반경² 유지비
    const tw = c01(g[GENE.TWID]);
    this.tolW = 3 + 9 * tw;            // 이득: 이 폭 안의 기온 편차는 무료·치사 기온 범위↑ / 비용: 기초대사 +30%·w
    this.tempLethal = cfg.tempTol + 10 * tw;
    this.insul = c01(g[GENE.INSUL]);   // 이득: 체온 조절 비용 −60%·i / 비용: 기초대사 +40%·i
    this.hiber = c01(g[GENE.HIBER]);   // 이득: 추울 때 겨울잠(대사 −80%·h) / 비용: 그동안 이동·섭식·번식 불가, 기초대사 +15%·h
    this.clutchMax = 1 + Math.floor(3 * c01(g[GENE.CLUTCH]) * 0.999); // 이득: 한 번에 최대 N마리 / 비용: 새끼당 에너지 1/N
    this.picky = c01(g[GENE.PICKY]);   // 이득: 호환성 낮은 짝 회피(헛수고↓) / 비용: 짝 후보↓
    this.moveMul = 1 + 0.6 * this.armor;
    this.gut = c01(g[GENE.GUT]);              // 이득: 한 입 용량 ×(0.5+2.5·g) / 비용: 기초대사 +cGut·g
    this.intakeMul = 0.5 + 2.5 * this.gut;
    this.imm = c01(g[GENE.IMM]); // 면역형(MHC 같은 대립유전자): 병원체 균주와 가까울수록 감염되기 쉽다 (빈도 의존)
    const m075 = Math.pow(this.mass, 0.75);
    this.m075 = m075;
    this.maxReserve = cfg.kStore * this.mass;
    this.structE = cfg.kStruct * this.mass;
    this.basal = cfg.cBasal * m075 * (1 + cfg.cRes * this.res) * (1 + cfg.cRepair * (1 - gm)) * (1 + cfg.cLong * lg)
      * (1 + 0.5 * this.armor) * (1 + 0.3 * this.claw) * (1 + 0.4 * this.toxin) * (1 + 0.3 * tw) * (1 + 0.4 * this.insul) * (1 + 0.15 * this.hiber) * (1 + cfg.cGut * this.gut);
    this.visCost = cfg.cVision * 0.5 * this.vis * this.vis * this.ang + cfg.cSense * (this.smellR * this.smellR + this.hearR * this.hearR);
    if (cfg.features.neat) { // 구조 변이: 활성 연결·노드가 많을수록 유지비↑ (복잡한 뇌는 값어치를 해야 한다)
      let nn = 0, nc = 0;
      for (let j = 0; j < NH; j++) {
        if (g[MO + M_H + j] < 0.5) continue;
        nn++;
        for (let i = 0; i < NIN; i++) if (g[MO + i * NH + j] >= 0.5) nc++;
        for (let k = 0; k < NOUT; k++) if (g[MO + M_W2 + j * NOUT + k] >= 0.5) nc++;
      }
      this.nodes = nn; this.conns = nc;
      this.brainCost = cfg.cBrain * 0.3 + cfg.cBrainStruct * (nc + 2 * nn) / MAXC;
    } else this.brainCost = cfg.cBrain + cfg.cBrainW * wa;
    if (cfg.learnRate > 0) this.brainCost += cfg.cLearn; // 학습 기구의 유지비
    this.turnMax = cfg.turnK / this.size;
    this.biteCap = cfg.biteK * m075 * this.intakeMul;
    this.foodThr = Math.max(cfg.plantMin, 0.8 * this.biteCap); // 한 입 거리가 되는 먹이만 '보인다'
    this.attackPow = cfg.attackK * Math.pow(this.mass, 1.25) * (1 + 1.5 * this.claw);
    return this;
  }
}

// 창시 집단의 형질 시작값 (유전자 순서대로). 옛 저장 파일 변환 때 새 형질의 기본값으로도 쓴다.
export const FOUNDER_MID = [0.4, 0.5, 0.5, 0.5, 0.5, 0.2, 0.2, 0.05, 0.5, 0.2, 0.5, 0.4, 0.3, 0.4, 0, 0.5, 0.05, 0.5, 0.04, 0.04, 0.0, 0.1, 0.1, 0.1, 0.05, 0.0, 0.15, 0.1, 0.5, 0.2];

export function founderBrain(rng: Rng): Float32Array {
  const b = new Float32Array(NB);
  for (let i = 0; i < NB; i++) b[i] = rng.gauss() * 0.8;
  return b;
}

// 창시 집단: 형질은 같은 중심값 주변의 좁은 변이, 뇌는 공통 원형 + 개체별 변이(σ=0.4)
export function founderGenome(rng: Rng, base: Float32Array, out = new Float32Array(G), neat = false, memory = false): Float32Array {
  const mid = FOUNDER_MID;
  for (let i = 0; i < NT; i++) out[i] = c01(mid[i] + rng.gauss() * 0.05);
  out[GENE.HUE] = rng.next();
  out[GENE.IMM] = rng.next(); // 면역형은 창시 집단에서도 다양하다
  out[GENE.GUT] = c01(0.2 + rng.gauss() * 0.15); // 소화관(섭식 용량)도 창시 집단 안에서 꽤 다양하다
  for (let i = 0; i < NB; i++) out[BO + i] = base[i] + rng.gauss() * 0.4;
  // 창시 집단은 웅크림·휴식 출력이 기본 '꺼짐' 쪽에서 시작한다 (진화로 켜질 수는 있다)
  out[BO + B2 + 5] = -0.8 + rng.gauss() * 0.2; out[BO + B2 + 6] = -0.8 + rng.gauss() * 0.2; out[BO + B2 + 7] = -0.8 + rng.gauss() * 0.2; // 웅크림·휴식·공격은 기본 꺼짐
  initMasks(out, rng, neat);
  if (!memory) zeroMemoryWeights(out); // 기억 옵션이 꺼져 있으면 기억 입력의 가중치는 0에서 시작
  return out;
}

// 창시 집단 프리셋 (새 월드 시작 때만 선택). 형질 값은 출발점일 뿐이고 이후 자유롭게 진화한다.
export interface Preset { name: string; label: string; icon: string; water: boolean; traits: Partial<Record<keyof typeof GENE, number>> }
export const PRESETS: Preset[] = [
  { name: 'herb', label: '초식동물', icon: '🦌', water: false, traits: { ARMOR: 0.25, HEAR: 0.3 } },
  { name: 'snail', label: '느린 초식(달팽이형)', icon: '🐌', water: false, traits: { SIZE: 0.05, VMAX: 0.06, VIS: 0.25, HEAR: 0.2, ARMOR: 0.8, CLUTCH: 0.6 } }, // 작고 느리고 단단한 풀 뜯는 동물. 껍질(방어)은 대사 +40%·이동 질량 +48%의 비용이 따른다
  { name: 'omni', label: '잡식동물', icon: '🐗', water: false, traits: { D0: 0.3, D1: 0.3, D2: 0.3, DM: 0.3, SIZE: 0.45 } },
  { name: 'predator', label: '육식동물', icon: '🐺', water: false, traits: { SIZE: 0.55, VMAX: 0.75, VIS: 0.65, ANG: 0.4, D0: 0.03, D1: 0.03, D2: 0.03, DM: 0.9, CLAW: 0.6, SMELL: 0.5 } },
  { name: 'fish', label: '물고기', icon: '🐟', water: true, traits: { SIZE: 0.12, VMAX: 0.5, VIS: 0.5, AQ: 0.95, D0: 0.03, D1: 0.03, D2: 0.8, DM: 0.14, CLUTCH: 0.6 } },
  { name: 'fishpred', label: '수중 포식자', icon: '🦈', water: true, traits: { SIZE: 0.5, VMAX: 0.75, VIS: 0.65, ANG: 0.4, AQ: 0.95, D0: 0.03, D1: 0.03, D2: 0.04, DM: 0.9, CLAW: 0.6, SMELL: 0.5 } },
];
export function presetGenome(name: string, rng: Rng, base: Float32Array, out = new Float32Array(G), neat = false, memory = false): Float32Array {
  founderGenome(rng, base, out, neat, memory);
  const pr = PRESETS.find((p) => p.name === name);
  if (pr) for (const [k, v] of Object.entries(pr.traits)) out[GENE[k as keyof typeof GENE]] = c01(v! + rng.gauss() * 0.05);
  return out;
}

// 마스크 초기화. 구조 변이가 꺼져 있으면 전부 켜짐. 켜져 있으면 NEAT처럼 작은 뇌(은닉 4개, 듬성듬성한 연결)에서 시작한다.
function zeroMemoryWeights(g: Float32Array) { for (let i = NIN_BASE; i < NIN; i++) for (let j = 0; j < NH; j++) g[BO + W1 + i * NH + j] = 0; }

export function initMasks(g: Float32Array, rng: Rng, neat: boolean) {
  if (!neat) { for (let i = 0; i < NM; i++) g[MO + i] = 1; return; }
  for (let i = 0; i < NM; i++) g[MO + i] = 0;
  for (let j = 0; j < 4; j++) {
    g[MO + M_H + j] = 1;
    for (let i = 0; i < NIN; i++) if (rng.next() < 0.3) g[MO + i * NH + j] = 1;
    for (let k = 0; k < NOUT; k++) if (rng.next() < 0.5) g[MO + M_W2 + j * NOUT + k] = 1;
  }
}

export function randomGenome(rng: Rng, out = new Float32Array(G), neat = false, memory = false): Float32Array {
  // 전멸 후 재시작용 무작위 게놈. 유지비가 큰 선택 형질(갑옷·발톱·독·감각·단열·겨울잠·허용폭)은 0 쪽으로 치우친 분포(r²)에서 뽑는다.
  const skew = new Set<number>([GENE.ARMOR, GENE.CLAW, GENE.TOXIN, GENE.SMELL, GENE.HEAR, GENE.TWID, GENE.INSUL, GENE.HIBER, GENE.SIZE, GENE.VMAX, GENE.VIS]);
  for (let i = 0; i < NT; i++) { const r = rng.next(); out[i] = skew.has(i) ? r * r : r; }
  for (let i = 0; i < NB; i++) out[BO + i] = rng.gauss() * 0.8;
  initMasks(out, rng, neat);
  if (!memory) zeroMemoryWeights(out);
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
    // 마스크도 같은 블록에서 함께 물려받는다
    for (let i = 0; i < NIN; i++) out[MO + i * NH + j] = src[MO + i * NH + j];
    out[MO + M_H + j] = src[MO + M_H + j];
    for (let k = 0; k < NOUT; k++) out[MO + M_W2 + j * NOUT + k] = src[MO + M_W2 + j * NOUT + k];
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

// 구조 변이 (NEAT식): 연결 추가/제거, 노드 추가/제거. 확률은 부모의 돌연변이율에 비례한다.
export function mutateStructure(g: Float32Array, mut: number, rng: Rng) {
  const sc = Math.min(3, mut / 0.02);
  const hidOn = (j: number) => g[MO + M_H + j] >= 0.5;
  if (rng.next() < 0.04 * sc) { // 연결 추가 (켜진 은닉 노드에 붙은 꺼진 연결 하나)
    for (let t = 0; t < 12; t++) {
      const j = rng.int(NH); if (!hidOn(j)) continue;
      if (rng.next() < NIN / (NIN + NOUT)) { const i = rng.int(NIN); if (g[MO + i * NH + j] < 0.5) { g[MO + i * NH + j] = 1; g[BO + W1 + i * NH + j] = rng.gauss() * 0.8; break; } }
      else { const k = rng.int(NOUT); if (g[MO + M_W2 + j * NOUT + k] < 0.5) { g[MO + M_W2 + j * NOUT + k] = 1; g[BO + W2 + j * NOUT + k] = rng.gauss() * 0.8; break; } }
    }
  }
  if (rng.next() < 0.03 * sc) { // 연결 제거
    for (let t = 0; t < 12; t++) {
      if (rng.next() < NIN / (NIN + NOUT)) { const i = rng.int(NIN), j = rng.int(NH); if (g[MO + i * NH + j] >= 0.5) { g[MO + i * NH + j] = 0; break; } }
      else { const j = rng.int(NH), k = rng.int(NOUT); if (g[MO + M_W2 + j * NOUT + k] >= 0.5) { g[MO + M_W2 + j * NOUT + k] = 0; break; } }
    }
  }
  if (rng.next() < 0.008 * sc) { // 노드 추가: 꺼진 은닉 슬롯을 켜고 입력 하나·출력 하나에 연결
    const free: number[] = []; for (let j = 0; j < NH; j++) if (!hidOn(j)) free.push(j);
    if (free.length) {
      const j = free[rng.int(free.length)], i = rng.int(NIN), k = rng.int(NOUT);
      g[MO + M_H + j] = 1; g[MO + i * NH + j] = 1; g[MO + M_W2 + j * NOUT + k] = 1;
      g[BO + W1 + i * NH + j] = rng.gauss() * 0.8; g[BO + W2 + j * NOUT + k] = rng.gauss() * 0.8; g[BO + B1 + j] = 0;
    }
  }
  if (rng.next() < 0.005 * sc) { // 노드 제거 (최소 2개는 남긴다)
    const on: number[] = []; for (let j = 0; j < NH; j++) if (hidOn(j)) on.push(j);
    if (on.length > 2) {
      const j = on[rng.int(on.length)]; g[MO + M_H + j] = 0;
      for (let i = 0; i < NIN; i++) g[MO + i * NH + j] = 0;
      for (let k = 0; k < NOUT; k++) g[MO + M_W2 + j * NOUT + k] = 0;
    }
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
  for (let i = BO; i < BO + NB; i++) { const d = (a[i] - b[i]) * (1 / 3); sw += d * d; }
  let mm = 0;
  for (let i = MO; i < G; i++) mm += Math.abs(a[i] - b[i]);
  return Math.sqrt(0.5 * st / NT + 0.5 * (sw / NB + 0.3 * mm / NM));
}

// 교배 호환성: 거리가 클수록 성공률↓, dmax를 넘으면 0
export function compatProb(d: number, dmax: number): number { const p = 1 - d / dmax; return p > 0 ? p : 0; }

// ── 뇌 순전파 ──
// lw: 수명 내 학습으로 생긴 출력층 가중치 변화(W2 NH×NOUT + B2 NOUT), xi: 출력 탐색 잡음(둘 다 없으면 기존과 같다)
export function brainForward(g: Float32Array, inp: ArrayLike<number>, hid: Float64Array, out: Float64Array, masked = false, lw: Float32Array | null = null, xi: Float64Array | null = null) {
  if (masked) { // 구조 변이: 꺼진 노드·연결은 계산하지 않는다 (연산 비용도 그만큼 줄어든다)
    for (let j = 0; j < NH; j++) {
      if (g[MO + M_H + j] < 0.5) { hid[j] = 0; continue; }
      let s = g[BO + B1 + j];
      for (let i = 0; i < NIN; i++) if (g[MO + i * NH + j] >= 0.5) s += g[BO + W1 + i * NH + j] * inp[i];
      hid[j] = Math.tanh(s);
    }
    for (let k = 0; k < NOUT; k++) {
      let s = g[BO + B2 + k];
      for (let j = 0; j < NH; j++) if (g[MO + M_W2 + j * NOUT + k] >= 0.5) s += (g[BO + W2 + j * NOUT + k] + (lw ? lw[j * NOUT + k] : 0)) * hid[j];
      if (lw) s += lw[NH * NOUT + k]; if (xi) s += xi[k];
      out[k] = Math.tanh(s);
    }
    return;
  }
  for (let j = 0; j < NH; j++) {
    let s = g[BO + B1 + j];
    for (let i = 0; i < NIN; i++) s += g[BO + W1 + i * NH + j] * inp[i];
    hid[j] = Math.tanh(s);
  }
  for (let k = 0; k < NOUT; k++) {
    let s = g[BO + B2 + k];
    for (let j = 0; j < NH; j++) s += (g[BO + W2 + j * NOUT + k] + (lw ? lw[j * NOUT + k] : 0)) * hid[j];
    if (lw) s += lw[NH * NOUT + k]; if (xi) s += xi[k];
    out[k] = Math.tanh(s);
  }
}
