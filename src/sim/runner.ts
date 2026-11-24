import { classify, recordStats } from './analysis';
import { World } from './world';

// 한 틱 + 관측(읽기 전용) 훅. 관측은 시뮬레이션 상태/RNG에 영향 없음.
export function stepSim(w: World) {
  w.step();
  if (w.tick % w.cfg.speciesInterval === 0) classify(w);
  if (w.tick % w.cfg.statInterval === 0) recordStats(w);
}
