// 모든 계수는 여기 모은다. 스냅샷에 포함되므로 같은 설정이면 같은 결과.
export interface Features {
  brain: boolean;     // false: 출력이 순수 난수 (단계 2~3의 귀무 모형)
  reproduce: boolean; // false: 번식 없음 (단계 2)
  attack: boolean;    // 개체 공격 가능
  biomes: boolean;    // 바이옴(식물 종 편향, 기온대)
  seasons: boolean;   // 계절 변동
  sexual: boolean;    // 유성생식
  splitAttack?: boolean; // true: 먹기와 공격이 별개의 뇌 출력 (먹기로는 개체를 해칠 수 없다)
  memory?: boolean;   // 되먹임 기억: 직전 틱 은닉 노드 값을 입력으로 다시 쓴다 (옵션)
  neat?: boolean;     // 뇌 구조 변이(NEAT식): 연결·노드 추가/제거 (옵션)
}

export interface Config {
  w: number; h: number; seed: number; initPop: number; features: Features;
  // 식물/토양
  pMax: number; sunRate: number; soilInit: number; soilHalf: number; soilShare: number;
  meatBase: number; // 고기 소화 기본 효율(0=기존: 식성 0이면 효율 0). 효율 = effMax·(meatBase + (1−meatBase)·식성^dietCurve)
  soilLoss: number; // 분해자 열손실: 토양 에너지가 틱마다 이 비율만큼 시스템 밖으로 나간다 (0=없음, 기존 동작)
  senescence: number; corpseDecay: number; plantTempOpt: number[]; plantTempWidth: number;
  plantMin: number; corpseMin: number; offProfile: number;
  // 기후
  meanTemp: number; seasonAmp: number; seasonPeriod: number; seasonGrowthAmp: number;
  zoneOffset: number[]; sun: number;
  // 몸
  kStruct: number; kStore: number; effMax: number; effPlant: number; biteK: number; attackK: number; turnK: number;
  // 비용 (전부 열손실로 나가는 대사 비용)
  cBasal: number; cMove: number; cVision: number; cTherm: number; cBrain: number; cBrainW: number; cBrainStruct: number;
  cRes: number; cRepair: number; cAct: number; cAttack: number; cAttempt: number; cSignal: number;
  // 지형
  speedMul: number[]; costMul: number[];
  // 질병
  infDuration: number; infImmune: number; infMetaMul: number; contactR: number; infBeta: number;
  pathogenDecay: number; pathogenDose: number;
  // 종
  dmax: number; dcluster: number; speciesInterval: number; statInterval: number;
  maxPop: number; devastTicks: number; matureAge: number; genTerrain: boolean; waterLevel: number; restartOnExtinction: boolean;
  refuge: number; lifeSizeExp: number; initReserve: number; initPlant: number; founderHome: boolean; atkRatio: number; dietCurve: number; cGut: number; memLeak: number; juvenileFrac: number; growTicks: number; endemicRate: number; seedK: number; seedBg: number; cSense: number; toxinK: number; cLong: number; ageHazard: number; tempTol: number; tempHazard: number; landHazard: number; waterHazard: number;
  founders: { preset: string; count: number }[] | null;
}

export type ConfigOverride = Partial<Omit<Config, 'features'>> & { features?: Partial<Features> };
export function defaultConfig(over: ConfigOverride = {}): Config {
  const c: Config = {
    w: 128, h: 96, seed: 1, initPop: 400,
    features: { brain: true, reproduce: true, attack: true, biomes: true, seasons: true, sexual: true, splitAttack: true },
    pMax: 30, sunRate: 0.06, soilInit: 20, soilHalf: 20, soilShare: 0.55, soilLoss: 0, meatBase: 0,
    senescence: 0, corpseDecay: 0.01, plantTempOpt: [18, 8, 28], plantTempWidth: 14,
    plantMin: 0.5, corpseMin: 1.0, offProfile: 0.4,
    meanTemp: 15, seasonAmp: 6, seasonPeriod: 1200, seasonGrowthAmp: 0.3,
    zoneOffset: [-6, 0, 6], sun: 1,
    kStruct: 20, kStore: 140, effMax: 0.9, effPlant: 0.9, biteK: 3.5, attackK: 2, turnK: 0.6,
    cBasal: 0.07, cMove: 0.15, cVision: 0.0002, cTherm: 0.0006, cBrain: 0.015, cBrainW: 0.01, cBrainStruct: 0.03,
    cRes: 0.5, cRepair: 0.3, cAct: 0.02, cAttack: 0.5, cAttempt: 1.0, cSignal: 0.01,
    speedMul: [1, 0.5, 0.15], costMul: [1, 3, 10],
    infDuration: 100, infImmune: 100, infMetaMul: 1.0, contactR: 1.6, infBeta: 0.25,
    pathogenDecay: 0.97, pathogenDose: 0.2,
    dmax: 0.5, dcluster: 0.3, speciesInterval: 100, statInterval: 25,
    maxPop: 6000, devastTicks: 800, matureAge: 40, genTerrain: true, waterLevel: 0.2, restartOnExtinction: true, founders: null,
    refuge: 0, lifeSizeExp: 0, initReserve: 1.0, initPlant: 1.0, founderHome: false, atkRatio: 0, dietCurve: 1.0, cGut: 0.3, memLeak: 0.2, juvenileFrac: 0.5, growTicks: 100, endemicRate: 0.0001, seedK: 0.12, seedBg: 0.01, cSense: 0.0004, toxinK: 0.8, cLong: 0.4, ageHazard: 0.02, tempTol: 18, tempHazard: 0.004, landHazard: 0.005, waterHazard: 0.005,
  };
  return { ...c, ...over, features: { ...c.features, ...(over.features ?? {}) } };
}

// 개발 단계별 기능 세트 (헤드리스 검증용)
export const STAGES: Record<number, Features> = {
  1: { brain: false, reproduce: false, attack: false, biomes: false, seasons: false, sexual: false },
  2: { brain: false, reproduce: false, attack: false, biomes: false, seasons: false, sexual: false },
  3: { brain: false, reproduce: true, attack: false, biomes: false, seasons: false, sexual: false },
  4: { brain: true, reproduce: true, attack: false, biomes: false, seasons: false, sexual: false },
  5: { brain: true, reproduce: true, attack: true, biomes: true, seasons: true, sexual: false },
  6: { brain: true, reproduce: true, attack: true, biomes: true, seasons: true, sexual: true },
  7: { brain: true, reproduce: true, attack: true, biomes: true, seasons: true, sexual: true },
};
