import * as C from "./constants";
import type {
  Direction,
  FathomDebugApi,
  FathomState,
  Predator,
  Screen,
  StateView,
  Snapshot,
} from "./types";
import {
  beginDive,
  center,
  changeScreen,
  clone,
  drifter,
  fresh,
  layer,
  open,
  predator,
  reconcile,
  roster,
  tile,
  writeCell,
} from "./world";

export function menuItems(s: StateView): readonly string[] {
  return s.screen === "title"
    ? C.TITLE_ITEMS
    : s.screen === "paused"
      ? C.PAUSE_ITEMS
      : s.screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function menuItemRect(s: StateView, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= menuItems(s).length)
    return null;
  return {
    x: s.screen === "title" ? 130 : 470,
    y: (s.screen === "title" ? 422 : 360) + index * 62,
    w: 340,
    h: 50,
  };
}
function valid(ok: boolean, message = "Invalid Fathom pose"): asserts ok {
  if (!ok) throw new RangeError(message);
}
const number = (n: number, min = 0, max = Infinity) =>
  valid(Number.isFinite(n) && n >= min && n <= max);
const integer = (n: number, min = 0, max = Infinity) => {
  number(n, min, max);
  valid(Number.isInteger(n));
};
const direction = (d: Direction) =>
  valid(["up", "down", "left", "right"].includes(d));
const bool = (b: boolean) => valid(typeof b === "boolean");
function cell(s: StateView, x: number, y: number, den = false) {
  integer(x, 0, C.GRID_COLS - 1);
  integer(y, 0, C.GRID_ROWS - 1);
  valid(open(s, x, y, den), "Tile is not open to this body");
}
function pose(s: StateView, fn: (n: FathomState) => void): FathomState {
  const n = clone(s);
  fn(n);
  return reconcile(n);
}
function hunter(
  s: StateView,
  i: number,
  fn: (p: Predator, n: FathomState) => void,
): FathomState {
  integer(i, 0, s.predators.length - 1);
  return pose(s, (n) => fn(n.predators[i], n));
}
function jelly(
  s: StateView,
  i: number,
  enabled: boolean,
  field: "mind" | "travel",
): FathomState {
  integer(i, 0, s.drifters.length - 1);
  bool(enabled);
  return pose(s, (n) => {
    n.drifters[i][field] = enabled;
  });
}
export function snapshot(s: StateView): Snapshot {
  return {
    version: s.version,
    screen: s.screen,
    menuIndex: s.menuIndex,
    titleIndex: s.titleIndex,
    depth: s.depth,
    score: s.score,
    lives: s.lives,
    muted: s.muted,
    planktonRemaining: s.planktonRemaining,
    drifterIn: s.drifterIn,
    brightness: s.brightness,
    brightHold: s.brightHold,
    visionRadius: s.visionRadius,
    windowRadius: s.windowRadius,
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    grid: { ...s.grid },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: {
      x: s.forager.x,
      y: s.forager.y,
      tx: s.forager.tx,
      ty: s.forager.ty,
      dir: s.forager.dir,
      moving: s.forager.moving,
    },
    drifters: s.drifters.map(({ x, y, tx, ty, lit, mind, travel }) => ({
      x,
      y,
      tx,
      ty,
      lit,
      mind,
      travel,
    })),
    predators: s.predators.map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      tx: p.tx,
      ty: p.ty,
      dir: p.dir,
      state: p.state,
      released: p.released,
      mind: p.mind,
      travel: p.travel,
      speed: p.speed,
      alert: p.alert,
      lit: p.lit,
      detectRange: p.detectRange,
      hearingRange: p.hearingRange,
      hearingLock: p.hearingLock,
      flareCharging: p.flareCharging,
      flaring: p.flaring,
      flareRadius: p.flareRadius,
    })),
    pulses: s.pulses.map(({ source, tint, ox, oy, front, range }) => ({
      source,
      tint,
      ox,
      oy,
      front,
      range,
    })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    simTime: s.simTime,
  };
}
export const debug: FathomDebugApi = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s) => fresh(s.art as FathomState["art"], s.muted),
  snapshot,
  reconcile,
  setScreen(s, screen: Screen) {
    valid(
      [
        "title",
        "howto",
        "countdown",
        "playing",
        "paused",
        "cleared",
        "gameover",
      ].includes(screen),
    );
    return pose(s, (n) => changeScreen(n, screen));
  },
  setMenuIndex(s, i) {
    integer(i, 0, menuItems(s).length - 1);
    return pose(s, (n) => {
      n.menuIndex = i;
    });
  },
  setTitleIndex(s, i) {
    integer(i, 0, C.TITLE_ITEMS.length - 1);
    return pose(s, (n) => {
      n.titleIndex = i;
    });
  },
  menuItemRect,
  setScore(s, v) {
    integer(v);
    return pose(s, (n) => {
      n.score = v;
    });
  },
  setLives(s, v) {
    integer(v);
    return pose(s, (n) => {
      n.lives = v;
    });
  },
  setDepth(s, d) {
    integer(d, 1);
    return pose(s, (n) => {
      n.depth = d;
      n.predators = roster(d);
    });
  },
  setMaze(s, rows) {
    valid(
      Array.isArray(rows) &&
        rows.length === C.GRID_ROWS &&
        rows.every(
          (r) =>
            typeof r === "string" &&
            r.length === C.GRID_COLS &&
            /^[#.gd]+$/.test(r),
        ),
    );
    const all = rows.join("");
    const gates = [...all].filter((c) => c === "g").length;
    valid(!/[dg]/.test(all) || gates === 1);
    return pose(s, (n) => {
      n.tiles = [...rows];
    });
  },
  setPlankton(s, x, y, present) {
    cell(s, x, y);
    bool(present);
    return pose(s, (n) => writeCell(n.plankton, x, y, present ? "*" : "-"));
  },
  clearPlankton: (s) =>
    pose(s, (n) => {
      n.plankton = layer("-");
    }),
  clearFog: (s) =>
    pose(s, (n) => {
      n.visibility = layer("u");
      n.tileMarks = n.tileMarks.map((r) => r.map(() => 0));
    }),
  setForagerTile(s, x, y) {
    cell(s, x, y);
    return pose(s, (n) => {
      Object.assign(n.forager, center(x, y), {
        moving: false,
        desired: n.forager.dir,
      });
    });
  },
  setForagerDir(s, d) {
    direction(d);
    return pose(s, (n) => {
      n.forager.dir = d;
      n.forager.desired = d;
      n.forager.moving = false;
    });
  },
  setBrightness(s, g) {
    number(g, 0, 1);
    return pose(s, (n) => {
      n.brightness = g;
    });
  },
  setBrightHold(s, v) {
    number(v, 0, C.BRIGHT_HOLD);
    return pose(s, (n) => {
      n.brightHold = v;
    });
  },
  clearPredators: (s) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator(s, k, x, y) {
    valid(C.DEN_ORDER.includes(k));
    cell(s, x, y);
    return pose(s, (n) => {
      n.predators.push(predator(k, x, y));
    });
  },
  setPredatorTile(s, i, x, y) {
    cell(s, x, y, true);
    return hunter(s, i, (p) => Object.assign(p, center(x, y)));
  },
  setPredatorDir(s, i, d) {
    direction(d);
    return hunter(s, i, (p) => {
      p.dir = d;
    });
  },
  setPredatorState(s, i, value) {
    valid(["den", "wander", "chase"].includes(value));
    return hunter(s, i, (p, n) => {
      valid(
        value === "den"
          ? ["d", "g"].includes(tile(n, p.tx, p.ty))
          : tile(n, p.tx, p.ty) === ".",
      );
      p.state = value;
      p.fix = value === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = value === "chase" ? C.LINGER_TIME : 0;
      p.alert = false;
      p.alertLeft = 0;
      p.searchTime = 0;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
      if (p.kind === "flarefish") {
        p.flareIn = C.FLARE_INTERVAL;
        p.flareTime = 0;
        p.flaring = false;
        p.flareCharging = false;
        p.flareRadius = 0;
      }
    });
  },
  setPredatorReleased(s, i, v) {
    bool(v);
    return hunter(s, i, (p) => {
      p.released = v;
    });
  },
  setPredatorMind(s, i, v) {
    bool(v);
    return hunter(s, i, (p) => {
      p.mind = v;
    });
  },
  setPredatorTravel(s, i, v) {
    bool(v);
    return hunter(s, i, (p) => {
      p.travel = v;
    });
  },
  spawnDrifter(s, x, y) {
    cell(s, x, y);
    return pose(s, (n) => {
      n.drifters.push(drifter(x, y));
    });
  },
  clearDrifters: (s) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s, i, v) => jelly(s, i, v, "mind"),
  setDrifterTravel: (s, i, v) => jelly(s, i, v, "travel"),
  setDrifterIn(s, v) {
    number(v, 0, C.DRIFTER_INTERVAL);
    return pose(s, (n) => {
      n.drifterIn = v;
    });
  },
  setSonarCooldown(s, v) {
    number(v);
    return pose(s, (n) => {
      n.sonar.cooldown = v;
    });
  },
  setInkCooldown(s, v) {
    number(v);
    return pose(s, (n) => {
      n.ink.cooldown = v;
    });
  },
};

export { beginDive };
