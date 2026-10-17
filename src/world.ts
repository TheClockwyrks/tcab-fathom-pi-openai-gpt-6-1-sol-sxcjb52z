import * as C from "./constants";
import type {
  Art,
  Body,
  Direction,
  Drifter,
  FathomState,
  Predator,
  Screen,
  StateView,
} from "./types";

export const DIRS: Direction[] = ["up", "right", "down", "left"];
export const VECTOR: Record<Direction, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};
export const opposite = (d: Direction): Direction =>
  DIRS[(DIRS.indexOf(d) + 2) % 4];
export const center = (tx: number, ty: number) => ({
  x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
  y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
  tx,
  ty,
});
export const layer = (char: string): string[] =>
  Array.from({ length: C.GRID_ROWS }, () => char.repeat(C.GRID_COLS));
export function writeCell(
  rows: string[],
  x: number,
  y: number,
  value: string,
): void {
  rows[y] = rows[y].slice(0, x) + value + rows[y].slice(x + 1);
}

/** A loop-rich, mirrored trench. The central detour leaves the den a single door. */
export function maze(): string[] {
  const rows = layer("#");
  for (const y of [1, 4, 11, 14, 16])
    for (let x = 1; x < C.GRID_COLS - 1; x++) writeCell(rows, x, y, ".");
  for (const x of [1, 5, 9, 13, 22, 26, 30, 34])
    for (let y = 1; y < C.GRID_ROWS - 1; y++) writeCell(rows, x, y, ".");
  for (let x = 1; x <= 13; x++) {
    writeCell(rows, x, 7, ".");
    writeCell(rows, C.GRID_COLS - 1 - x, 7, ".");
  }
  for (let x = 14; x <= 21; x++) writeCell(rows, x, 4, "#");
  for (let x = 13; x <= 22; x++) writeCell(rows, x, 5, ".");
  for (let y = 7; y <= 9; y++)
    for (let x = 16; x <= 19; x++) writeCell(rows, x, y, "d");
  writeCell(rows, 17, 6, "g");
  writeCell(rows, 0, 11, ".");
  writeCell(rows, C.GRID_COLS - 1, 11, ".");
  return rows;
}
export function clone(s: StateView): FathomState {
  return {
    ...s,
    art: s.art as Art,
    grid: { ...s.grid },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    start: { ...s.start },
    drifters: s.drifters.map((d) => ({ ...d })),
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix ? { ...p.fix } : null,
    })),
    pulses: s.pulses.map((p) => ({ ...p })),
    inkClouds: s.inkClouds.map((i) => ({ ...i })),
    tileMarks: s.tileMarks.map((r) => [...r]),
    pointerDown: s.pointerDown ? { ...s.pointerDown } : null,
  };
}
export function predator(
  kind: C.PredatorKind,
  tx: number,
  ty: number,
): Predator {
  return {
    ...center(tx, ty),
    kind,
    dir: "up",
    state: "wander",
    released: true,
    mind: true,
    travel: true,
    speed: C.PREDATOR_SPEED,
    alert: false,
    lit: false,
    detectRange: null,
    hearingRange: null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    fix: null,
    linger: 0,
    alertLeft: 0,
    mark: 0,
    releaseAt: null,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    pingAgo: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    flareIn: C.FLARE_INTERVAL,
    flareTime: 0,
    fade: 0,
  };
}
export function roster(depth: number): Predator[] {
  const kinds = [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(depth, C.ROSTER_CAP_DEPTH) - 1),
  ];
  return kinds.map((k, i) => ({
    ...predator(k, 16 + (i % 4), 8 + Math.floor(i / 4)),
    state: "den",
    released: false,
    releaseAt: i * C.DEN_RELEASE_GAP,
  }));
}
export function drifter(tx: number, ty: number): Drifter {
  return { ...center(tx, ty), dir: "up", lit: false, mind: true, travel: true };
}
export function fresh(art: Art = {}, muted = false): FathomState {
  const tiles = maze();
  return reconcile({
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((r) => r.replace(/[^.]/g, "-").replace(/\./g, "*")),
    visibility: layer("u"),
    forager: { ...center(17, 14), dir: "left", moving: false, desired: "left" },
    drifters: [],
    predators: roster(1),
    pulses: [],
    inkClouds: [],
    simTime: 0,
    art,
    accumulator: 0,
    screenTime: 0,
    playTime: 0,
    seed: 0xface123,
    start: { tx: 17, ty: 14 },
    pointerDown: null,
    pendingSonar: false,
    pendingInk: false,
    tileMarks: Array.from({ length: C.GRID_ROWS }, () =>
      Array<number>(C.GRID_COLS).fill(0),
    ),
  });
}
export function locate(b: Body): void {
  b.tx = Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE);
  b.ty = Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE);
}
export function reconcile(s: StateView): FathomState {
  const n = clone(s);
  n.visionRadius = C.VISION_MIN + C.VISION_GAIN * n.brightness;
  n.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * n.brightness;
  n.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (n.depth - 1),
  );
  n.sonar.ready = n.sonar.cooldown === 0;
  n.ink.ready = n.ink.cooldown === 0;
  n.planktonRemaining = n.plankton.reduce(
    (sum, r) => sum + [...r].filter((c) => c === "*").length,
    0,
  );
  locate(n.forager);
  n.drifters.forEach(locate);
  for (const p of n.predators) {
    locate(p);
    p.speed =
      p.kind === "lanternjaw" && p.state !== "chase"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * n.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
  }
  return n;
}
export function changeScreen(s: FathomState, screen: Screen): void {
  const previous = s.screen;
  s.screen = screen;
  s.screenTime = 0;
  s.menuIndex =
    screen === "title"
      ? s.titleIndex
      : screen === "paused" || screen === "gameover"
        ? 0
        : null;
  s.pointerDown = null;
  if (screen === "playing" && previous !== "paused") s.playTime = 0;
}
export function returnTitle(s: FathomState): FathomState {
  const n = fresh(s.art, s.muted);
  n.titleIndex = s.titleIndex;
  n.menuIndex = s.titleIndex;
  n.simTime = s.simTime;
  n.accumulator = s.accumulator;
  return n;
}
export function beginDive(s: FathomState): FathomState {
  const n = returnTitle(s);
  changeScreen(n, "countdown");
  return n;
}
export function resetAttempt(s: FathomState): void {
  s.forager = {
    ...center(s.start.tx, s.start.ty),
    dir: "left",
    desired: "left",
    moving: false,
  };
  s.brightness = 0;
  s.brightHold = 0;
  s.visionRadius = C.VISION_MIN;
  s.windowRadius = C.KINDLE_VISION_MIN;
  s.predators = roster(s.depth);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.tileMarks = s.tileMarks.map((r) => r.map(() => 0));
  changeScreen(s, "countdown");
}
export const tile = (s: StateView, x: number, y: number): string =>
  s.tiles[y]?.[x] ?? "#";
export function tunnelRow(s: StateView): number {
  return s.tiles.findIndex((r) => r[0] === "." && r[C.GRID_COLS - 1] === ".");
}
export function neighbor(
  s: StateView,
  x: number,
  y: number,
  d: Direction,
): [number, number] {
  const [dx, dy] = VECTOR[d];
  let nx = x + dx;
  if (y === tunnelRow(s)) nx = (nx + C.GRID_COLS) % C.GRID_COLS;
  return [nx, y + dy];
}
export function open(s: StateView, x: number, y: number, den = false): boolean {
  const t = tile(s, x, y);
  return t === "." || (den && (t === "g" || t === "d"));
}
export function exits(s: StateView, b: Body, den = false): Direction[] {
  return DIRS.filter((d) => {
    const [x, y] = neighbor(s, b.tx, b.ty, d);
    return open(s, x, y, den);
  });
}
export function random(s: FathomState): number {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}
export function wander(s: FathomState, b: Body, den = false): Direction {
  const all = exits(s, b, den);
  const forward = all.filter((d) => d !== opposite(b.dir));
  const list = forward.length ? forward : all;
  return list.length ? list[Math.floor(random(s) * list.length)] : b.dir;
}
export function atCenter(b: Body): boolean {
  const c = center(b.tx, b.ty);
  return Math.abs(b.x - c.x) < 1e-6 && Math.abs(b.y - c.y) < 1e-6;
}
/** Integrate only along center lines; split a step at each decision point. */
export function move(
  s: FathomState,
  b: Body,
  speed: number,
  choose: () => Direction,
  den = false,
): boolean {
  if (!open(s, b.tx, b.ty, den)) return false;
  let left = speed * C.TICK_DT;
  let moved = false;
  while (left > 1e-7) {
    const c = center(b.tx, b.ty);
    if (atCenter(b)) {
      b.dir = choose();
      const [nx, ny] = neighbor(s, b.tx, b.ty, b.dir);
      if (!open(s, nx, ny, den)) break;
    }
    const [dx, dy] = VECTOR[b.dir];
    let distance = dx
      ? dx > 0
        ? c.x - b.x
        : b.x - c.x
      : dy > 0
        ? c.y - b.y
        : b.y - c.y;
    if (distance <= 1e-7) distance += C.TILE;
    const step = Math.min(distance, left);
    b.x += dx * step;
    b.y += dy * step;
    left -= step;
    moved = true;
    const width = C.GRID_COLS * C.TILE;
    if (b.x < C.GRID_ORIGIN_X) b.x += width;
    if (b.x >= C.GRID_ORIGIN_X + width) b.x -= width;
    locate(b);
  }
  return moved;
}
/** Corridor graph distances, including the ordinary one-step wrap edge. */
export function flood(
  s: StateView,
  ox: number,
  oy: number,
  den = false,
): Map<string, number> {
  const key = (x: number, y: number) => `${x},${y}`;
  const distances = new Map<string, number>();
  if (!open(s, ox, oy, den)) return distances;
  const queue: [[number, number], number][] = [[[ox, oy], 0]];
  distances.set(key(ox, oy), 0);
  for (let i = 0; i < queue.length; i++) {
    const [[x, y], n] = queue[i];
    for (const d of DIRS) {
      const [nx, ny] = neighbor(s, x, y, d);
      const k = key(nx, ny);
      if (open(s, nx, ny, den) && !distances.has(k)) {
        distances.set(k, n + 1);
        queue.push([[nx, ny], n + 1]);
      }
    }
  }
  return distances;
}
export function path(
  s: FathomState,
  b: Body,
  target: { tx: number; ty: number },
  den = false,
): Direction {
  const map = flood(s, target.tx, target.ty, den);
  let best = Infinity;
  let dir = b.dir;
  for (const d of exits(s, b, den)) {
    const [x, y] = neighbor(s, b.tx, b.ty, d);
    const v = map.get(`${x},${y}`) ?? Infinity;
    if (v < best) {
      best = v;
      dir = d;
    }
  }
  return dir;
}
export const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(a.x - b.x, a.y - b.y);
/** Sample the segment at subpixel intervals. The endpoint wall is allowed for light. */
export function lineOfSight(
  s: StateView,
  a: { x: number; y: number },
  b: { x: number; y: number },
  endpointWall = false,
): boolean {
  const n = Math.ceil(distance(a, b) * 2);
  const endX = Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE),
    endY = Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE);
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    const x = Math.floor((a.x + (b.x - a.x) * t - C.GRID_ORIGIN_X) / C.TILE),
      y = Math.floor((a.y + (b.y - a.y) * t - C.GRID_ORIGIN_Y) / C.TILE);
    if (tile(s, x, y) === "#" && !(endpointWall && x === endX && y === endY))
      return false;
  }
  return true;
}
export function blinded(s: StateView, p: Body): boolean {
  const f = s.forager;
  const dx = f.x - p.x,
    dy = f.y - p.y;
  const length = dx * dx + dy * dy;
  return s.inkClouds.some((c) => {
    const t = length
      ? Math.max(0, Math.min(1, ((c.x - p.x) * dx + (c.y - p.y) * dy) / length))
      : 0;
    return Math.hypot(c.x - p.x - t * dx, c.y - p.y - t * dy) <= c.radius;
  });
}
export function illuminate(s: FathomState): void {
  const f = s.forager;
  const flares = s.predators.filter((p) => p.flaring && p.state !== "den");
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const c = center(x, y);
      const live =
        (distance(f, c) <= s.visionRadius && lineOfSight(s, f, c, true)) ||
        flares.some((p) => distance(p, c) <= C.FLARE_RADIUS) ||
        s.tileMarks[y][x] > s.playTime;
      const old = s.visibility[y][x];
      writeCell(s.visibility, x, y, live ? "l" : old === "u" ? "u" : "r");
    }
  const passive = (b: Body) =>
    distance(f, b) <= s.visionRadius && lineOfSight(s, f, b);
  const flareLit = (b: Body) =>
    flares.some((p) => distance(p, b) <= C.FLARE_RADIUS);
  for (const p of s.predators)
    p.lit =
      p.state !== "den" &&
      (passive(p) ||
        flareLit(p) ||
        (p.kind !== "lanternjaw" && p.mark > 0) ||
        p.alert ||
        !!p.flareCharging);
  for (const d of s.drifters) d.lit = passive(d) || flareLit(d);
}
