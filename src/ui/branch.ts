import { SimClient } from './client';
import { MapView } from './mapview';
import { lineChart } from './charts';
import type { Intervention } from '../sim/world';
import type { Snapshot } from '../sim/snapshot';
import type { FromWorker } from '../worker/protocol';

// 같은 스냅샷에서 A(개입 없음)와 B(개입함)를 나란히 실행
export class Branch {
  a = new SimClient(); b = new SimClient();
  va: MapView; vb: MapView;
  ha: { cols: string[]; rows: number[][] } = { cols: [], rows: [] };
  hb: { cols: string[]; rows: number[][] } = { cols: [], rows: [] };
  timer: number; closed = false; t0: number;
  constructor(snap: Snapshot, iv: Intervention | null, ca: HTMLCanvasElement, cb: HTMLCanvasElement) {
    this.va = new MapView(ca); this.vb = new MapView(cb); this.t0 = snap.tick;
    this.wire(this.a, this.va, this.ha); this.wire(this.b, this.vb, this.hb);
    this.a.send({ t: 'load', snap }); this.b.send({ t: 'load', snap });
    if (iv) this.b.send({ t: 'iv', iv });
    this.timer = window.setInterval(() => this.draw(), 100);
  }
  private wire(c: SimClient, v: MapView, h: { cols: string[]; rows: number[][] }) {
    c.onMsg = (m: FromWorker) => {
      if (m.t === 'frame') v.setFrame(m);
      else if (m.t === 'stats') { if (m.from === 0) { h.cols = m.cols; h.rows = []; } else h.rows.length = m.from; for (const r of m.rows) h.rows.push(r); }
    };
  }
  applyToB(iv: Intervention) { this.b.send({ t: 'iv', iv }); }
  setSpeed(mult: number, max: boolean, render: boolean) { this.a.send({ t: 'speed', mult, max, render }); this.b.send({ t: 'speed', mult, max, render }); }
  run(r: boolean) { this.a.send({ t: 'run', running: r }); this.b.send({ t: 'run', running: r }); }
  draw() {
    if (this.closed) return;
    for (const v of [this.va, this.vb]) {
      const c = v.canvas; const r = c.getBoundingClientRect();
      if (Math.abs(c.width - r.width) > 2 && r.width > 0) { c.width = Math.round(r.width); c.height = Math.round(r.height); }
      v.draw({ bg: 'plants', ind: 'speciesA', showInd: true, selected: -1, brush: null });
    }
    const metric = (document.getElementById('bmetric') as HTMLSelectElement).value;
    const get = (h: { cols: string[]; rows: number[][] }) => { const i = h.cols.indexOf(metric); return { x: h.rows.map((r) => r[0]), y: h.rows.map((r) => r[i]) }; };
    const A = get(this.ha), B = get(this.hb);
    lineChart(document.getElementById('bchart') as HTMLCanvasElement, [{ label: 'A 개입 없음', color: '#8c97a6', ...A }, { label: 'B 개입함', color: '#ffa04a', ...B }],
      { title: metric, markers: [{ x: this.t0, label: '분기', color: '#4aa3ff' }], ymin: metric === 'pop' || metric.startsWith('n') ? 0 : undefined });
  }
  close() { this.closed = true; clearInterval(this.timer); this.a.terminate(); this.b.terminate(); }
}
