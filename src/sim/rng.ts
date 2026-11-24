// 시드 기반 RNG (sfc32). 상태 4×uint32 → 스냅샷에 그대로 저장 가능.
export class Rng {
  a = 0; b = 0; c = 0; d = 0;
  constructor(seed = 1) { this.seed(seed); }
  seed(seed: number) {
    let s = (seed >>> 0) || 0x9e3779b9;
    const mb = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
    this.a = mb(); this.b = mb(); this.c = mb(); this.d = mb();
    for (let i = 0; i < 16; i++) this.next();
  }
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  range(lo: number, hi: number) { return lo + (hi - lo) * this.next(); }
  int(n: number) { return Math.floor(this.next() * n); }
  gauss() {
    let u = this.next(); if (u < 1e-12) u = 1e-12;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * this.next());
  }
  getState(): number[] { return [this.a, this.b, this.c, this.d]; }
  setState(s: number[]) { [this.a, this.b, this.c, this.d] = s.map((v) => v | 0); }
}
