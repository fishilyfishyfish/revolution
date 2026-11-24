import { BO, G, NB, TAU, genomeDistance, Traits } from './genome';
import { World, Ind, SpeciesRec } from './world';

export const MIN_SPECIES = 8; // 종 수 집계 시 최소 개체 수

// ── 형질 통계 ──
export interface StatTrait { key: string; name: string; lo: number; hi: number; get: (t: Traits, i: Ind) => number }
export const STAT_TRAITS: StatTrait[] = [
  { key: 'size', name: '몸 크기', lo: 0.5, hi: 3, get: (t) => t.size },
  { key: 'vmax', name: '최대 속도', lo: 0.1, hi: 1.2, get: (t) => t.vmax },
  { key: 'vis', name: '시야 거리', lo: 1.5, hi: 12, get: (t) => t.vis },
  { key: 'ang', name: '시야 각도', lo: 0.35, hi: TAU, get: (t) => t.ang },
  { key: 'd0', name: '식물A 식성', lo: 0, hi: 1, get: (t) => t.diet[0] },
  { key: 'd1', name: '식물B 식성', lo: 0, hi: 1, get: (t) => t.diet[1] },
  { key: 'd2', name: '식물C 식성', lo: 0, hi: 1, get: (t) => t.diet[2] },
  { key: 'dm', name: '고기 식성', lo: 0, hi: 1, get: (t) => t.diet[3] },
  { key: 'tOpt', name: '적정 기온', lo: -5, hi: 35, get: (t) => t.tOpt },
  { key: 'res', name: '질병 저항', lo: 0, hi: 1, get: (t) => t.res },
  { key: 'thr', name: '번식 임계', lo: 0.3, hi: 0.95, get: (t) => t.thr },
  { key: 'give', name: '자식 에너지 비율', lo: 0.15, hi: 0.7, get: (t) => t.give },
  { key: 'sex', name: '유성 성향', lo: 0, hi: 1, get: (t) => t.sex },
  { key: 'mut', name: '돌연변이율', lo: 0.003, hi: 0.15, get: (t) => t.mut },
  { key: 'aq', name: '수생 적응', lo: 0, hi: 1, get: (t) => t.aq },
  { key: 'brain', name: '뇌 가중치 |w| 평균', lo: 0, hi: 3, get: (t, i) => { let s = 0; for (let k = 0; k < NB; k++) s += Math.abs(i.genome[BO + k]); return s / NB; } },
];
const NBIN = 24;

export const STAT_COLS = ['tick', 'pop', 'births', 'sexBirths', 'starved', 'eaten', 'disease', 'meteor', 'matings', 'restarts',
  'plants', 'soil', 'corpse', 'bodies', 'cumIn', 'cumOut', 'nA', 'nB', 'infected',
  ...STAT_TRAITS.map((t) => 'm_' + t.key), ...STAT_TRAITS.map((t) => 's_' + t.key)];

export function recordStats(w: World) {
  if (!w.history.cols.length) w.history.cols = STAT_COLS;
  const n = w.inds.length;
  const m = new Float64Array(STAT_TRAITS.length), s2 = new Float64Array(STAT_TRAITS.length);
  const hist: Record<string, number[]> = {};
  for (const st of STAT_TRAITS) hist[st.key] = new Array(NBIN).fill(0);
  let infected = 0;
  for (let i = 0; i < n; i++) {
    const ind = w.inds[i];
    if (ind.inf > 0) infected++;
    for (let k = 0; k < STAT_TRAITS.length; k++) {
      const st = STAT_TRAITS[k];
      const v = st.get(ind.t, ind);
      m[k] += v; s2[k] += v * v;
      let b = Math.floor(((v - st.lo) / (st.hi - st.lo)) * NBIN); if (b < 0) b = 0; else if (b >= NBIN) b = NBIN - 1;
      hist[st.key][b]++;
    }
  }
  const e = w.totalEnergy();
  let nA = 0, nB = 0;
  for (const sp of w.spA) if (sp.died < 0 && sp.count >= MIN_SPECIES) nA++;
  for (const sp of w.spB) if (sp.died < 0 && sp.count >= MIN_SPECIES) nB++;
  const c = w.cnt;
  const row = [w.tick, n, c.births, c.sexBirths, c.starved, c.eaten, c.disease, c.meteor, c.matings, c.restarts,
    e.plants, e.soil, e.corpse, e.bodies, w.cumIn, w.cumOut, nA, nB, infected];
  for (let k = 0; k < STAT_TRAITS.length; k++) row.push(n ? m[k] / n : 0);
  for (let k = 0; k < STAT_TRAITS.length; k++) row.push(n ? Math.sqrt(Math.max(0, s2[k] / n - (m[k] / n) ** 2)) : 0);
  w.history.rows.push(row);
  w.hists = hist;
}

// ── (a) 게놈 거리 클러스터 종 판정 ──
function recomputeCentroids(w: World, groups: Map<number, Ind[]>, recs: Map<number, SpeciesRec>) {
  for (const [id, mem] of groups) {
    const r = recs.get(id)!;
    const acc = new Float64Array(G);
    for (const ind of mem) for (let k = 0; k < G; k++) acc[k] += ind.genome[k];
    const c = new Float32Array(G);
    for (let k = 0; k < G; k++) c[k] = acc[k] / mem.length;
    r.centroid = c; r.count = mem.length;
    if (mem.length > r.peak) r.peak = mem.length;
  }
}

export function classifyA(w: World) {
  const dc = w.cfg.dcluster;
  const recs = new Map<number, SpeciesRec>();
  for (const s of w.spA) if (s.died < 0) recs.set(s.id, s);
  const groups = new Map<number, Ind[]>();
  for (const ind of w.inds) {
    let best = -1, bd = 1e9;
    for (const [id, r] of recs) {
      if (!r.centroid) continue;
      const d = genomeDistance(ind.genome, r.centroid);
      if (d < bd) { bd = d; best = id; }
    }
    if (best < 0 || bd > dc) {
      const r: SpeciesRec = { id: w.nextSpA++, parent: ind.species, born: w.tick, died: -1, peak: 0, count: 0, centroid: ind.genome.slice() };
      w.spA.push(r); recs.set(r.id, r); best = r.id;
    }
    ind.species = best;
    let g = groups.get(best); if (!g) groups.set(best, (g = [])); g.push(ind);
  }
  recomputeCentroids(w, groups, recs);
  // 가까워진 종 병합 (오래된 쪽 유지)
  const ids = [...groups.keys()].sort((a, b) => a - b);
  for (let i = 0; i < ids.length; i++) {
    const A = recs.get(ids[i])!; if (!groups.has(A.id)) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const B = recs.get(ids[j])!; if (!groups.has(B.id) || !A.centroid || !B.centroid) continue;
      if (genomeDistance(A.centroid, B.centroid) < dc * 0.5) {
        for (const ind of groups.get(B.id)!) { ind.species = A.id; groups.get(A.id)!.push(ind); }
        groups.delete(B.id);
        B.died = w.tick; B.count = 0;
        // 병합된 종은 A의 후손이 아니라 A로 흡수됨 → 트리에서 parent 유지
      }
    }
  }
  recomputeCentroids(w, groups, recs);
  for (const r of w.spA) {
    if (r.died < 0 && !groups.has(r.id)) { r.died = w.tick; r.count = 0; }
  }
  // 계보 기록에 반영
  for (const ind of w.inds) w.lineage.species[ind.id] = ind.species;
}

// ── (b) 실제 교배 가능 집단: 호환성(거리<dmax) 그래프의 연결 성분 ──
export function classifyB(w: World) {
  const dmax = w.cfg.dmax;
  const inds = w.inds; const n = inds.length;
  if (!n) { for (const r of w.spB) if (r.died < 0) { r.died = w.tick; r.count = 0; } return; }
  const S = Math.min(n, 220);
  const samp: number[] = [];
  for (let i = 0; i < S; i++) samp.push(Math.floor((i * n) / S));
  const par = new Int32Array(S); for (let i = 0; i < S; i++) par[i] = i;
  const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let i = 0; i < S; i++) for (let j = i + 1; j < S; j++) {
    if (find(i) === find(j)) continue;
    if (genomeDistance(inds[samp[i]].genome, inds[samp[j]].genome) < dmax) par[find(i)] = find(j);
  }
  const comp = new Int32Array(n).fill(-1);
  for (let i = 0; i < S; i++) comp[samp[i]] = find(i);
  const reps: number[] = []; const stride = Math.max(1, Math.floor(S / 24));
  for (let i = 0; i < S; i += stride) reps.push(i);
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0) continue;
    let best = -1, bd = 1e9;
    for (const r of reps) { const d = genomeDistance(inds[i].genome, inds[samp[r]].genome); if (d < bd) { bd = d; best = r; } }
    comp[i] = find(best);
  }
  // 성분 → 지속적 ID (이전 ID와 겹침이 가장 큰 것을 승계)
  const tally = new Map<number, Map<number, number>>();
  for (let i = 0; i < n; i++) {
    let m = tally.get(comp[i]); if (!m) tally.set(comp[i], (m = new Map()));
    m.set(inds[i].speciesB, (m.get(inds[i].speciesB) ?? 0) + 1);
  }
  const compSize = new Map<number, number>();
  for (let i = 0; i < n; i++) compSize.set(comp[i], (compSize.get(comp[i]) ?? 0) + 1);
  const order = [...compSize.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map((e) => e[0]);
  const used = new Set<number>(); const label = new Map<number, number>();
  const recs = new Map<number, SpeciesRec>(); for (const r of w.spB) recs.set(r.id, r);
  for (const c of order) {
    let bestId = -1, bc = 0;
    for (const [id, cnt] of tally.get(c)!) if (id >= 0 && !used.has(id) && cnt > bc && recs.get(id)?.died === -1) { bc = cnt; bestId = id; }
    if (bestId < 0) {
      const parent = [...tally.get(c)!.keys()].find((k) => k >= 0) ?? -1;
      const r: SpeciesRec = { id: w.nextSpB++, parent, born: w.tick, died: -1, peak: 0, count: 0, centroid: null };
      w.spB.push(r); recs.set(r.id, r); bestId = r.id;
    }
    used.add(bestId); label.set(c, bestId);
  }
  for (const r of w.spB) { r.count = 0; }
  for (let i = 0; i < n; i++) {
    const id = label.get(comp[i])!; inds[i].speciesB = id;
    const r = recs.get(id)!; r.count++;
  }
  for (const r of w.spB) {
    if (r.count > r.peak) r.peak = r.count;
    if (r.died < 0 && !used.has(r.id)) { r.died = w.tick; r.count = 0; }
  }
}

export function classify(w: World) {
  classifyA(w); classifyB(w);
  const flat: number[] = [];
  for (const r of w.spA) if (r.died < 0 && r.count > 0) flat.push(r.id, r.count);
  w.spHist.push([w.tick, flat]);
}
