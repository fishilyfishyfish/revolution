// 개체 계보 기록: id → 부모(들), 출생/사망 틱, 사망 원인
export const CAUSE = { ALIVE: 255, STARVED: 0, EATEN: 1, DISEASE: 2, METEOR: 3, AGE: 4, TEMP: 5, HABITAT: 6 } as const;
export const CAUSE_NAMES: Record<number, string> = { 0: '아사', 1: '피식', 2: '질병', 3: '운석', 4: '노화', 5: '극한 기온', 6: '서식지 부적합', 255: '생존' };

export class Lineage {
  n = 0;
  cap = 1 << 16;
  pa = new Int32Array(this.cap);
  pb = new Int32Array(this.cap);
  birth = new Int32Array(this.cap);
  death = new Int32Array(this.cap);
  cause = new Uint8Array(this.cap);
  species = new Int32Array(this.cap);

  private grow() {
    const nc = this.cap * 2;
    const g = <T extends Int32Array | Uint8Array>(a: T): T => { const r = new (a.constructor as any)(nc); r.set(a); return r; };
    this.pa = g(this.pa); this.pb = g(this.pb); this.birth = g(this.birth);
    this.death = g(this.death); this.cause = g(this.cause); this.species = g(this.species);
    this.cap = nc;
  }
  add(pa: number, pb: number, tick: number, species: number): number {
    if (this.n >= this.cap) this.grow();
    const id = this.n++;
    this.pa[id] = pa; this.pb[id] = pb; this.birth[id] = tick; this.death[id] = -1;
    this.cause[id] = CAUSE.ALIVE; this.species[id] = species;
    return id;
  }
  die(id: number, tick: number, cause: number) { this.death[id] = tick; this.cause[id] = cause; }
  // id에서 조상 방향으로 최대 depth 세대 (첫 부모 경로)
  ancestors(id: number, depth: number): number[] {
    const out: number[] = [];
    let cur = id;
    for (let i = 0; i < depth && cur >= 0 && cur < this.n; i++) { out.push(cur); cur = this.pa[cur]; }
    return out;
  }
  pack() {
    const n = this.n;
    return { n, pa: this.pa.slice(0, n), pb: this.pb.slice(0, n), birth: this.birth.slice(0, n),
      death: this.death.slice(0, n), cause: this.cause.slice(0, n), species: this.species.slice(0, n) };
  }
  static unpack(p: ReturnType<Lineage['pack']>): Lineage {
    const l = new Lineage();
    while (l.cap < p.n + 1024) l.cap *= 2;
    l.pa = new Int32Array(l.cap); l.pb = new Int32Array(l.cap); l.birth = new Int32Array(l.cap);
    l.death = new Int32Array(l.cap); l.cause = new Uint8Array(l.cap); l.species = new Int32Array(l.cap);
    l.pa.set(p.pa); l.pb.set(p.pb); l.birth.set(p.birth); l.death.set(p.death); l.cause.set(p.cause); l.species.set(p.species);
    l.n = p.n;
    return l;
  }
}
