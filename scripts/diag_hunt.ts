// 진단: 육식(고기 식성>0.5)의 사냥 단계별 손실. 시뮬레이션은 건드리지 않고 개체 상태만 읽는다.
// 발견: 시야 안에 다른 개체 / 접근: 그중 머리 방향이 목표 쪽(±30°)이고 전진 중 / 근접: 입까지 0.6칸 이내 /
// 시도: 근접 + 공격 출력 켜짐 / 명중: 입 앞 0.15칸 안에 상대(피해 가능) / 처치: cnt.eaten 증가
import { STAGES, defaultConfig } from '../src/sim/config';
import { World } from '../src/sim/world';
import { stepSim } from '../src/sim/runner';
const seeds = (process.argv[2] ?? '1,2,3').split(',').map(Number), ticks = +(process.argv[3] ?? 1500), every = +(process.argv[4] ?? 500);
for (const seed of seeds) {
  const w = World.create(defaultConfig({ seed, founders: [{ preset: 'herb', count: 300 }, { preset: 'predator', count: 40 }], features: { ...STAGES[7] } }));
  const c = { pt: 0, seen: 0, appr: 0, near: 0, tried: 0, hit: 0 }; let e0 = 0;
  for (let t = 1; t <= ticks; t++) {
    for (const p of w.inds) {
      if (!p.alive || p.t.diet[3] <= 0.5) continue;
      c.pt++;
      let best: any = null, bd = 1e9;
      for (const o of w.inds) { if (o === p || !o.alive || o.t.diet[3] > 0.5) continue; const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = o; } }
      if (!best || bd > p.t.vis) continue;
      c.seen++;
      let da = Math.atan2(best.y - p.y, best.x - p.x) - p.a; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) < 0.52 && p.v > 0.02) c.appr++;
      const rI = (w as any).rad(p), rO = (w as any).rad(best);
      const mx = p.x + Math.cos(p.a) * (rI + 0.1), my = p.y + Math.sin(p.a) * (rI + 0.1);
      const dm = Math.hypot(best.x - mx, best.y - my) - rO;
      if (bd - rI - rO < 0.6) { c.near++; if (p.oAtk > 0) c.tried++; }
      if (dm < 0.15 && p.oAtk > 0) c.hit++;
    }
    stepSim(w);
    if (t % every === 0) {
      const P = w.inds.filter((i) => i.t.diet[3] > 0.5).length;
      const f = (n: number) => (n / Math.max(1, c.pt)).toFixed(2);
      console.log(`s${seed} t${t} 육식${P} 틱당비율[발견 ${f(c.seen)} 접근 ${f(c.appr)} 근접 ${f(c.near)} 시도 ${f(c.tried)} 명중 ${f(c.hit)}] 처치${w.cnt.eaten - e0} 육식틱${c.pt}`);
      e0 = w.cnt.eaten; Object.keys(c).forEach((k) => ((c as any)[k] = 0));
    }
  }
}
