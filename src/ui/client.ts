import type { FromWorker, ToWorker } from '../worker/protocol';

export class SimClient {
  worker: Worker | null = null;
  failed: string | null = null;
  onMsg: (m: FromWorker) => void = () => {};
  constructor() {
    try {
      // 클래식 워커(IIFE 번들): 모듈 워커를 지원하지 않는 브라우저에서도 동작한다
      this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url));
      this.worker.onmessage = (e) => this.onMsg(e.data as FromWorker);
      this.worker.onerror = (e) => { this.failed = e.message || '워커 오류'; showError(`시뮬레이션 엔진 오류: ${this.failed}`); };
    } catch (e) {
      this.failed = (e as Error).message;
      showError(`시뮬레이션 엔진을 시작하지 못했어요: ${this.failed}`);
    }
  }
  send(m: ToWorker) { try { this.worker?.postMessage(m); } catch (e) { showError(`메시지 전송 실패: ${(e as Error).message}`); } }
  terminate() { this.worker?.terminate(); }
}

// 화면 맨 위에 오류를 보여준다 (버튼이 먹통처럼 보이는 일을 막고, 원인을 알려 주기 위함)
export function showError(msg: string) {
  let bar = document.getElementById('errbar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'errbar'; document.body.prepend(bar); }
  bar.textContent = `⚠ ${msg}  (브라우저: ${navigator.userAgent})`;
}
