import type { FromWorker, ToWorker } from '../worker/protocol';

export class SimClient {
  worker: Worker;
  onMsg: (m: FromWorker) => void = () => {};
  constructor() {
    this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onMsg(e.data as FromWorker);
  }
  send(m: ToWorker) { this.worker.postMessage(m); }
  terminate() { this.worker.terminate(); }
}
