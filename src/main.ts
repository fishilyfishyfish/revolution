import { SimClient, showError } from './ui/client';
import { MapView, speciesColor, ViewOpts } from './ui/mapview';
import { barChart, histChart, lineChart, stackedArea, Marker } from './ui/charts';
import { drawTree, SpRec } from './ui/tree';
import { drawBrain } from './ui/brainview';
import { Branch } from './ui/branch';
import { STAT_TRAITS, MIN_SPECIES } from './sim/analysis';
import { PRESETS } from './sim/genome';
import { COST_NAMES } from './sim/world';
import { CAUSE_NAMES } from './sim/lineage';
import { snapshotFromJSON, snapshotToJSON } from './sim/snapshot';
import { prepareSnapshot } from './sim/migrate';
import type { Intervention } from './sim/world';
import type { FrameMsg, FromWorker, InspectData, SnapMeta, SpInfo, StatsMsg } from './worker/protocol';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
window.addEventListener('error', (e) => showError(e.message || '알 수 없는 오류'));
window.addEventListener('unhandledrejection', (e) => showError(String((e.reason && e.reason.message) || e.reason)));
const client = new SimClient();
const mv = new MapView($('map') as HTMLCanvasElement);

// ── 상태 ──
let hist: { cols: string[]; rows: number[][] } = { cols: [], rows: [] };
let st: StatsMsg | null = null;
let spHist: [number, number[]][] = [];
let snapMetas: SnapMeta[] = [];
let selected = -1, insp: InspectData | null = null;
let tool = 'inspect';
let running = false, dirty = true, chartsDirty = true;
let lastFrame: FrameMsg | null = null;
let branch: Branch | null = null;

client.onMsg = (m: FromWorker) => {
  if (m.t === 'map') { if (prepMode) { setPrep(false); newWorld({ terrain: m.terrain, dom: m.dom, zone: m.zone }); } return; }
  if (m.t === 'frame') { mv.setFrame(m); lastFrame = m; dirty = true; running = m.running; $('play').textContent = running ? '⏸ 일시정지' : '▶ 재생'; $('play').classList.toggle('on', !running);
    $('readout').textContent = `틱 ${m.tick} · 개체 ${m.pop} · ${m.tps.toFixed(0)} tick/s`; }
  else if (m.t === 'stats') {
    if (m.from === 0) hist = { cols: m.cols, rows: [] }; else hist.rows.length = m.from;
    for (const r of m.rows) hist.rows.push(r);
    if (m.spHistFrom === 0) spHist = []; else spHist.length = m.spHistFrom;
    for (const r of m.spHist) spHist.push(r);
    if (st && m.events.length > st.events.length) toast('💀 전멸! 랜덤 게놈으로 재시작했어요', 4000);
    st = m; chartsDirty = true; updateHud(); renderLegend();
  } else if (m.t === 'snaps') { if (m.list.length > snapMetas.length && !snapToastShown) { snapToastShown = true; toast('📸 개입 직전 스냅샷 저장됨 — 🌍 환경에서 분기 비교 가능'); } snapMetas = m.list; renderSnaps(); }
  else if (m.t === 'inspect') { insp = m.data; renderInspect(); }
  else if (m.t === 'ancestry') renderAncestry(m);
  else if (m.t === 'error') { fileMsg(m.msg); alert(m.msg); }
  else if (m.t === 'snap') {
    if (m.purpose === 'save') {
      const blob = new Blob([snapshotToJSON(m.snap)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `evolution_t${m.snap.tick}_seed${m.snap.cfg.seed}.json`; a.click();
    } else if (m.purpose === 'branch') openBranch(m.snap, m.iv);
  }
};

// ── 헤더 컨트롤 ──
let snapToastShown = false;
let speedSel = '5';
const speedMult = () => (speedSel === 'max' ? 100 : +speedSel);
const isMax = () => speedSel === 'max';
function sendSpeed() {
  const mult = speedMult(), max = isMax(), render = ($('render') as HTMLInputElement).checked;
  client.send({ t: 'speed', mult, max, render }); branch?.setSpeed(mult, max, render);
}
document.querySelectorAll<HTMLButtonElement>('#speeds button').forEach((b) => b.onclick = () => {
  speedSel = b.dataset.s!; document.querySelectorAll('#speeds button').forEach((x) => x.classList.toggle('on', x === b)); sendSpeed();
});
($('speeds').querySelector('[data-s="5"]') as HTMLButtonElement).click();
$('render').onchange = sendSpeed;
function toast(_msg: string, _ms = 2600) { /* 알림 꺼짐 */ }
function toastUnused(msg: string, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, ms);
}
$('play').onclick = () => { running = !running; client.send({ t: 'run', running }); branch?.run(running); };
$('step').onclick = () => { client.send({ t: 'step', n: 1 }); };
const DEF: Record<string, [boolean, number]> = { herb: [true, 300], omni: [false, 100], predator: [false, 25], fish: [false, 250], fishpred: [false, 20] };
$('presets').innerHTML = PRESETS.map((p) => `<div class="row"><label style="flex:1 1 auto"><input type="checkbox" data-p="${p.name}" ${DEF[p.name][0] ? 'checked' : ''}/> ${p.icon} ${p.label}</label><input type="number" data-n="${p.name}" value="${DEF[p.name][1]}" min="1" max="800" style="width:70px"/></div>`).join('');
let prepMode = false;
function setPrep(on: boolean) {
  prepMode = on; $('prepBar').style.display = on ? '' : 'none';
  ($('play') as HTMLButtonElement).disabled = on; ($('step') as HTMLButtonElement).disabled = on; ($('prepTerrain') as HTMLButtonElement).disabled = on;
  if (on) (document.querySelector('#toolbtns [data-tool="terrain1"]') as HTMLButtonElement | null)?.click();
}
function newWorld(customMap?: { terrain: number[]; dom: number[]; zone: number[] } | null) {
  const seed = +($('seed') as HTMLInputElement).value || 1, stage = +($('stage') as HTMLSelectElement).value;
  const founders = PRESETS.filter((p) => ($('presets').querySelector(`[data-p=${p.name}]`) as HTMLInputElement).checked)
    .map((p) => ({ preset: p.name, count: Math.max(1, +($('presets').querySelector(`[data-n=${p.name}]`) as HTMLInputElement).value || 1) }));
  if (!founders.length) founders.push({ preset: 'herb', count: 300 });
  const waterLevel = +($('water') as HTMLSelectElement).value;
  hist = { cols: [], rows: [] }; spHist = []; selected = -1; insp = null;
  ($('memoryLive') as HTMLInputElement).checked = ($('memory') as HTMLInputElement).checked; ($('neatLive') as HTMLInputElement).checked = ($('neat') as HTMLInputElement).checked;
  client.send({ t: 'init', seed, stage, cfg: { founders, waterLevel, customMap: customMap ?? null, restartOnExtinction: ($('respawn') as HTMLInputElement).checked, features: { neat: ($('neat') as HTMLInputElement).checked, memory: ($('memory') as HTMLInputElement).checked } } }); client.send({ t: 'run', running: true }); sendSpeed();
}
$('reset').onclick = () => { setPrep(false); newWorld(); };
$('prepTerrain').onclick = () => { // 생물 없는 준비 월드: 칠하는 동안 시간이 흐르지 않는다
  const seed = +($('seed') as HTMLInputElement).value || 1, stage = +($('stage') as HTMLSelectElement).value;
  const plain = ($('terrainBase') as HTMLSelectElement).value === 'plain';
  hist = { cols: [], rows: [] }; spHist = []; selected = -1; insp = null;
  client.send({ t: 'init', seed, stage, cfg: { founders: [], genTerrain: !plain, waterLevel: +($('water') as HTMLSelectElement).value, restartOnExtinction: false } });
  client.send({ t: 'run', running: false }); setPrep(true);
};
$('prepGo').onclick = () => client.send({ t: 'getMap' });
$('prepCancel').onclick = () => { setPrep(false); newWorld(); };
$('save').onclick = () => client.send({ t: 'getSnap', id: 0, purpose: 'save' });
$('load').onclick = () => $('file').click();
function fileMsg(text: string, bad = true) { const el = $('fileMsg'); el.textContent = text; el.style.color = bad ? 'var(--danger)' : 'var(--muted)'; }
($('file') as HTMLInputElement).onchange = async (e) => {
  const input = e.target as HTMLInputElement; const f = input.files?.[0]; if (!f) return;
  try {
    fileMsg(`"${f.name}" 읽는 중…`, false);
    const prep = prepareSnapshot(snapshotFromJSON(await f.text()));
    if (prep.error || !prep.snap) { fileMsg(prep.error ?? '알 수 없는 오류'); alert(prep.error); return; }
    client.send({ t: 'load', snap: prep.snap }); fileMsg(`불러왔어요: ${f.name} (틱 ${prep.snap.tick})${prep.note ? ' · ' + prep.note : ''}`, false);
  } catch (err) { const msg = `파일을 읽지 못했어요: ${(err as Error).message}`; fileMsg(msg); alert(msg); }
  finally { input.value = ''; } // 같은 파일을 다시 골라도 동작하도록 초기화
};
document.addEventListener('keydown', (e) => { if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') { e.preventDefault(); $('play').click(); } });

// ── 반투명 패널 토글 ──
document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((b) => b.onclick = () => {
  const el = $(b.dataset.panel!); const open = !el.classList.contains('open');
  if (open && window.matchMedia('(max-width: 800px)').matches) { document.querySelectorAll('.panel.open').forEach((x) => x.classList.remove('open')); document.querySelectorAll('#panelbtns button').forEach((x) => x.classList.remove('on')); }
  el.classList.toggle('open', open); document.querySelectorAll(`#panelbtns [data-panel]`).forEach((x) => x.classList.toggle('on', x.getAttribute('data-panel') === b.dataset.panel && open)); chartsDirty = true;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { document.querySelectorAll('.panel.open').forEach((x) => x.classList.remove('open')); document.querySelectorAll('#panelbtns button').forEach((x) => x.classList.remove('on')); } });

document.querySelectorAll<HTMLButtonElement>('.closebtn').forEach((b) => b.onclick = () => {
  b.closest('.panel')!.classList.remove('open'); document.querySelectorAll('#panelbtns button').forEach((x) => x.classList.remove('on'));
});
// 모바일: 도구 모음과 파일 메뉴를 '환경' 시트 안으로 옮긴다 (지도 아래는 환경/표시/분석 목록)
const mq = window.matchMedia('(max-width: 800px)');
function layoutMobile() {
  const q = $('quickbar');
  if (mq.matches) { $('tools').insertBefore(q, $('tools').children[2] ?? null); }
  else { $('mapwrap').appendChild(q); }
  dirty = true;
}
mq.addEventListener('change', layoutMobile); layoutMobile();

// ── 탭 ──
document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.id === 'tab-' + b.dataset.tab));
  chartsDirty = true;
});

// ── 도구 ──
const DESC: Record<string, string> = {
  inspect: '개체를 클릭해 게놈·뇌·계보를 본다 (읽기 전용).', terrain0: '평지로 칠함 (장벽 허물기). 위의 식물은 토양으로 돌아감.',
  terrain1: '물로 칠함 (통과 비용 큼, 식물 없음).', terrain2: '산으로 칠함 (통과 비용 매우 큼).', biome: '선택한 식물 종/기온대로 칠함.',
  foodUp: '햇빛 유입 배율 +0.5 (에너지 회계상 유입량 조정).', foodDown: '햇빛 유입 배율 −0.5.',
  meteor: '클릭 지점에 운석: 범위 내 개체 사망, 사체 남김, 식물은 사체화, 일시적 황폐화.', plague: '클릭 지점에 병원체 방출. 전파·사망은 저항성과 행동이 결정.',
};
const HINT: Record<string, string> = {
  inspect: '개체를 클릭하면 정보가 보여요', terrain0: '드래그해서 평지로 칠하기 (장벽 허물기)', terrain1: '드래그해서 물 칠하기 (건너기 힘든 장벽)', terrain2: '드래그해서 산 칠하기',
  biome: '드래그해서 바이옴 칠하기 (🌍 환경 패널에서 종류 선택)', foodUp: '드래그해서 음식 늘리기', foodDown: '드래그해서 음식 줄이기', meteor: '클릭한 곳에 운석 떨어뜨리기', plague: '클릭한 곳에 역병 퍼뜨리기' };
document.querySelectorAll<HTMLButtonElement>('#toolbtns button').forEach((b) => b.onclick = () => {
  tool = b.dataset.tool!; document.querySelectorAll('#toolbtns button').forEach((x) => x.classList.toggle('on', x === b)); $('tooldesc').textContent = DESC[tool]; $('hint').textContent = HINT[tool]; dirty = true;
  if (tool === 'biome' && !$('tools').classList.contains('open')) (document.querySelector('#panelbtns [data-panel=tools]') as HTMLButtonElement).click();
});
const brushR = () => +($('brush') as HTMLInputElement).value;
$('brush').oninput = () => { $('brushv').textContent = String(brushR()); };
let hoverPos: { x: number; y: number } | null = null, painting = false, lastPaint = { x: -99, y: -99, t: 0 };
const canvas = $('map') as HTMLCanvasElement;
function apply(x: number, y: number, first: boolean) {
  const r = brushR(); let iv: Intervention | null = null;
  if (tool.startsWith('terrain')) iv = { kind: 'terrain', x, y, r, value: +tool.slice(7) as 0 | 1 | 2 };
  else if (tool === 'biome') {
    const p = +($('bplant') as HTMLSelectElement).value, z = +($('bzone') as HTMLSelectElement).value;
    if (p < 0 && z < 0) return; iv = { kind: 'biome', x, y, r, plant: p >= 0 ? p : undefined, zone: z >= 0 ? z : undefined };
  } else if (tool === 'foodUp') iv = { kind: 'food', x, y, r, delta: 0.5 };
  else if (tool === 'foodDown') iv = { kind: 'food', x, y, r, delta: -0.5 };
  else if (first && tool === 'meteor') iv = { kind: 'meteor', x, y, r: Math.max(r, 3) };
  else if (first && tool === 'plague') iv = { kind: 'plague', x, y, r: Math.max(r, 2) };
  if (iv && first && (iv.kind === 'meteor' || iv.kind === 'plague')) { const T: Record<string, string> = { meteor: '☄️ 운석 투하', plague: '🦠 역병 방출', terrain: '지형 변경', biome: '바이옴 변경', food: '음식 배율 변경' }; toast(T[iv.kind] + ' · 직전 상태가 스냅샷으로 저장돼요'); }
  if (iv) client.send({ t: 'iv', iv }); // 일시정지 중이면 워커가 틱을 올리지 않고 바로 적용한다
}
canvas.onpointerdown = (e) => {
  const p = mv.toWorld(e);
  if (tool === 'inspect') { selected = mv.pick(p.x, p.y); if (selected >= 0) { selectTab('inspect'); client.send({ t: 'inspect', id: selected }); } dirty = true; return; }
  painting = true; canvas.setPointerCapture(e.pointerId); lastPaint = { x: p.x, y: p.y, t: performance.now() }; apply(p.x, p.y, true);
};
canvas.onpointermove = (e) => {
  hoverPos = mv.toWorld(e); dirty = true;
  if (painting && !tool.startsWith('meteor') && tool !== 'plague') {
    const now = performance.now(), d = Math.hypot(hoverPos.x - lastPaint.x, hoverPos.y - lastPaint.y);
    if (d > Math.max(0.8, brushR() * 0.4) && now - lastPaint.t > 40) { lastPaint = { x: hoverPos.x, y: hoverPos.y, t: now }; apply(hoverPos.x, hoverPos.y, false); }
  }
};
canvas.onpointerup = () => { painting = false; }; canvas.onpointerleave = () => { hoverPos = null; dirty = true; };
function selectTab(name: string) {
  if (window.matchMedia('(max-width: 800px)').matches) document.querySelectorAll('.panel.open').forEach((x) => x.classList.remove('open'));
  $('side').classList.add('open'); document.querySelector('#panelbtns [data-panel=side]')?.classList.add('on'); (document.querySelector(`#tabs button[data-tab=${name}]`) as HTMLButtonElement).click(); }

for (const [id, key] of [['gSun', 'sun'], ['gTemp', 'meanTemp'], ['gAmp', 'seasonAmp'], ['gPer', 'seasonPeriod']] as const) {
  const el = $(id) as HTMLInputElement;
  el.oninput = () => { $(id + 'v').textContent = el.value; };
  el.onchange = () => { client.send({ t: 'iv', iv: { kind: 'global', [key]: +el.value } as Intervention }); toast('전역 값 변경 기록됨'); };
}
($('respawn') as HTMLInputElement).onchange = (e) => client.send({ t: 'iv', iv: { kind: 'global', restartOnExtinction: (e.target as HTMLInputElement).checked } });
for (const [id, key] of [['memoryLive', 'memory'], ['neatLive', 'neat']] as const) {
  ($(id) as HTMLInputElement).onchange = (e) => { client.send({ t: 'iv', iv: { kind: 'global', [key]: (e.target as HTMLInputElement).checked } as Intervention }); toast('뇌 규칙 변경 기록됨'); };
}
$('iceAge').onclick = () => { toast('🧊 빙하기 시작 (서서히 기온 하강)'); client.send({ t: 'iv', iv: { kind: 'climate', delta: -Math.abs(+($('cDelta') as HTMLInputElement).value), duration: +($('cDur') as HTMLInputElement).value } }); };
$('warming').onclick = () => { toast('🔥 온난화 시작 (서서히 기온 상승)'); client.send({ t: 'iv', iv: { kind: 'climate', delta: Math.abs(+($('cDelta') as HTMLInputElement).value), duration: +($('cDur') as HTMLInputElement).value } }); };

// ── 스냅샷/분기 ──
function renderSnaps() {
  const el = $('snaps');
  if (!snapMetas.length) { el.innerHTML = '아직 없음 (개입하면 직전 상태가 자동 저장됨)'; }
  else {
    el.innerHTML = '';
    for (const s of snapMetas) {
      const d = document.createElement('div'); d.className = 'snap';
      d.innerHTML = `<span>틱 ${s.tick} · ${s.label}</span>`;
      const b = document.createElement('button'); b.textContent = '분기 비교'; b.onclick = () => client.send({ t: 'getSnap', id: s.id, purpose: 'branch' });
      d.appendChild(b); el.appendChild(d);
    }
  }
  const nb = document.createElement('div'); nb.className = 'snap';
  nb.innerHTML = '<span>현재 상태</span>'; const b = document.createElement('button'); b.textContent = '여기서 분기';
  b.onclick = () => client.send({ t: 'getSnap', id: 0, purpose: 'branch' }); nb.appendChild(b); el.appendChild(nb);
}
function openBranch(snap: any, iv: Intervention | null) {
  branch?.close();
  $('branch').classList.add('open');
  const b = new Branch(snap, iv, $('mapA') as HTMLCanvasElement, $('mapB') as HTMLCanvasElement);
  branch = b; $('branchIv').textContent = iv ? `(개입: ${iv.kind})` : '(개입 미지정 → 아래 선택)';
  $('branchinfo').textContent = `틱 ${snap.tick}에서 분기, 같은 시드·같은 상태`;
  client.send({ t: 'run', running: false });
  b.setSpeed(speedMult(), isMax(), ($('render') as HTMLInputElement).checked); b.run(true);
  if (!iv) { // 개입이 없는 스냅샷이면 프리셋을 B에 적용
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">개입 선택…</option><option value="meteor">운석(중앙)</option><option value="plague">역병(중앙)</option><option value="ice">빙하기 −10℃</option><option value="warm">온난화 +10℃</option><option value="dark">햇빛 ×0.5</option><option value="bright">햇빛 ×2</option>';
    sel.onchange = () => { const w = snap.cfg.w, h = snap.cfg.h; const map: Record<string, Intervention> = {
      meteor: { kind: 'meteor', x: w / 2, y: h / 2, r: 12 }, plague: { kind: 'plague', x: w / 2, y: h / 2, r: 16 }, ice: { kind: 'climate', delta: -10, duration: 1500 },
      warm: { kind: 'climate', delta: 10, duration: 1500 }, dark: { kind: 'global', sun: 0.5 }, bright: { kind: 'global', sun: 2 } };
      if (map[sel.value]) { b.applyToB(map[sel.value]); $('branchIv').textContent = `(개입: ${sel.value})`; sel.remove(); } };
    $('branchIv').appendChild(sel);
  }
}
$('branchClose').onclick = () => { branch?.close(); branch = null; $('branch').classList.remove('open'); };

// ── 지도 범례: 색 → 종 (특징 요약, 눌러서 강조) ──
const hidden = new Set<number>(); // 숨긴 종 id
let showHeat = false;
const mobileMq = window.matchMedia('(max-width: 800px)');
let legendOpen = (() => { try { const v = localStorage.getItem('evo-legend'); if (v !== null) return v === '1'; } catch { /* 무시 */ } return !mobileMq.matches; })();
function describeSp(r: SpInfo): { icon: string; shape: string; text: string; aqua: boolean } {
  const names = ['식물A', '식물B', '식물C'];
  let mi = 0; for (let k = 1; k < 3; k++) if (r.diet[k] > r.diet[mi]) mi = k;
  const d3 = r.diet[3];
  const cls = d3 > 0.5 ? 2 : d3 > 0.2 || r.diet[mi] < 0.45 ? 1 : 0;
  const aqua = r.aq > 0.6;
  const food = cls === 2 ? '육식' : cls === 1 ? '잡식' : `초식(${names[mi]})`;
  const icon = cls === 2 ? (aqua ? '🦈' : '🐺') : cls === 1 ? (aqua ? '🐠' : '🐗') : aqua ? '🐟' : '🦌';
  const home = aqua ? '수중' : r.aq > 0.3 ? '반수생' : '육상';
  const body = r.size < 0.9 ? '소형' : r.size < 1.8 ? '중형' : '대형';
  return { icon, shape: cls === 2 ? '▲' : cls === 1 ? '◆' : '●', text: `${icon} ${food} · ${home} · ${body}`, aqua };
}
function renderLegend() {
  const el = $('legend'); const mode = ($('vind') as HTMLSelectElement).value;
  if (!st) { el.hidden = true; return; }
  el.hidden = false;
  const rows = mode === 'speciesA' ? st.spInfo.A : mode === 'speciesB' ? st.spInfo.B : [];
  const speciesMode = mode === 'speciesA' || mode === 'speciesB';
  for (const id of [...hidden]) if (!rows.some((r) => r.id === id)) hidden.delete(id);
  const title = mode === 'speciesA' ? '종 범례 (게놈 거리 클러스터)' : mode === 'speciesB' ? '종 범례 (교배 가능 집단)' : mode === 'hue' ? '색 = 색 유전자 (중립)' : '색 = 에너지';
  const dots = speciesMode ? rows.map((r) => `<span style="color:${speciesColor(r.id)}">●</span>`).join('') : '';
  let html = `<div class="lh" role="button" tabindex="0">${legendOpen ? '▾' : '▸'} <b>${title}</b>${speciesMode ? ` · ${rows.length}종 (${rows.length - rows.filter((r) => hidden.has(r.id)).length}개 표시) ${dots}` : ''}</div>`;
  if (legendOpen) {
    if (speciesMode) {
      html += `<div class="lt"><span class="swrap" data-act="heat" title="종별 밀도를 지도 위에 색으로 표시"><span class="sw${showHeat ? ' on' : ''}"></span> 분포 보기</span> · 모양: ●초식 ◆잡식 ▲육식 · 파란 테두리=수생 · 스위치로 종 켜기/끄기</div>`;
      html += rows.length ? rows.map((r) => { const d = describeSp(r); const off = hidden.has(r.id); return `<div class="lr${off ? ' off' : ''}" data-id="${r.id}"><span class="sw${off ? '' : ' on'}"></span><span class="lc${d.aqua ? ' aq' : ''}" style="color:${speciesColor(r.id)}">${d.shape}</span><span><b>${d.text}</b><br><span style="color:var(--muted)">#${r.id} · ${r.count}마리</span></span></div>`; }).join('') : '<div class="lt">표시할 종 없음</div>';
    } else html += `<div class="lt">${mode === 'hue' ? '종을 보려면 🌍 표시 → 개체 색을 "종"으로' : '빨강 낮음 → 초록 높음'}</div>`;
  }
  el.innerHTML = html;
  const head = el.querySelector<HTMLElement>('.lh')!;
  head.onclick = () => { legendOpen = !legendOpen; try { localStorage.setItem('evo-legend', legendOpen ? '1' : '0'); } catch { /* 무시 */ } renderLegend(); };
  el.querySelectorAll<HTMLElement>('.lr').forEach((d) => d.onclick = () => { const id = +d.dataset.id!; if (hidden.has(id)) hidden.delete(id); else hidden.add(id); renderLegend(); dirty = true; });
  el.querySelectorAll<HTMLElement>('[data-act=heat]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); showHeat = !showHeat; renderLegend(); dirty = true; });
}
function renderAncestry(m: Extract<FromWorker, { t: 'ancestry' }>) {
  const a = m.data, el = $('ancestry');
  if (!a.nAlive) { el.textContent = '살아있는 개체가 없어요'; return; }
  const origin = (b: number) => (b === 0 ? '처음 창시 집단' : m.restarts.includes(b) || m.restarts.includes(b - 1) ? `틱 ${b} 전멸 후 재시작 집단` : `틱 ${b}`);
  const top = a.roots.filter((r) => r.share >= 0.01).slice(0, 4);
  const lines = [`🧬 <b>조상 구성</b> · 현재 ${a.nAlive}마리`];
  if (a.roots.length === 1 || (top[0] && top[0].share > 0.999)) lines.push(`전부 한 창시 개체(#${a.roots[0].id}, ${origin(a.roots[0].birth)})의 후손이에요`);
  else lines.push(`창시 개체 ${a.roots.length}명의 후손 · ` + top.map((r) => `#${r.id} ${(r.share * 100).toFixed(0)}% (${origin(r.birth)})`).join(', '));
  if (a.mrca) lines.push(`가장 가까운 공통 조상: #${a.mrca.id} (틱 ${a.mrca.birth}에 태어남, ${m.tick - a.mrca.birth}틱 전)${a.mrca.share >= 0.999 && a.roots.length === 1 ? '' : ''}`);
  else lines.push('모두가 거쳐 온 단일 조상은 아직 없어요 (유성생식으로 섞이는 중)');
  el.innerHTML = lines.join('<br>');
}
setInterval(() => { if (document.getElementById('tab-species')!.classList.contains('on') && $('side').classList.contains('open')) client.send({ t: 'ancestry' }); }, 3000);
function updateHud() {
  if (!st || !lastFrame) return;
  const e = st.env, ph = ((lastFrame.tick / e.seasonPeriod) % 1 + 1) % 1;
  const season = ph < 0.125 || ph >= 0.875 ? '🌸 봄' : ph < 0.375 ? '☀️ 여름' : ph < 0.625 ? '🍂 가을' : '❄️ 겨울';
  const T = e.meanTemp + e.climShift + e.seasonAmp * Math.sin(2 * Math.PI * ph);
  const r = hist.rows[hist.rows.length - 1], nA = r ? r[hist.cols.indexOf('nA')] : 0, nB = r ? r[hist.cols.indexOf('nB')] : 0;
  const ext = lastFrame.pop === 0 ? (prepMode ? '🗺 지형 편집 중 · ' : '💀 전멸 · ') : '';
  $('hud').innerHTML = `${ext}${season} · ${T.toFixed(0)}℃ · 🧬 종 ${nA} <span title="(a) 게놈 거리 클러스터 / (b) 교배 가능 집단" style="opacity:.7">(교배집단 ${nB})</span>`;
}
// ── 개체 인스펙터 ──
// 첫 실행 안내
try { if (localStorage.getItem('evo-intro')) $('intro').style.display = 'none'; } catch { /* 저장소 사용 불가 */ }
$('introClose').onclick = () => { $('intro').style.display = 'none'; try { localStorage.setItem('evo-intro', '1'); } catch { /* 무시 */ } };

function renderInspect() {
  const d = insp; if (!d) { $('inspInfo').textContent = '정보 없음'; return; }
  $('inspInfo').innerHTML = `<b>#${d.id}</b> ${d.alive ? '생존' : '사망'} · 나이 ${d.age} · 종A <span class="chip" style="background:${speciesColor(d.species)}"></span>${d.species} · 종B ${d.speciesB} · ${d.mode}`
    + (d.alive ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, (100 * d.reserve) / d.maxReserve))}%"></i></div>에너지 ${d.reserve.toFixed(1)} / ${d.maxReserve.toFixed(0)} (+구조 ${d.structE.toFixed(1)})` : '');
  drawBrain($('cBrain') as HTMLCanvasElement, d.brain);
  $('inspTraits').textContent = Object.entries(d.traits).map(([k, v]) => `${k.padEnd(10)} ${v.toFixed(3)}`).join('\n');
  $('inspLin').textContent = '계보 (부모 경로)\n' + d.lineage.map((l) => `#${l.id}  출생 ${l.birth}  ${l.death >= 0 ? `사망 ${l.death} (${CAUSE_NAMES[l.cause] ?? l.cause})` : '생존'}  부모 ${l.pa}${l.pb >= 0 ? ' × ' + l.pb : ''}  종 ${l.species}`).join('\n');
}
setInterval(() => { if (selected >= 0 && document.getElementById('tab-inspect')!.classList.contains('on')) client.send({ t: 'inspect', id: selected }); }, 250);

// ── 그래프 ──
const COL = ['#4aa3ff', '#ffa04a', '#55c271', '#ef5b5b', '#b080ff', '#e0d050'];
const traitSel = $('traitSel') as HTMLSelectElement;
STAT_TRAITS.forEach((t) => { const o = document.createElement('option'); o.value = t.key; o.textContent = t.name; traitSel.appendChild(o); });
traitSel.value = 'size'; traitSel.onchange = () => { chartsDirty = true; };
($('prune') as HTMLInputElement).onchange = () => { chartsDirty = true; };
const KCOL: Record<string, string> = { terrain: '#8aa', biome: '#7a7', food: '#ca4', global: '#ccc', meteor: '#f64', plague: '#c5f', climate: '#6cf' };
const KLAB: Record<string, string> = { terrain: '지', biome: '바', food: '음', global: '전', meteor: '운', plague: '역', climate: '기' };
function markers(): Marker[] {
  if (!st) return []; const out: Marker[] = []; const last = new Map<string, number>();
  for (const e of st.log) {
    const brush = e.iv.kind === 'terrain' || e.iv.kind === 'biome' || e.iv.kind === 'food';
    if (brush && e.tick - (last.get(e.iv.kind) ?? -1e9) < 150) continue;
    last.set(e.iv.kind, e.tick); out.push({ x: e.tick, label: KLAB[e.iv.kind], color: KCOL[e.iv.kind] });
  }
  for (const e of st.events) out.push({ x: e.tick, label: '멸', color: '#f55' });
  return out;
}
const colv = (name: string) => { const i = hist.cols.indexOf(name); return hist.rows.map((r) => r[i]); };
function drawCharts() {
  if (!hist.rows.length) return;
  const tab = document.querySelector('.tab.on')!.id; const mk = markers(); const x = colv('tick');
  if (tab === 'tab-graphs') {
    lineChart($('cPop') as HTMLCanvasElement, [{ label: '개체 수', color: COL[0], x, y: colv('pop') }], { title: '개체 수 (점선=개입, 멸=전멸 재시작)', markers: mk, ymin: 0 });
    const tr = STAT_TRAITS.find((t) => t.key === traitSel.value)!; const mean = colv('m_' + tr.key), sd = colv('s_' + tr.key);
    lineChart($('cTrait') as HTMLCanvasElement, [{ label: '평균', color: COL[1], x, y: mean }], { title: `${tr.name} 평균 ± σ`, markers: mk, band: { x, lo: mean.map((v, i) => v - sd[i]), hi: mean.map((v, i) => v + sd[i]), color: COL[1] } });
    if (st?.hists[tr.key]) histChart($('cHist') as HTMLCanvasElement, st.hists[tr.key], tr.lo, tr.hi, `${tr.name} 분포 (현재)`, COL[2]);
    // 무성/유성: 유성 성향 평균 + 최근 구간 실제 유성 출생 비율
    const sb = colv('sexBirths'), bi = colv('births'); const frac = sb.map((v, i) => { const j = Math.max(0, i - 8); const db = bi[i] - bi[j]; return db > 0 ? (v - sb[j]) / db : 0; });
    lineChart($('cSex') as HTMLCanvasElement, [{ label: '유성 성향 평균', color: COL[4], x, y: colv('m_sex') }, { label: '유성 출생 비율', color: COL[3], x, y: frac }], { title: '무성/유성', markers: mk, ymin: 0, ymax: 1 });
    lineChart($('cEnergy') as HTMLCanvasElement, [{ label: '식물', color: COL[2], x, y: colv('plants') }, { label: '개체', color: COL[0], x, y: colv('bodies') }, { label: '사체', color: COL[3], x, y: colv('corpse') }, { label: '토양', color: COL[1], x, y: colv('soil') }], { title: '에너지 저장량 (식물·개체·사체·토양)', markers: mk, ymin: 0 });
    if (st) {
      barChart($('cCost') as HTMLCanvasElement, COST_NAMES, st.costs, COL, '누적 대사 열손실 구성');
      const e = st.energy; $('ledger').textContent = `장부: 누적 유입(햇빛) ${e.cumIn.toFixed(0)} − 누적 유출(열) ${e.cumOut.toFixed(0)} · 총량 ${e.total.toFixed(0)} · 출생 ${st.cnt.births} (유성 ${st.cnt.sexBirths}) · 사망 아사 ${st.cnt.starved}/피식 ${st.cnt.eaten}/질병 ${st.cnt.disease}/운석 ${st.cnt.meteor}/노화 ${st.cnt.aged}/기온 ${st.cnt.tempDeaths}/서식지 ${st.cnt.habitat} · 재시작 ${st.cnt.restarts}`;
    }
  } else if (tab === 'tab-species' && st) {
    lineChart($('cSpN') as HTMLCanvasElement, [{ label: '(a) 게놈 클러스터', color: COL[0], x, y: colv('nA') }, { label: '(b) 교배 가능 집단', color: COL[1], x, y: colv('nB'), dash: [4, 3] }], { title: `종 수 추이 (개체 ${MIN_SPECIES}+ 만 집계)`, markers: mk, ymin: 0 });
    const ids = new Map<number, number>(); for (const [, a] of spHist) for (let i = 0; i < a.length; i += 2) ids.set(a[i], Math.max(ids.get(a[i]) ?? 0, a[i + 1]));
    const top = [...ids.entries()].filter(([, v]) => v >= MIN_SPECIES).sort((a, b) => a[0] - b[0]).slice(-24);
    const xs = spHist.map((s) => s[0]);
    stackedArea($('cSpArea') as HTMLCanvasElement, xs, top.map(([id]) => ({ color: speciesColor(id), y: spHist.map(([, a]) => { for (let i = 0; i < a.length; i += 2) if (a[i] === id) return a[i + 1]; return 0; }) })), '종별 개체 수 (클러스터)');
    drawTree($('cTree') as HTMLCanvasElement, st.spA as SpRec[], lastFrame?.tick ?? 0, ($('prune') as HTMLInputElement).checked, MIN_SPECIES);
    const rowsA = st.spA.filter((s) => s.died < 0 && s.count >= MIN_SPECIES).sort((a, b) => b.count - a.count).slice(0, 8);
    const rowsB = st.spB.filter((s) => s.died < 0 && s.count >= MIN_SPECIES).sort((a, b) => b.count - a.count).slice(0, 8);
    $('spTable').innerHTML = '<tr><th>(a) 클러스터</th><th>수</th><th>출생</th><th>(b) 교배집단</th><th>수</th></tr>' + Array.from({ length: Math.max(rowsA.length, rowsB.length) }, (_, i) => {
      const a = rowsA[i], b = rowsB[i];
      return `<tr><td>${a ? `<span class="chip" style="background:${speciesColor(a.id)}"></span>#${a.id}` : ''}</td><td>${a?.count ?? ''}</td><td>${a?.born ?? ''}</td><td>${b ? `<span class="chip" style="background:${speciesColor(b.id)}"></span>#${b.id}` : ''}</td><td>${b?.count ?? ''}</td></tr>`;
    }).join('');
  } else if (tab === 'tab-log' && st) {
    const parts: string[] = [];
    for (const e of st.events) parts.push(`틱 ${e.tick}  [자동] ${e.kind} — ${e.info ?? ''}`);
    const L = st.log; const shown = L.length > 300 ? L.slice(-300) : L;
    if (L.length > shown.length) parts.push(`… 앞선 ${L.length - shown.length}건 생략`);
    for (const e of shown) parts.push(`틱 ${e.tick}  ${e.iv.kind}  ${JSON.stringify(e.iv, (k, v) => (k === 'kind' ? undefined : typeof v === 'number' ? +v.toFixed(1) : v))}`);
    $('logList').innerHTML = parts.length ? `<pre>${parts.join('\n')}</pre>` : '개입 없음';
  }
}

// ── 렌더 루프 ──
function frameLoop() {
  const c = canvas, r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  if (Math.abs(c.width - r.width * dpr) > 2) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); dirty = true; }
  if (dirty && lastFrame) {
    const o: ViewOpts = { bg: ($('vbg') as HTMLSelectElement).value as any, ind: ($('vind') as HTMLSelectElement).value as any, showInd: ($('vshow') as HTMLInputElement).checked, selected, hidden, heat: showHeat,
      brush: hoverPos && tool !== 'inspect' ? { ...hoverPos, r: brushR() } : null };
    if (($('render') as HTMLInputElement).checked) mv.draw(o); dirty = false;
  }
  if (chartsDirty) { chartsDirty = false; drawCharts(); }
  requestAnimationFrame(frameLoop);
}
setInterval(() => { chartsDirty = true; }, 700);
['vbg', 'vind', 'vshow'].forEach((id) => { $(id).onchange = () => { dirty = true; if (id === 'vind') { hidden.clear(); renderLegend(); } }; });
window.addEventListener('resize', () => { dirty = true; chartsDirty = true; });
renderSnaps();
newWorld();
frameLoop();
