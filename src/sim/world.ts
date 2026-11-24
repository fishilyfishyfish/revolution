import { Config, defaultConfig } from './config';
import {
  G, NIN, NH, NOUT, TAU, Traits, brainForward, compatProb, crossover, founderBrain, founderGenome, presetGenome, GENE, genomeDistance, mutate, randomGenome,
} from './genome';
import { CAUSE, Lineage } from './lineage';
import { Rng } from './rng';

export const T_PLAIN = 0, T_WATER = 1, T_MOUNTAIN = 2;
export const NPLANT = 3;
export const MODE_NONE = 0, MODE_ASEX = 1, MODE_SEX = 2;
const BS = 4; // 공간 해시 버킷 크기

export type Shape = { shape?: 'circle' | 'rect'; x: number; y: number; r: number; x2?: number; y2?: number };
export type Intervention =
  | ({ kind: 'terrain'; value: 0 | 1 | 2 } & Shape)
  | ({ kind: 'biome'; plant?: number; zone?: number } & Shape)
  | ({ kind: 'food'; delta: number } & Shape)
  | { kind: 'global'; sun?: number; meanTemp?: number; seasonAmp?: number; seasonPeriod?: number }
  | ({ kind: 'meteor' } & Shape)
  | ({ kind: 'plague' } & Shape)
  | { kind: 'climate'; delta: number; duration: number };
// 사용자가 쓸 수 있는 개입 종류는 환경에 대한 것뿐이다 (개체 편집/이동/복제/제거/소환 없음)
export const INTERVENTION_KINDS = ['terrain', 'biome', 'food', 'global', 'meteor', 'plague', 'climate'] as const;
export interface LogEntry { tick: number; iv: Intervention }
export interface EventRec { tick: number; kind: string; info?: string }

export class Ind {
  id = 0; x = 0; y = 0; a = 0; v = 0; reserve = 0; structE = 0; age = 0;
  genome!: Float32Array; t = new Traits();
  species = -1; speciesB = -1; inf = 0; alive = true; birth = 0;
  oTurn = 0; oAcc = 0; oBite = 0; oRep = 0; oMate = 0; oGuard = 0; oRest = 0; hurt = 0; mode = 0; mated = false; rec = 0; // rec: 짝 찾는 중 남은 틱
}

export interface SpeciesRec {
  id: number; parent: number; born: number; died: number; peak: number; count: number;
  centroid: Float32Array | null;
}

// 거리순 정렬된 셀 오프셋 (시야 탐색용)
const MAXV = 12;
const OFF_X: number[] = [], OFF_Y: number[] = [], OFF_D: number[] = [];
{
  const l: [number, number, number][] = [];
  for (let dy = -MAXV; dy <= MAXV; dy++) for (let dx = -MAXV; dx <= MAXV; dx++) {
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= MAXV) l.push([dx, dy, d]);
  }
  l.sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
  for (const [dx, dy, d] of l) { OFF_X.push(dx); OFF_Y.push(dy); OFF_D.push(d); }
}
const OFF_N = OFF_X.length;

export const COST_NAMES = ['기초대사', '이동', '시야', '체온조절', '뇌', '행동/번식시도', '감염 추가'];

export class World {
  cfg: Config;
  rng: Rng;
  tick = 0;
  w: number; h: number; n: number;
  terrain: Uint8Array; dom: Uint8Array; zone: Uint8Array;
  sunMul: Float32Array; devast: Uint16Array; pathogen: Float32Array;
  plants: Float64Array[]; soil: Float64Array; corpse: Float64Array;
  inds: Ind[] = [];
  born: Ind[] = [];
  lineage = new Lineage();
  // 환경 전역값 (개입으로 변경)
  sunG: number; meanTempG: number; seasonAmpG: number; seasonPeriodG: number;
  climShift = 0; climTarget = 0; climRate = 0;
  // 장부
  cumIn = 0; cumOut = 0; tickIn = 0; tickOut = 0;
  costs = new Float64Array(7);
  cumCosts = new Float64Array(7);
  // 카운터 (누적)
  cnt = { births: 0, sexBirths: 0, asexBirths: 0, starved: 0, eaten: 0, disease: 0, meteor: 0, aged: 0, tempDeaths: 0, habitat: 0, matings: 0, matingFails: 0, restarts: 0 };
  // 종
  spA: SpeciesRec[] = []; nextSpA = 0; spB: SpeciesRec[] = []; nextSpB = 0;
  // 개입/이벤트
  log: LogEntry[] = [];
  pending: LogEntry[] = [];
  events: EventRec[] = [];
  onBeforeIntervention: ((e: LogEntry) => void) | null = null;
  history: { cols: string[]; rows: number[][] } = { cols: [], rows: [] };
  spHist: [number, number[]][] = [];
  hists: Record<string, number[]> = {};
  dead = false; // 재시작조차 불가능한 완전 전멸
  // 스크래치
  private inp = new Float64Array(NIN); private hid = new Float64Array(NH); private out = new Float64Array(NOUT);
  private bStart = new Int32Array(1); private bItems = new Int32Array(1);
  private nbx: number; private nby: number;
  private order = new Int32Array(0);
  private tmpG = new Float32Array(G); private tmpT = new Traits();
  private zoneTemp = [0, 0, 0]; private resp = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  seasonSin = 0;

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    this.w = cfg.w; this.h = cfg.h; this.n = cfg.w * cfg.h;
    const n = this.n;
    this.terrain = new Uint8Array(n); this.dom = new Uint8Array(n); this.zone = new Uint8Array(n).fill(1);
    this.sunMul = new Float32Array(n).fill(1); this.devast = new Uint16Array(n); this.pathogen = new Float32Array(n);
    this.plants = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    this.soil = new Float64Array(n); this.corpse = new Float64Array(n);
    this.sunG = cfg.sun; this.meanTempG = cfg.meanTemp; this.seasonAmpG = cfg.seasonAmp; this.seasonPeriodG = cfg.seasonPeriod;
    this.nbx = Math.ceil(this.w / BS); this.nby = Math.ceil(this.h / BS);
    this.bStart = new Int32Array(this.nbx * this.nby + 1);
  }

  static create(over: Partial<Config> = {}): World {
    const cfg = defaultConfig(over);
    const w = new World(cfg);
    w.generate();
    const founders = cfg.founders ?? [{ preset: 'herb', count: cfg.initPop }];
    let total = 0;
    for (const f of founders) total += w.seedIndividuals(f.count, true, f.preset);
    cfg.initPop = Math.max(total, cfg.founders ? 0 : cfg.initPop); // 재시작 규모 기준
    return w;
  }

  // ───────────── 세계 생성 ─────────────
  private noiseField(scale: number): Float32Array {
    const { w, h, rng } = this;
    const lw = Math.ceil(w / scale) + 2, lh = Math.ceil(h / scale) + 2;
    const lat = new Float32Array(lw * lh);
    for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
    const f = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = x / scale, gy = y / scale; const x0 = Math.floor(gx), y0 = Math.floor(gy);
      let fx = gx - x0, fy = gy - y0; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const a = lat[y0 * lw + x0], b = lat[y0 * lw + x0 + 1], c = lat[(y0 + 1) * lw + x0], d = lat[(y0 + 1) * lw + x0 + 1];
      f[y * w + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
    return f;
  }

  generate() {
    const { cfg, w, h, n } = this;
    const nt1 = this.noiseField(18), nt2 = this.noiseField(14), nd = this.noiseField(26), nz = this.noiseField(20);
    for (let i = 0; i < n; i++) {
      let t = T_PLAIN;
      if (cfg.genTerrain) { if (nt1[i] < cfg.waterLevel) t = T_WATER; else if (nt2[i] > 0.82) t = T_MOUNTAIN; }
      this.terrain[i] = t;
      if (cfg.features.biomes) {
        this.dom[i] = Math.min(2, Math.floor(nd[i] * 3));
        const y = Math.floor(i / w);
        const lat = (y / h) * 0.7 + nz[i] * 0.3;
        this.zone[i] = Math.min(2, Math.floor(lat * 3));
      } else { this.dom[i] = 0; this.zone[i] = 1; }
      this.soil[i] = cfg.soilInit;
      if (t === T_PLAIN) this.plants[this.dom[i]][i] = cfg.pMax * 0.4;
      else if (t === T_WATER) this.plants[2][i] = cfg.pMax * 0.4; // 수초
    }
  }

  // 개체 N마리를 만든다. 에너지는 식물 재고에서 이전 (외부 생성 없음).
  seedIndividuals(count: number, founder: boolean, preset = 'herb'): number {
    const cfg = this.cfg; const rng = this.rng;
    if (count <= 0) return 0;
    let plain: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.terrain[i] === T_PLAIN) plain.push(i);
    let waterCells: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.terrain[i] === T_WATER) waterCells.push(i);
    if (founder && preset === 'herb') { // 기본 창시 집단은 식물 A 우세·온난 지역에서 시작 (창시자 효과)
      const home = plain.filter((i) => this.dom[i] === 0 && this.zone[i] === 1);
      if (home.length >= 100) plain = home;
    }
    let stock = 0; for (let s = 0; s < NPLANT; s++) for (let i = 0; i < this.n; i++) stock += this.plants[s][i];
    const created: Ind[] = [];
    let base = founder ? founderBrain(rng) : null;
    let need = 0;
    if (!plain.length && !waterCells.length) return 0;
    for (let k = 0; k < count; k++) {
      if (founder && k > 0 && k % 20 === 0) base = founderBrain(rng); // 20마리마다 다른 원형 뇌 (한 번의 운에 전멸하지 않도록 변이 확보)
      const g = founder ? presetGenome(preset, rng, base!) : randomGenome(rng);
      const ind = new Ind();
      ind.genome = g; ind.t.decode(g, cfg);
      const pool = ind.t.aq > 0.5 && waterCells.length ? waterCells : plain.length ? plain : waterCells;
      const c = pool[rng.int(pool.length)];
      ind.x = (c % this.w) + rng.next() * 0.999; ind.y = Math.floor(c / this.w) + rng.next() * 0.999;
      ind.a = rng.next() * TAU;
      ind.structE = ind.t.structE; ind.reserve = ind.t.maxReserve * 0.7;
      const e = ind.structE + ind.reserve;
      if (need + e > stock * 0.6) break; // 식물 재고의 60%까지만 사용
      need += e; created.push(ind);
    }
    if (!created.length) return 0;
    // 식물에서 비례 차감
    const f = 1 - need / stock;
    for (let s = 0; s < NPLANT; s++) { const p = this.plants[s]; for (let i = 0; i < this.n; i++) p[i] *= f; }
    for (const ind of created) {
      ind.id = this.lineage.add(-1, -1, this.tick, -1); ind.birth = this.tick;
      this.inds.push(ind);
    }
    return created.length;
  }

  // ───────────── 환경 ─────────────
  tempAt(c: number): number {
    return this.zoneTemp[this.zone[c]];
  }
  private updateEnv() {
    const cfg = this.cfg;
    this.seasonSin = cfg.features.seasons ? Math.sin((TAU * this.tick) / this.seasonPeriodG) : 0;
    if (this.climShift !== this.climTarget) {
      const d = this.climTarget - this.climShift;
      if (Math.abs(d) <= Math.abs(this.climRate)) this.climShift = this.climTarget; else this.climShift += this.climRate;
    }
    const amp = cfg.features.seasons ? this.seasonAmpG : 0;
    for (let z = 0; z < 3; z++) {
      const T = this.meanTempG + this.climShift + (cfg.features.biomes ? cfg.zoneOffset[z] : 0) + amp * this.seasonSin;
      this.zoneTemp[z] = T;
      for (let s = 0; s < NPLANT; s++) {
        const d = (T - cfg.plantTempOpt[s]) / cfg.plantTempWidth;
        this.resp[z][s] = Math.exp(-d * d);
      }
    }
  }

  totalEnergy(): { plants: number; soil: number; corpse: number; bodies: number; total: number } {
    let plants = 0, soil = 0, corpse = 0, bodies = 0;
    for (let s = 0; s < NPLANT; s++) { const p = this.plants[s]; for (let i = 0; i < this.n; i++) plants += p[i]; }
    for (let i = 0; i < this.n; i++) { soil += this.soil[i]; corpse += this.corpse[i]; }
    for (const ind of this.inds) bodies += ind.reserve + ind.structE;
    return { plants, soil, corpse, bodies, total: plants + soil + corpse + bodies };
  }

  // ───────────── 개입 ─────────────
  schedule(tick: number, iv: Intervention) {
    this.pending.push({ tick, iv });
    this.pending.sort((a, b) => a.tick - b.tick);
  }
  intervene(iv: Intervention) { this.schedule(this.tick, iv); }

  private cellsIn(s: Shape, fn: (c: number, x: number, y: number) => void) {
    const { w, h } = this;
    if (s.shape === 'rect') {
      const x0 = Math.max(0, Math.floor(Math.min(s.x, s.x2!))), x1 = Math.min(w - 1, Math.floor(Math.max(s.x, s.x2!)));
      const y0 = Math.max(0, Math.floor(Math.min(s.y, s.y2!))), y1 = Math.min(h - 1, Math.floor(Math.max(s.y, s.y2!)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(y * w + x, x, y);
    } else {
      const r = s.r;
      const x0 = Math.max(0, Math.floor(s.x - r)), x1 = Math.min(w - 1, Math.ceil(s.x + r));
      const y0 = Math.max(0, Math.floor(s.y - r)), y1 = Math.min(h - 1, Math.ceil(s.y + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - s.x, dy = y + 0.5 - s.y;
        if (dx * dx + dy * dy <= r * r) fn(y * w + x, x, y);
      }
    }
  }
  private inShape(s: Shape, px: number, py: number): boolean {
    if (s.shape === 'rect') {
      return px >= Math.min(s.x, s.x2!) && px <= Math.max(s.x, s.x2!) && py >= Math.min(s.y, s.y2!) && py <= Math.max(s.y, s.y2!);
    }
    const dx = px - s.x, dy = py - s.y; return dx * dx + dy * dy <= s.r * s.r;
  }

  private applyIv(iv: Intervention) {
    const cfg = this.cfg;
    switch (iv.kind) {
      case 'terrain':
        this.cellsIn(iv, (c) => {
          if (iv.value !== T_PLAIN) { // 식물은 흙으로 되돌아간다 (에너지 보존). 물에서는 수초(식물 C)만 남는다
            for (let s = 0; s < (iv.value === T_WATER ? 2 : NPLANT); s++) { this.soil[c] += this.plants[s][c]; this.plants[s][c] = 0; }
          }
          this.terrain[c] = iv.value;
        });
        break;
      case 'biome':
        this.cellsIn(iv, (c) => {
          if (iv.plant !== undefined) this.dom[c] = iv.plant;
          if (iv.zone !== undefined) this.zone[c] = iv.zone;
        });
        break;
      case 'food':
        this.cellsIn(iv, (c) => { this.sunMul[c] = Math.min(4, Math.max(0, this.sunMul[c] + iv.delta)); });
        break;
      case 'global':
        if (iv.sun !== undefined) this.sunG = iv.sun;
        if (iv.meanTemp !== undefined) this.meanTempG = iv.meanTemp;
        if (iv.seasonAmp !== undefined) this.seasonAmpG = iv.seasonAmp;
        if (iv.seasonPeriod !== undefined) this.seasonPeriodG = Math.max(50, iv.seasonPeriod);
        break;
      case 'meteor':
        for (const ind of this.inds) if (ind.alive && this.inShape(iv, ind.x, ind.y)) this.kill(ind, CAUSE.METEOR);
        this.cellsIn(iv, (c) => {
          for (let s = 0; s < NPLANT; s++) { this.corpse[c] += this.plants[s][c]; this.plants[s][c] = 0; }
          this.devast[c] = cfg.devastTicks;
        });
        this.inds = this.inds.filter((i) => i.alive);
        break;
      case 'plague':
        this.cellsIn(iv, (c) => { this.pathogen[c] = 5; });
        break;
      case 'climate': {
        this.climTarget = this.climTarget + iv.delta;
        this.climRate = (this.climTarget - this.climShift) / Math.max(1, iv.duration);
        break;
      }
    }
  }

  // ───────────── 개체 제거/출생 ─────────────
  private cellOf(x: number, y: number) { return (y | 0) * this.w + (x | 0); }

  kill(ind: Ind, cause: number) {
    if (!ind.alive) return;
    ind.alive = false;
    const c = this.cellOf(ind.x, ind.y);
    this.corpse[c] += ind.structE + (ind.reserve > 0 ? ind.reserve : 0);
    ind.structE = 0; ind.reserve = 0; // 에너지는 전부 사체로 이전됨
    this.lineage.die(ind.id, this.tick, cause);
    if (cause === CAUSE.STARVED) this.cnt.starved++;
    else if (cause === CAUSE.EATEN) this.cnt.eaten++;
    else if (cause === CAUSE.DISEASE) this.cnt.disease++;
    else if (cause === CAUSE.METEOR) this.cnt.meteor++;
    else if (cause === CAUSE.AGE) this.cnt.aged++;
    else if (cause === CAUSE.TEMP) this.cnt.tempDeaths++;
    else if (cause === CAUSE.HABITAT) this.cnt.habitat++;
  }

  private pay(ind: Ind, amount: number, kind: number) {
    const a = amount < ind.reserve ? amount : ind.reserve > 0 ? ind.reserve : 0;
    ind.reserve -= a;
    this.tickOut += a; this.costs[kind] += a;
  }

  private ready(ind: Ind) {
    return ind.age >= this.cfg.matureAge && ind.reserve >= ind.t.thr * ind.t.maxReserve;
  }

  private spawnChild(pa: Ind, pb: Ind | null, g: Float32Array, tc: Traits, childRes: number) {
    const c = new Ind();
    c.genome = g.slice(); c.t.decode(c.genome, this.cfg);
    // 부모와 같은 종류의 지형 셀에 태어난다 (물가에서 새끼가 뭍으로 떨어지지 않게)
    const pt = this.terrain[this.cellOf(pa.x, pa.y)];
    c.x = pa.x; c.y = pa.y;
    for (let k = 0; k < 6; k++) {
      const ang = this.rng.next() * TAU;
      const nx = Math.min(this.w - 0.001, Math.max(0, pa.x + Math.cos(ang) * 0.6));
      const ny = Math.min(this.h - 0.001, Math.max(0, pa.y + Math.sin(ang) * 0.6));
      if (this.terrain[this.cellOf(nx, ny)] === pt) { c.x = nx; c.y = ny; break; }
    }
    c.a = this.rng.next() * TAU;
    c.structE = c.t.structE; c.reserve = childRes;
    c.species = pa.species; c.speciesB = pa.speciesB; c.birth = this.tick;
    c.id = this.lineage.add(pa.id, pb ? pb.id : -1, this.tick, pa.species);
    this.born.push(c);
    this.cnt.births++;
    if (pb) this.cnt.sexBirths++; else this.cnt.asexBirths++;
  }

  // 한배 새끼 수(clutch): 투자액 T를 n마리가 나눠 갖는다. 새끼당 몫이 구조 에너지에 못 미치면 마릿수를 줄인다.
  private brood(parents: Ind[], n: number, T: number, mutSigma: number, make: (g: Float32Array) => void) {
    const cfg = this.cfg;
    let nn = n;
    const refStruct = parents[0].t.structE;
    while (nn > 1 && T / nn < refStruct * 1.3) nn--;
    const share = T / nn; let spent = 0;
    for (let k = 0; k < nn; k++) {
      if (this.inds.length + this.born.length >= cfg.maxPop) break;
      const g = this.tmpG; make(g); mutate(g, mutSigma, this.rng);
      const tc = this.tmpT.decode(g, cfg);
      if (share < tc.structE * 1.15) break;
      const childRes = Math.min(share - tc.structE, tc.maxReserve);
      spent += tc.structE + childRes;
      this.spawnChild(parents[0], parents[1] ?? null, g, tc, childRes);
    }
    return spent;
  }

  private birthAsex(p: Ind) {
    if (this.inds.length + this.born.length >= this.cfg.maxPop) return;
    if (p.t.give * p.reserve < p.t.structE * 1.05) return;
    const T = p.t.give * p.reserve;
    p.reserve -= this.brood([p], p.t.clutchMax, T, p.t.mut, (g) => g.set(p.genome));
  }

  private birthSex(a: Ind, b: Ind, d = 0) {
    if (this.inds.length + this.born.length >= this.cfg.maxPop) return;
    const Ta = 0.5 * a.t.give * a.reserve, Tb = 0.5 * b.t.give * b.reserve; // 양쪽이 분담
    const T = Ta + Tb;
    const n = Math.max(1, Math.floor((a.t.clutchMax + b.t.clutchMax) / 2));
    const spent = this.brood([a, b], n, T, 0.5 * (a.t.mut + b.t.mut), (g) => crossover(g, a.genome, b.genome, this.rng));
    if (spent > 0) { const sc = spent / T; a.reserve -= Ta * sc; b.reserve -= Tb * sc; }
    void d;
  }

  // ───────────── 감각 ─────────────
  sense(ind: Ind, inp: Float64Array, noise: boolean, hashed = true): number {
    const cfg = this.cfg, t = ind.t, w = this.w, h = this.h;
    inp.fill(0);
    const R = t.vis, ca = Math.cos(ind.a), sa = Math.sin(ind.a);
    const full = t.ang >= TAU - 1e-6, cosHalf = Math.cos(t.ang * 0.5);
    const ix = ind.x | 0, iy = ind.y | 0;
    const p0 = this.plants[0], p1 = this.plants[1], p2 = this.plants[2], corpse = this.corpse;
    let fp = false, fc = false;
    const Rm = R > t.smellR ? R : t.smellR; // 후각: 시야 밖(전방위)에서도 감지
    for (let k = 0; k < OFF_N; k++) {
      const d = OFF_D[k]; if (d > Rm) break;
      const dx = OFF_X[k], dy = OFF_Y[k];
      if (d > t.smellR && (d > R || (k > 0 && !full && dx * ca + dy * sa < d * cosHalf))) continue;
      const cx = ix + dx, cy = iy + dy;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      const c = cy * w + cx;
      if (!fp) {
        const a0 = p0[c], a1 = p1[c], a2 = p2[c];
        if (a0 + a1 + a2 >= t.foodThr) {
          fp = true;
          let rel = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx) - ind.a; rel -= TAU * Math.round(rel / TAU);
          inp[0] = rel / Math.PI; inp[1] = 1 - d / Rm;
          inp[2] = a0 >= a1 && a0 >= a2 ? -1 : a1 >= a2 ? 0 : 1;
        }
      }
      if (!fc && corpse[c] >= t.foodThr) {
        fc = true;
        let rel = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx) - ind.a; rel -= TAU * Math.round(rel / TAU);
        inp[3] = rel / Math.PI; inp[4] = 1 - d / Rm;
      }
      if (fp && fc) break;
    }
    // 가장 가까운 개체 (시야 안)
    const Rn = R > t.hearR ? R : t.hearR, hear2 = t.hearR * t.hearR, R2 = R * R;
    let best = -1, bd2 = Rn * Rn;
    if (hashed) {
      const nbx = this.nbx, nby = this.nby;
      const bx0 = Math.max(0, Math.floor((ind.x - Rn) / BS)), bx1 = Math.min(nbx - 1, Math.floor((ind.x + Rn) / BS));
      const by0 = Math.max(0, Math.floor((ind.y - Rn) / BS)), by1 = Math.min(nby - 1, Math.floor((ind.y + Rn) / BS));
      const inds = this.inds;
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
        const b = by * nbx + bx;
        for (let q = this.bStart[b], e = this.bStart[b + 1]; q < e; q++) {
          const o = inds[this.bItems[q]];
          if (o === ind || !o.alive) continue;
          const dx = o.x - ind.x, dy = o.y - ind.y, d2 = dx * dx + dy * dy;
          if (d2 >= bd2) continue;
          // 청각: 시야 밖이라도 hearR 안이면 감지
          if (d2 > hear2 && (d2 > R2 || (!full && dx * ca + dy * sa < Math.sqrt(d2) * cosHalf))) continue;
          bd2 = d2; best = this.bItems[q];
        }
      }
    }
    if (best >= 0) {
      const o = this.inds[best];
      const dx = o.x - ind.x, dy = o.y - ind.y;
      let rel = Math.atan2(dy, dx) - ind.a; rel -= TAU * Math.round(rel / TAU);
      inp[5] = rel / Math.PI; inp[6] = 1 - Math.sqrt(bd2) / Rn;
      inp[7] = (o.t.size - 0.5) / 1.25 - 1; inp[8] = o.t.hue * 2 - 1;
      const gd = genomeDistance(ind.genome, o.genome);
      inp[9] = Math.max(0, 1 - gd / cfg.dmax);
      inp[16] = o.t.claw * 2 - 1;
    }
    const c0 = this.cellOf(ind.x, ind.y);
    inp[10] = ind.reserve / t.maxReserve;
    inp[11] = (this.tempAt(c0) + 10) / 25 - 1;
    inp[12] = this.terrain[c0] * 0.5;
    inp[13] = noise ? this.rng.next() * 2 - 1 : 0;
    inp[14] = Math.sin(ind.age * t.osc);
    inp[15] = ind.hurt;
    { const dd = (t.tOpt - this.tempAt(c0)) / 20; inp[17] = dd < -1 ? -1 : dd > 1 ? 1 : dd; }
    return best;
  }

  // 인스펙터용: 현재 상태에서 뇌 활성 재계산 (난수 소비 없음, 해시 필요)
  inspectBrain(ind: Ind) {
    this.buildHash();
    const inp = new Float64Array(NIN), hid = new Float64Array(NH), out = new Float64Array(NOUT);
    this.sense(ind, inp, false);
    brainForward(ind.genome, inp, hid, out);
    return { inp: Array.from(inp), hid: Array.from(hid), out: Array.from(out) };
  }

  buildHash() {
    const n = this.inds.length, nb = this.nbx * this.nby;
    if (this.bItems.length < n) this.bItems = new Int32Array(Math.max(n * 2, 1024));
    const bs = this.bStart; bs.fill(0);
    const bucket = (ind: Ind) => Math.min(this.nby - 1, (ind.y / BS) | 0) * this.nbx + Math.min(this.nbx - 1, (ind.x / BS) | 0);
    for (let i = 0; i < n; i++) bs[bucket(this.inds[i]) + 1]++;
    for (let b = 0; b < nb; b++) bs[b + 1] += bs[b];
    const fill = this.tmpFill(nb);
    for (let b = 0; b < nb; b++) fill[b] = bs[b];
    for (let i = 0; i < n; i++) this.bItems[fill[bucket(this.inds[i])]++] = i;
  }
  private fillBuf = new Int32Array(0);
  private tmpFill(nb: number) { if (this.fillBuf.length < nb) this.fillBuf = new Int32Array(nb); return this.fillBuf; }

  // ───────────── 한 틱 ─────────────
  step() {
    const cfg = this.cfg, rng = this.rng, F = cfg.features;
    while (this.pending.length && this.pending[0].tick <= this.tick) {
      const e = this.pending.shift()!;
      if (this.onBeforeIntervention) this.onBeforeIntervention(e);
      this.applyIv(e.iv);
      this.log.push({ tick: this.tick, iv: e.iv });
    }
    this.updateEnv();
    this.tickIn = 0; this.tickOut = 0; this.costs.fill(0);
    this.born = [];
    const inds = this.inds;
    const n = inds.length;
    this.buildHash();

    // 1) 생각: 감각 → 뇌 → 출력
    for (let i = 0; i < n; i++) {
      const ind = inds[i];
      ind.mated = false; ind.mode = MODE_NONE;
      if (F.brain) {
        this.sense(ind, this.inp, true);
        brainForward(ind.genome, this.inp, this.hid, this.out);
        const o = this.out;
        ind.oTurn = o[0]; ind.oAcc = o[1]; ind.oBite = o[2]; ind.oRep = o[3]; ind.oMate = o[4]; ind.oGuard = o[5]; ind.oRest = o[6];
      } else { // 귀무 모형: 순수 난수 출력
        ind.oTurn = rng.next() * 2 - 1; ind.oAcc = rng.next() * 2 - 1; ind.oBite = rng.next() * 2 - 1;
        ind.oRep = rng.next() * 2 - 1; ind.oMate = rng.next() * 2 - 1;
        ind.oGuard = rng.next() * 2 - 1; ind.oRest = rng.next() * 2 - 1;
      }
      if (F.reproduce) {
        if (ind.rec > 0) { // 짝 찾기 상태 유지: 신호(출력)가 켜진 틱에만 광고
          if (!this.ready(ind)) ind.rec = 0;
          else if (ind.oMate > 0) ind.mode = MODE_SEX;
        } else if (ind.oRep > 0 && this.ready(ind)) {
          if (F.sexual && rng.next() < ind.t.sex) ind.rec = 40; // 유성 모드 진입: 최대 40틱 짝 탐색 (그동안 무성 번식 안 함)
          else ind.mode = MODE_ASEX;
        }
      }
    }

    // 2) 행동 (무작위 순서)
    if (this.order.length < n) this.order = new Int32Array(n * 2);
    const order = this.order;
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = n - 1; i > 0; i--) { const j = rng.int(i + 1); const t = order[i]; order[i] = order[j]; order[j] = t; }
    for (let oi = 0; oi < n; oi++) this.act(inds[order[oi]]);

    // 3) 감염
    this.infectionPass();

    // 4) 식물/토양/사체
    this.ecologyPass();

    // 5) 정리
    this.inds = this.inds.filter((i) => i.alive);
    for (const c of this.born) this.inds.push(c);
    this.born = [];
    this.cumIn += this.tickIn; this.cumOut += this.tickOut;
    for (let k = 0; k < 7; k++) this.cumCosts[k] += this.costs[k];
    this.tick++;

    if (this.inds.length === 0 && !this.dead && cfg.initPop > 0) this.restart();
  }

  private restart() {
    const k = this.seedIndividuals(Math.max(20, this.cfg.initPop), false);
    this.cnt.restarts++;
    this.events.push({ tick: this.tick, kind: 'extinction', info: k > 0 ? `랜덤 게놈 ${k}마리로 재시작` : '재시작 불가(식물 없음)' });
    if (k === 0) this.dead = true;
  }

  private act(ind: Ind) {
    if (!ind.alive) return;
    const cfg = this.cfg, t = ind.t;
    ind.age++;
    // 이동
    ind.a += ind.oTurn * t.turnMax;
    const c0 = this.cellOf(ind.x, ind.y);
    const terr = this.terrain[c0];
    const Tloc = this.tempAt(c0);
    // 겨울잠(환경이 추울 때, 유전자) / 휴식·웅크림(뇌 출력). 겨울잠·휴식 중엔 움직이지도 먹지도 번식하지도 못한다.
    const torpor = t.hiber > 0.05 && t.tOpt - Tloc > 14 - 12 * t.hiber;
    const resting = ind.oRest > 0;
    const guard = ind.oGuard > 0;
    const still = torpor || resting;
    let v = ind.v * 0.8 + ind.oAcc * t.vmax * 0.4;
    if (v < 0) v = 0; else if (v > t.vmax) v = t.vmax;
    if (still) v = 0; else if (guard) v *= 0.3;
    ind.v = v;
    if (ind.hurt > 0.001) ind.hurt *= 0.9; else ind.hurt = 0;
    const spm = terr === T_WATER ? t.spWater : terr === T_PLAIN ? t.spLand : cfg.speedMul[2];
    const cstm = terr === T_WATER ? t.cWater : terr === T_PLAIN ? t.cLand : cfg.costMul[2];
    const sp = v * spm;
    let nx = ind.x + Math.cos(ind.a) * sp, ny = ind.y + Math.sin(ind.a) * sp;
    if (nx < 0 || nx >= this.w) { ind.a = Math.PI - ind.a; nx = nx < 0 ? 0 : this.w - 0.001; }
    if (ny < 0 || ny >= this.h) { ind.a = -ind.a; ny = ny < 0 ? 0 : this.h - 0.001; }
    ind.x = nx; ind.y = ny;
    // 대사 (전부 열손실)
    const dT = Tloc - t.tOpt;
    const move = cfg.cMove * t.mass * t.moveMul * v * v * cstm;
    const exT = Math.abs(dT) > t.tolW ? Math.abs(dT) - t.tolW : 0; // 허용폭 안은 무료
    const therm = cfg.cTherm * exT * exT * t.m075 * (1 - 0.6 * t.insul);
    let base = t.basal + move + t.visCost + therm + t.brainCost;
    if (guard) base += cfg.cAct * t.m075;
    if (torpor) base *= 1 - 0.8 * t.hiber;
    if (resting) base *= 0.6;
    const extra = ind.inf > 0 ? base * cfg.infMetaMul : 0;
    const total = base + extra;
    const paid = total < ind.reserve ? total : ind.reserve > 0 ? ind.reserve : 0;
    ind.reserve -= paid; this.tickOut += paid; // 대사 열손실 = 시스템 유출
    if (total > 0) {
      const f = paid / total;
      this.costs[0] += t.basal * f; this.costs[1] += move * f; this.costs[2] += t.visCost * f;
      this.costs[3] += therm * f; this.costs[4] += t.brainCost * f; this.costs[6] += extra * f;
    }
    if (ind.reserve <= 0) { this.kill(ind, ind.inf > 0 ? CAUSE.DISEASE : CAUSE.STARVED); return; }
    if (this.mortality(ind, terr, dT)) return;

    // 먹기/공격
    if (ind.oBite > 0 && !still) {
      this.pay(ind, cfg.cAct * t.m075, 5);
      if (ind.reserve <= 0) { this.kill(ind, ind.inf > 0 ? CAUSE.DISEASE : CAUSE.STARVED); return; }
      this.bite(ind);
    }

    // 번식
    if (still) { /* 번식 불가 */ }
    else if (ind.mode === MODE_ASEX) {
      if (this.ready(ind)) this.birthAsex(ind);
    } else if (ind.mode === MODE_SEX && !ind.mated) {
      this.pay(ind, cfg.cSignal, 5);
      this.tryMate(ind);
    }
    if (ind.rec > 0) ind.rec = ind.mated ? 0 : ind.rec - 1;
    if (ind.reserve <= 0) this.kill(ind, ind.inf > 0 ? CAUSE.DISEASE : CAUSE.STARVED);
  }

  // 에너지와 무관한 사망 요인 (사망 시 몸은 전부 사체로 남아 에너지는 보존된다)
  private mortality(ind: Ind, terr: number, dT: number): boolean {
    const cfg = this.cfg, t = ind.t, rng = this.rng;
    let h = 0, cause = 0;
    if (ind.age > t.lifespan) { const x = (ind.age - t.lifespan) / t.lifespan; const p = Math.min(1, cfg.ageHazard * x * x); h = p; cause = CAUSE.AGE; }
    const ex = Math.abs(dT) - t.tempLethal;
    if (ex > 0) { const p = Math.min(1, cfg.tempHazard * ex); if (p > h) { h = p; cause = CAUSE.TEMP; } }
    if (terr === T_PLAIN && t.aq > 0.3) { const p = cfg.landHazard * (t.aq - 0.3) / 0.7; if (p > h) { h = p; cause = CAUSE.HABITAT; } }
    else if (terr === T_WATER && t.aq < 0.7) { const p = cfg.waterHazard * (0.7 - t.aq) / 0.7; if (p > h) { h = p; cause = CAUSE.HABITAT; } }
    if (h > 0 && rng.next() < h) { this.kill(ind, cause); return true; }
    return false;
  }

  private bite(ind: Ind) {
    const cfg = this.cfg, t = ind.t;
    const mx = ind.x + Math.cos(ind.a) * (t.radius + 0.1), my = ind.y + Math.sin(ind.a) * (t.radius + 0.1);
    // 입 앞에 개체가 있으면 공격
    if (cfg.features.attack) {
      let victim: Ind | null = null, bd = 1e9;
      const nbx = this.nbx, nby = this.nby;
      const bx0 = Math.max(0, Math.floor((mx - 3) / BS)), bx1 = Math.min(nbx - 1, Math.floor((mx + 3) / BS));
      const by0 = Math.max(0, Math.floor((my - 3) / BS)), by1 = Math.min(nby - 1, Math.floor((my + 3) / BS));
      const inds = this.inds;
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
        const b = by * nbx + bx;
        for (let q = this.bStart[b], e = this.bStart[b + 1]; q < e; q++) {
          const o = inds[this.bItems[q]];
          if (o === ind || !o.alive) continue;
          const dx = o.x - mx, dy = o.y - my, d = Math.sqrt(dx * dx + dy * dy) - o.t.radius;
          if (d < 0.15 && d < bd) { bd = d; victim = o; }
        }
      }
      if (victim) {
        const shield = (1 + 2 * victim.t.armor) * (victim.oGuard > 0 ? 2 : 1); // 갑옷, 웅크림이 피해를 줄인다
        const dmg = Math.min(victim.reserve > 0 ? victim.reserve : 0, (t.attackPow * ind.oBite) / shield);
        victim.reserve -= dmg;
        victim.hurt = Math.min(1, victim.hurt + (5 * dmg) / victim.t.maxReserve);
        if (victim.t.toxin > 0.01) this.pay(ind, cfg.toxinK * victim.t.toxin * dmg, 5); // 독: 공격자 열손실
        const room = t.maxReserve - ind.reserve;
        const gain = Math.min(dmg * t.eff[3], room > 0 ? room : 0);
        ind.reserve += gain;
        this.corpse[this.cellOf(victim.x, victim.y)] += dmg - gain; // 소화 못한 몫은 사체로
        this.pay(ind, cfg.cAttack * dmg, 5); // 공격 노력(근육 열손실): 소화효율이 낮은 개체에겐 손해
        if (victim.reserve <= 0) this.kill(victim, CAUSE.EATEN);
        return;
      }
    }
    // 바닥의 음식
    const c = this.cellOf(mx < 0 ? 0 : mx >= this.w ? this.w - 0.001 : mx, my < 0 ? 0 : my >= this.h ? this.h - 0.001 : my);
    const a0 = this.plants[0][c], a1 = this.plants[1][c], a2 = this.plants[2][c], ac = this.corpse[c];
    const A = a0 + a1 + a2 + ac;
    if (A <= 1e-9) return;
    const cap = t.biteCap * ind.oBite;
    let sc = cap >= A ? 1 : cap / A;
    let gain = (a0 * t.eff[0] + a1 * t.eff[1] + a2 * t.eff[2] + ac * t.eff[3]) * sc;
    const room = t.maxReserve - ind.reserve;
    if (room <= 0) return;
    if (gain > room) { sc *= room / gain; gain = room; }
    const take = A * sc;
    this.plants[0][c] -= a0 * sc; this.plants[1][c] -= a1 * sc; this.plants[2][c] -= a2 * sc; this.corpse[c] -= ac * sc;
    ind.reserve += gain;
    this.soil[c] += take - gain; // 소화되지 않은 몫은 배설 → 토양
  }

  private tryMate(ind: Ind) {
    const cfg = this.cfg, t = ind.t;
    let partner: Ind | null = null, bd = 1e9;
    const nbx = this.nbx, nby = this.nby, inds = this.inds;
    const bx0 = Math.max(0, Math.floor((ind.x - 4) / BS)), bx1 = Math.min(nbx - 1, Math.floor((ind.x + 4) / BS));
    const by0 = Math.max(0, Math.floor((ind.y - 4) / BS)), by1 = Math.min(nby - 1, Math.floor((ind.y + 4) / BS));
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      const b = by * nbx + bx;
      for (let q = this.bStart[b], e = this.bStart[b + 1]; q < e; q++) {
        const o = inds[this.bItems[q]];
        if (o === ind || !o.alive || o.mated || o.mode !== MODE_SEX) continue;
        const dx = o.x - ind.x, dy = o.y - ind.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > t.radius + o.t.radius + 1.5 || d >= bd) continue;
        if (!this.ready(o)) continue;
        // 까다로움: 게놈 거리가 먼 짝은 거른다 (헛수고 방지 ↔ 후보 감소)
        const maxD = cfg.dmax * (1.05 - 0.75 * Math.max(t.picky, o.t.picky));
        if (genomeDistance(ind.genome, o.genome) > maxD) continue;
        bd = d; partner = o;
      }
    }
    if (!partner) return;
    ind.mated = true; partner.mated = true;
    this.pay(ind, cfg.cAttempt, 5); this.pay(partner, cfg.cAttempt, 5);
    const gd = genomeDistance(ind.genome, partner.genome);
    const p = compatProb(gd, cfg.dmax); // 호환성: 거리가 클수록 ↓, 임계치 넘으면 0
    if (p > 0 && this.rng.next() < p) { this.cnt.matings++; this.birthSex(ind, partner); }
    else this.cnt.matingFails++;
    if (partner.reserve <= 0) this.kill(partner, partner.inf > 0 ? CAUSE.DISEASE : CAUSE.STARVED);
  }

  private infectionPass() {
    const cfg = this.cfg, inds = this.inds;
    const nbx = this.nbx, nby = this.nby, rng = this.rng;
    const r2 = cfg.contactR * cfg.contactR;
    // 접촉 전파 (병원체 보유 개체 → 이웃)
    for (let i = 0; i < inds.length; i++) {
      const a = inds[i];
      if (!a.alive || a.inf <= 0) continue;
      const bx0 = Math.max(0, Math.floor((a.x - cfg.contactR - 1.5) / BS)), bx1 = Math.min(nbx - 1, Math.floor((a.x + cfg.contactR + 1.5) / BS));
      const by0 = Math.max(0, Math.floor((a.y - cfg.contactR - 1.5) / BS)), by1 = Math.min(nby - 1, Math.floor((a.y + cfg.contactR + 1.5) / BS));
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
        const b = by * nbx + bx;
        for (let q = this.bStart[b], e = this.bStart[b + 1]; q < e; q++) {
          const o = inds[this.bItems[q]];
          if (o === a || !o.alive || o.inf !== 0) continue;
          const dx = o.x - a.x, dy = o.y - a.y;
          if (dx * dx + dy * dy > r2) continue;
          if (rng.next() < cfg.infBeta * (1 - o.t.res)) o.inf = cfg.infDuration + 1;
        }
      }
    }
    // 환경 병원체 노출 + 타이머
    for (let i = 0; i < inds.length; i++) {
      const o = inds[i];
      if (!o.alive) continue;
      if (o.inf === 0) {
        const pc = this.pathogen[this.cellOf(o.x, o.y)];
        if (pc > 0.01 && rng.next() < Math.min(1, pc * cfg.pathogenDose) * (1 - o.t.res)) o.inf = cfg.infDuration + 1;
      } else if (o.inf > 0) {
        o.inf--; if (o.inf === 0) o.inf = -cfg.infImmune;
      } else o.inf++;
    }
  }

  private ecologyPass() {
    const cfg = this.cfg, n = this.n;
    const [P0, P1, P2] = this.plants; const soil = this.soil, corpse = this.corpse;
    const season = cfg.features.seasons ? 1 + cfg.seasonGrowthAmp * this.seasonSin : 1;
    const nu = cfg.soilShare, pMax = cfg.pMax, sunBase = cfg.sunRate * this.sunG * season;
    const sen = cfg.senescence, dec = cfg.corpseDecay, half = cfg.soilHalf, dv = cfg.devastTicks;
    const pd = cfg.pathogenDecay, off = cfg.offProfile;
    const resp = this.resp;
    let inflow = 0;
    for (let c = 0; c < n; c++) {
      // 사체 분해 → 토양
      const cp = corpse[c];
      if (cp > 0) { const d = cp * dec; corpse[c] = cp - d; soil[c] += d; }
      if (this.pathogen[c] > 0) { this.pathogen[c] *= pd; if (this.pathogen[c] < 0.01) this.pathogen[c] = 0; }
      const tr = this.terrain[c];
      if (tr === T_MOUNTAIN) continue;
      // 노화 → 토양
      const a0 = P0[c], a1 = P1[c], a2 = P2[c];
      let l0 = a0 * sen, l1 = a1 * sen, l2 = a2 * sen;
      let S = soil[c] + l0 + l1 + l2;
      let q0 = a0 - l0, q1 = a1 - l1, q2 = a2 - l2;
      const P = q0 + q1 + q2;
      if (P < pMax) {
        const x = P / pMax;
        let dvf = 1;
        if (this.devast[c] > 0) { dvf = 1 - this.devast[c] / dv; this.devast[c]--; }
        const base = sunBase * this.sunMul[c] * (1 - x) * (0.35 + 0.65 * Math.min(1, 3 * x)) * dvf * (S / (S + half));
        const z = this.zone[c], d = this.dom[c], rz = resp[z];
        let g0 = base * (d === 0 ? 1 : off) * rz[0], g1 = base * (d === 1 ? 1 : off) * rz[1], g2 = base * (d === 2 ? 1 : off) * rz[2];
        if (tr === T_WATER) { g0 = 0; g1 = 0; g2 = base * (rz[2] > 0.6 ? rz[2] : 0.6); } // 수초만 자란다
        let g = g0 + g1 + g2;
        const need = nu * g;
        if (need > S) { const k = S / need; g0 *= k; g1 *= k; g2 *= k; g *= k; }
        q0 += g0; q1 += g1; q2 += g2;
        S -= nu * g; inflow += (1 - nu) * g;
      } else if (this.devast[c] > 0) this.devast[c]--;
      P0[c] = q0; P1[c] = q1; P2[c] = q2; soil[c] = S;
    }
    this.tickIn += inflow;
  }

  // ───────────── 유틸 ─────────────
  findInd(id: number): Ind | undefined {
    for (const i of this.inds) if (i.id === id) return i;
    return undefined;
  }

  checksum(): string {
    const buf = new Float64Array(1); const u = new Uint32Array(buf.buffer);
    let h1 = 0x811c9dc5, h2 = 0x1234567;
    const mix = (v: number) => {
      buf[0] = v; h1 = Math.imul(h1 ^ u[0], 16777619); h1 = Math.imul(h1 ^ u[1], 16777619);
      h2 = Math.imul(h2 ^ u[1], 2246822519); h2 = Math.imul(h2 ^ u[0], 3266489917);
    };
    mix(this.tick);
    for (const i of this.inds) { mix(i.id); mix(i.x); mix(i.y); mix(i.reserve); for (let k = 0; k < G; k += 7) mix(i.genome[k]); }
    for (let s = 0; s < NPLANT; s++) for (let i = 0; i < this.n; i += 3) mix(this.plants[s][i]);
    for (let i = 0; i < this.n; i += 3) { mix(this.soil[i]); mix(this.corpse[i]); }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }
}
