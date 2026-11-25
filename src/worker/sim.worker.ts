/// <reference lib="webworker" />
import { STAGES, defaultConfig } from '../sim/config';
import { World, Intervention, NPLANT } from '../sim/world';
import { stepSim } from '../sim/runner';
import { deserialize, serialize, Snapshot } from '../sim/snapshot';
import { BO, GENE, MO, NB, NM, TRAIT_NAMES } from '../sim/genome';
import type { FromWorker, InspectData, SnapMeta, ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;
const post = (m: FromWorker, tr: Transferable[] = []) => self.postMessage(m, tr);

let world: World | null = null;
let running = false, mult = 1, maxSpeed = false, renderOn = true;
let debt = 0, lastT = performance.now(), lastFrame = 0, lastStats = 0, tpsWin = { t: performance.now(), tick: 0, v: 0 };
let sentRows = 0, sentSp = 0, mapsDirty = true, mapsAt = 0;
const snaps: { id: number; tick: number; label: string; snap: Snapshot; iv: Intervention | null }[] = [];
let snapSeq = 1, lastAutoSnapTick = -1e9;

function attach(w: World) {
  world = w; sentRows = 0; sentSp = 0; mapsDirty = true;
  // 개입 직전 자동 스냅샷 (브러시 연타는 200틱에 한 번만)
  w.onBeforeIntervention = (e) => {
    const brush = e.iv.kind === 'terrain' || e.iv.kind === 'biome' || e.iv.kind === 'food';
    if (brush && w.tick - lastAutoSnapTick < 200) return;
    lastAutoSnapTick = w.tick;
    snaps.push({ id: snapSeq++, tick: w.tick, label: describe(e.iv), snap: serialize(w), iv: e.iv });
    while (snaps.length > 6) snaps.shift();
    post({ t: 'snaps', list: snapList() });
  };
}
const KIND: Record<string, string> = { terrain: '지형', biome: '바이옴', food: '음식', global: '전역', meteor: '운석', plague: '역병', climate: '기후' };
const describe = (iv: Intervention) => KIND[iv.kind] ?? iv.kind;
const snapList = (): SnapMeta[] => snaps.map((s) => ({ id: s.id, tick: s.tick, label: s.label, hasIv: !!s.iv }));

function frame(force = false) {
  const w = world!; const now = performance.now();
  const n = w.inds.length;
  const ind = new Float32Array(n * 10);
  for (let i = 0; i < n; i++) {
    const a = w.inds[i], o = i * 10;
    ind[o] = a.x; ind[o + 1] = a.y; ind[o + 2] = a.a; ind[o + 3] = a.t.radius; ind[o + 4] = a.t.hue;
    ind[o + 5] = a.species; ind[o + 6] = a.speciesB; ind[o + 7] = a.inf > 0 ? 1 : 0; ind[o + 8] = a.id;
    ind[o + 9] = a.reserve / a.t.maxReserve;
  }
  const N = w.n; const layers = new Uint8Array(N * 5); const pm = 255 / w.cfg.pMax;
  for (let c = 0; c < N; c++) {
    const o = c * 5;
    for (let s = 0; s < NPLANT; s++) layers[o + s] = Math.min(255, w.plants[s][c] * pm);
    layers[o + 3] = Math.min(255, w.corpse[c] * 12);
    layers[o + 4] = Math.min(255, w.pathogen[c] * 50);
  }
  const msg: FromWorker = { t: 'frame', tick: w.tick, tps: tpsWin.v, pop: n, running, w: w.w, h: w.h, pMax: w.cfg.pMax, ind, layers };
  const tr: Transferable[] = [ind.buffer, layers.buffer];
  if (mapsDirty || now - mapsAt > 1500) {
    msg.maps = { terrain: w.terrain.slice(), dom: w.dom.slice(), zone: w.zone.slice(), sun: w.sunMul.slice(), devast: w.devast.slice() };
    tr.push(msg.maps.terrain.buffer, msg.maps.dom.buffer, msg.maps.zone.buffer, msg.maps.sun.buffer, msg.maps.devast.buffer);
    mapsDirty = false; mapsAt = now;
  }
  post(msg, tr);
  lastFrame = now;
}

function stats() {
  const w = world!;
  const strip = (a: typeof w.spA) => a.map(({ id, parent, born, died, peak, count }) => ({ id, parent, born, died, peak, count }));
  const e = w.totalEnergy();
  post({
    t: 'stats', cols: w.history.cols, rows: w.history.rows.slice(sentRows), from: sentRows,
    spHist: w.spHist.slice(sentSp), spHistFrom: sentSp,
    spA: strip(w.spA), spB: strip(w.spB), events: w.events, log: w.log, hists: w.hists,
    costs: Array.from(w.cumCosts), cnt: { ...w.cnt },
    energy: { ...e, cumIn: w.cumIn, cumOut: w.cumOut },
    env: { sun: w.sunG, meanTemp: w.meanTempG, seasonAmp: w.seasonAmpG, seasonPeriod: w.seasonPeriodG, climShift: w.climShift },
  });
  sentRows = w.history.rows.length; sentSp = w.spHist.length; lastStats = performance.now();
}

function inspect(id: number) {
  const w = world!;
  const ind = w.findInd(id);
  if (!ind) {
    const L = w.lineage;
    if (id < 0 || id >= L.n) { post({ t: 'inspect', data: null }); return; }
    post({ t: 'inspect', data: { id, alive: false, x: 0, y: 0, age: 0, reserve: 0, maxReserve: 0, structE: 0, inf: 0, species: L.species[id], speciesB: -1,
      genome: [], traits: {}, brain: { inp: [], hid: [], out: [], w: [], mask: [] }, lineage: lineageOf(id), mode: '사망' } });
    return;
  }
  const t = ind.t; const b = w.inspectBrain(ind);
  const traits: Record<string, number> = { '몸 크기': t.size, '최대 속도': t.vmax, '시야 거리': t.vis, '시야 각도(°)': (t.ang * 180) / Math.PI,
    '식성 A': t.diet[0], '식성 B': t.diet[1], '식성 C': t.diet[2], '식성 고기': t.diet[3], '적정 기온': t.tOpt, '질병 저항': t.res,
    '번식 임계': t.thr, '자식 에너지': t.give, '유성 성향': t.sex, '돌연변이율': t.mut, '색(hue)': t.hue, '진동수': t.osc, '수생 적응': t.aq, '수명(틱)': t.lifespan, '갑옷': t.armor, '이빨·발톱': t.claw, '독': t.toxin, '후각 반경': t.smellR, '청각 반경': t.hearR, '기온 허용폭': t.tolW, '단열': t.insul, '겨울잠': t.hiber, '한배 새끼 수': t.clutchMax, '뇌 은닉 노드': t.nodes, '뇌 활성 연결': t.conns, '짝 까다로움': t.picky,
    '기초대사/틱': t.basal, '뇌 유지비/틱': t.brainCost, '시야 유지비/틱': t.visCost };
  post({ t: 'inspect', data: {
    id, alive: true, x: ind.x, y: ind.y, age: ind.age, reserve: ind.reserve, maxReserve: t.maxReserve, structE: ind.structE, inf: ind.inf,
    species: ind.species, speciesB: ind.speciesB, genome: Array.from(ind.genome.slice(0, BO)), traits,
    brain: { ...b, w: Array.from(ind.genome.slice(BO, BO + NB)), mask: Array.from(ind.genome.slice(MO, MO + NM)) }, lineage: lineageOf(id), mode: ind.inf > 0 ? '감염' : '정상' } });
}
function lineageOf(id: number) {
  const L = world!.lineage;
  return L.ancestors(id, 12).map((i) => ({ id: i, birth: L.birth[i], death: L.death[i], cause: L.cause[i], species: L.species[i], pa: L.pa[i], pb: L.pb[i] }));
}

function loop() {
  const now = performance.now();
  const dt = now - lastT; lastT = now;
  if (world) {
    if (running) {
      const budget = renderOn ? 22 : 80;
      const t0 = performance.now();
      if (maxSpeed) { while (performance.now() - t0 < budget) { stepSim(world); if (world.dead) break; } }
      else {
        const tps = 30 * mult; debt = Math.min(debt + (dt / 1000) * tps, tps * 0.3);
        while (debt >= 1 && performance.now() - t0 < budget) { stepSim(world); debt--; if (world.dead) break; }
      }
      if (world.dead) running = false;
    }
    if (now - tpsWin.t > 500) { tpsWin.v = ((world.tick - tpsWin.tick) / (now - tpsWin.t)) * 1000; tpsWin.t = now; tpsWin.tick = world.tick; }
    const interval = renderOn ? 33 : 400;
    if (now - lastFrame >= interval) frame();
    if (now - lastStats > 400 || (!running && now - lastStats > 1500)) stats();
  }
  setTimeout(loop, running ? 0 : 30);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  switch (m.t) {
    case 'init': {
      const cfg = defaultConfig({ seed: m.seed, ...(m.cfg ?? {}), features: { ...STAGES[m.stage ?? 7], ...(m.cfg?.features ?? {}) } });
      snaps.length = 0; lastAutoSnapTick = -1e9;
      attach(World.create(cfg)); post({ t: 'snaps', list: [] }); frame(); stats(); break;
    }
    case 'load': snaps.length = 0; attach(deserialize(m.snap)); post({ t: 'snaps', list: [] }); frame(); stats(); break;
    case 'run': running = m.running; break;
    case 'speed': mult = m.mult; maxSpeed = m.max; renderOn = m.render; break;
    case 'step': if (world) { for (let i = 0; i < m.n; i++) stepSim(world); frame(); stats(); } break;
    case 'iv': if (world) { world.intervene(m.iv); if (m.iv.kind === 'terrain' || m.iv.kind === 'biome' || m.iv.kind === 'food') mapsDirty = true; if (!running) { /* 일시정지 중에도 다음 틱에 적용되도록 한 틱만 진행하지 않음 */ } } break;
    case 'getSnap': {
      if (!world) break;
      if (m.id === 0) post({ t: 'snap', id: 0, purpose: m.purpose, snap: serialize(world), iv: null });
      else { const s = snaps.find((x) => x.id === m.id); if (s) post({ t: 'snap', id: s.id, purpose: m.purpose, snap: s.snap, iv: s.iv }); }
      break;
    }
    case 'inspect': if (world) inspect(m.id); break;
    case 'resend': if (world) { mapsDirty = true; frame(); stats(); post({ t: 'snaps', list: snapList() }); } break;
  }
};
loop();
