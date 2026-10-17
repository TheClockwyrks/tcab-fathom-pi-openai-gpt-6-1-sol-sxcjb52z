import type { DeepReadonly } from "ts-essentials";
import type { PredatorKind } from "./constants";

export type Direction = "up" | "down" | "left" | "right";
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";
export interface Body {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Direction;
}
export interface Forager extends Body {
  moving: boolean;
  desired: Direction;
}
export interface Drifter extends Body {
  lit: boolean;
  mind: boolean;
  travel: boolean;
}
export interface Predator extends Body {
  kind: PredatorKind;
  state: "den" | "wander" | "chase" | "search";
  released: boolean;
  mind: boolean;
  travel: boolean;
  speed: number;
  alert: boolean;
  lit: boolean;
  detectRange: number | null;
  hearingRange: number | null;
  hearingLock: boolean | null;
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;
  fix: { tx: number; ty: number } | null;
  linger: number;
  alertLeft: number;
  mark: number;
  releaseAt: number | null;
  pingIn: number;
  pingAgo: number;
  searchTime: number;
  searchPing: boolean;
  chaseSpeed: number;
  flareIn: number;
  flareTime: number;
  fade: number;
}
export interface Pulse {
  source: "forager" | "gloamfin";
  tint: "cyan" | "violet" | "orange";
  ox: number;
  oy: number;
  front: number;
  range: number;
  owner: number | null;
  caught: boolean;
}
export interface InkCloud {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}
export type Art = Record<string, ImageBitmap[]>;
export interface FathomState {
  version: number;
  screen: Screen;
  menuIndex: number | null;
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  drifterIn: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  windowRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: Forager;
  drifters: Drifter[];
  predators: Predator[];
  pulses: Pulse[];
  inkClouds: InkCloud[];
  simTime: number;
  art: Art;
  accumulator: number;
  screenTime: number;
  playTime: number;
  seed: number;
  start: { tx: number; ty: number };
  tileMarks: number[][];
  pointerDown: { id: number; index: number | null } | null;
  pendingSonar: boolean;
  pendingInk: boolean;
}
export type StateView = DeepReadonly<FathomState>;
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Snapshot = Pick<
  FathomState,
  | "version"
  | "screen"
  | "menuIndex"
  | "titleIndex"
  | "depth"
  | "score"
  | "lives"
  | "muted"
  | "planktonRemaining"
  | "drifterIn"
  | "brightness"
  | "brightHold"
  | "visionRadius"
  | "windowRadius"
  | "sonar"
  | "ink"
  | "grid"
  | "tiles"
  | "plankton"
  | "visibility"
  | "inkClouds"
  | "simTime"
> & {
  forager: Pick<Forager, "x" | "y" | "tx" | "ty" | "dir" | "moving">;
  drifters: Pick<
    Drifter,
    "x" | "y" | "tx" | "ty" | "lit" | "mind" | "travel"
  >[];
  predators: Omit<
    Predator,
    | "fix"
    | "linger"
    | "alertLeft"
    | "mark"
    | "releaseAt"
    | "pingIn"
    | "pingAgo"
    | "searchTime"
    | "searchPing"
    | "chaseSpeed"
    | "flareIn"
    | "flareTime"
    | "fade"
  >[];
  pulses: Pick<Pulse, "source" | "tint" | "ox" | "oy" | "front" | "range">[];
};
export interface FathomDebugApi {
  version: number;
  reset(s: StateView): FathomState;
  snapshot(s: StateView): Snapshot;
  reconcile(s: StateView): FathomState;
  setScreen(s: StateView, screen: Screen): FathomState;
  setMenuIndex(s: StateView, index: number): FathomState;
  setTitleIndex(s: StateView, index: number): FathomState;
  menuItemRect(s: StateView, index: number): Rect | null;
  setScore(s: StateView, points: number): FathomState;
  setLives(s: StateView, n: number): FathomState;
  setDepth(s: StateView, d: number): FathomState;
  setMaze(s: StateView, rows: string[]): FathomState;
  setPlankton(
    s: StateView,
    tx: number,
    ty: number,
    present: boolean,
  ): FathomState;
  clearPlankton(s: StateView): FathomState;
  clearFog(s: StateView): FathomState;
  setForagerTile(s: StateView, tx: number, ty: number): FathomState;
  setForagerDir(s: StateView, dir: Direction): FathomState;
  setBrightness(s: StateView, g: number): FathomState;
  setBrightHold(s: StateView, seconds: number): FathomState;
  clearPredators(s: StateView): FathomState;
  addPredator(
    s: StateView,
    kind: PredatorKind,
    tx: number,
    ty: number,
  ): FathomState;
  setPredatorTile(
    s: StateView,
    index: number,
    tx: number,
    ty: number,
  ): FathomState;
  setPredatorDir(s: StateView, index: number, dir: Direction): FathomState;
  setPredatorState(
    s: StateView,
    index: number,
    value: "den" | "wander" | "chase",
  ): FathomState;
  setPredatorReleased(
    s: StateView,
    index: number,
    released: boolean,
  ): FathomState;
  setPredatorMind(s: StateView, index: number, enabled: boolean): FathomState;
  setPredatorTravel(s: StateView, index: number, enabled: boolean): FathomState;
  spawnDrifter(s: StateView, tx: number, ty: number): FathomState;
  clearDrifters(s: StateView): FathomState;
  setDrifterMind(s: StateView, index: number, enabled: boolean): FathomState;
  setDrifterTravel(s: StateView, index: number, enabled: boolean): FathomState;
  setDrifterIn(s: StateView, seconds: number): FathomState;
  setSonarCooldown(s: StateView, seconds: number): FathomState;
  setInkCooldown(s: StateView, seconds: number): FathomState;
}
