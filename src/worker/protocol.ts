import type { ConfigOverride } from '../sim/config';
import type { Intervention } from '../sim/world';
import type { Snapshot } from '../sim/snapshot';

export type ToWorker =
  | { t: 'init'; seed: number; stage?: number; cfg?: ConfigOverride }
  | { t: 'load'; snap: Snapshot }
  | { t: 'run'; running: boolean }
  | { t: 'speed'; mult: number; max: boolean; render: boolean }
  | { t: 'step'; n: number }
  | { t: 'iv'; iv: Intervention }
  | { t: 'getSnap'; id: number; purpose: 'branch' | 'save' | 'export' }
  | { t: 'saveNow' }
  | { t: 'inspect'; id: number }
  | { t: 'resend' };

export interface FrameMsg {
  t: 'frame'; tick: number; tps: number; pop: number; running: boolean;
  w: number; h: number; pMax: number;
  ind: Float32Array; // 개체당 10값: x,y,a,radius,hue,speciesA,speciesB,inf,id,energyFrac
  layers: Uint8Array; // 셀당 5값: 식물A,B,C, 사체, 병원체
  maps?: { terrain: Uint8Array; dom: Uint8Array; zone: Uint8Array; sun: Float32Array; devast: Uint16Array };
}
export interface StatsMsg {
  t: 'stats'; cols: string[]; rows: number[][]; from: number; // history에서 from 인덱스부터의 새 행
  spHist: [number, number[]][]; spHistFrom: number;
  spA: { id: number; parent: number; born: number; died: number; peak: number; count: number }[];
  spB: { id: number; parent: number; born: number; died: number; peak: number; count: number }[];
  events: { tick: number; kind: string; info?: string }[];
  log: { tick: number; iv: Intervention }[];
  hists: Record<string, number[]>;
  costs: number[]; cnt: Record<string, number>;
  energy: { plants: number; soil: number; corpse: number; bodies: number; total: number; cumIn: number; cumOut: number };
  env: { strain: number; sun: number; meanTemp: number; seasonAmp: number; seasonPeriod: number; climShift: number };
}
export interface SnapMeta { id: number; tick: number; label: string; hasIv: boolean }
export type FromWorker =
  | FrameMsg | StatsMsg
  | { t: 'snaps'; list: SnapMeta[] }
  | { t: 'snap'; id: number; purpose: string; snap: Snapshot; iv: Intervention | null }
  | { t: 'inspect'; data: InspectData | null };

export interface InspectData {
  id: number; alive: boolean; x: number; y: number; age: number; reserve: number; maxReserve: number; structE: number;
  inf: number; species: number; speciesB: number; genome: number[]; traits: Record<string, number>;
  brain: { inp: number[]; hid: number[]; out: number[]; w: number[]; mask: number[] };
  lineage: { id: number; birth: number; death: number; cause: number; species: number; pa: number; pb: number }[];
  mode: string;
}
