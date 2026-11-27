// 진단: 저장 파일의 조향 품질(식물/개체가 보일 때 회전 출력이 그쪽을 향하는 비율, 무작위 0.5)과 먹기·가속 반응(읽기 전용)
import { readFileSync } from 'node:fs';
import { snapshotFromJSON, deserialize } from '../src/sim/snapshot';
import { brainForward, NIN, NH, NOUT } from '../src/sim/genome';
const w = deserialize(snapshotFromJSON(readFileSync(process.argv[2], 'utf8')));
w.buildHash();
const inp = new Float64Array(NIN), hid = new Float64Array(NH), out = new Float64Array(NOUT);
let aP = 0, nP = 0, aO = 0, nO = 0, aC = 0, nC = 0, spNear = 0, nNear = 0, spFar = 0, nFar = 0, biteNear = 0, biteFar = 0;
for (const ind of w.inds) {
  w.sense(ind, inp, false); brainForward(ind.genome, inp, hid, out, !!w.cfg.features.neat);
  if (inp[1] > 0 && Math.abs(inp[0]) > 0.05) { nP++; if (out[0] * inp[0] > 0) aP++; }
  if (inp[4] > 0 && Math.abs(inp[3]) > 0.05) { nC++; if (out[0] * inp[3] > 0) aC++; }
  if (inp[6] > 0 && Math.abs(inp[5]) > 0.05) { nO++; if (out[0] * inp[5] > 0) aO++; }
  if (inp[1] > 0.8) { nNear++; spNear += Math.max(0, out[1]); biteNear += out[2] > 0 ? 1 : 0; } else if (inp[1] < 0.3) { nFar++; spFar += Math.max(0, out[1]); biteFar += out[2] > 0 ? 1 : 0; }
}
const f = (a: number, n: number) => (n ? (a / n).toFixed(2) : '-');
console.log(`tick ${w.tick} 개체 ${w.inds.length} | 식물쪽회전 ${f(aP, nP)}(${nP}) 사체쪽 ${f(aC, nC)}(${nC}) 개체쪽 ${f(aO, nO)}(${nO}) | 가속(식물 근처/먼곳) ${f(spNear, nNear)}/${f(spFar, nFar)} 먹기(근처/먼곳) ${f(biteNear, nNear)}/${f(biteFar, nFar)}`);
