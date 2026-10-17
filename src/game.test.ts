/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import {
  createEngine,
  ConstantClock,
  SequenceClock,
} from "@clockwyrks/simple-2d";
import type { Engine, Clock } from "@clockwyrks/simple-2d";
import { game, BACKGROUND } from "./game";
import type { FathomState, FathomDebugApi, StateView } from "./types";
import * as C from "./constants";
import { center, exits, flood, layer, maze, tile, writeCell } from "./world";
import { debug } from "./debug";

const engines: Engine<FathomState, FathomDebugApi>[] = [];
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async (url: string) => new Response(await readFile(String(url))),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
afterEach(() => {
  for (const e of engines) e.destroy();
  engines.length = 0;
});
async function setup(clock: Clock = new ConstantClock(1000 / C.TICK_HZ)) {
  const canvas = createCanvas(C.STAGE_W, C.STAGE_H);
  const events = new EventTarget();
  const played: string[] = [];
  const e = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    game,
    clock,
    background: BACKGROUND,
    layout: C.LAYOUT,
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => events,
    },
  });
  engines.push(e);
  e.events.on("cue:played", (v) => played.push(v.cue));
  await e.initialize();
  const key = (code: string, down = true) =>
    events.dispatchEvent(
      Object.assign(new Event(down ? "keydown" : "keyup"), {
        code,
        repeat: false,
      }),
    );
  const press = async (code: string) => {
    key(code);
    await e.advance(1);
    key(code, false);
  };
  const pointer = (type: string, x: number, y: number) =>
    events.dispatchEvent(
      Object.assign(new Event(type), {
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      }),
    );
  return { e, canvas, key, press, pointer, played };
}
function fixture(
  rows: Record<number, [number, number]> = { 5: [1, 30] },
): string[] {
  const result = layer("#");
  for (const [y, [start, end]] of Object.entries(rows))
    for (let x = start; x <= end; x++) writeCell(result, x, Number(y), ".");
  return result;
}
function arrange(
  e: Engine<FathomState, FathomDebugApi>,
  rows = fixture(),
  x = 5,
  y = 5,
): void {
  e.apply((s) => debug.setMaze(s, rows));
  e.apply((s) => debug.clearPlankton(s));
  e.apply((s) => debug.clearPredators(s));
  e.apply((s) => debug.setForagerTile(s, x, y));
  e.apply((s) => debug.setScreen(s, "playing"));
}
const body = (s: StateView) => s.predators[0];

describe("maze geometry", () => {
  it("is mirrored, connected, narrow, looped, and within all three proportions", () => {
    const rows = maze();
    const s = { ...engines[0]?.state, tiles: rows } as StateView;
    const points: { tx: number; ty: number }[] = [];
    let degrees = 0;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const t = rows[y][x],
          mirror = rows[y][C.GRID_COLS - 1 - x];
        if (!"dg".includes(t) && !"dg".includes(mirror)) expect(t).toBe(mirror);
        if (t !== ".") continue;
        const b = { ...center(x, y), dir: "up" as const };
        const count = exits(s, b).length;
        expect(count).toBeGreaterThanOrEqual(2);
        degrees += count;
        points.push({ tx: x, ty: y });
        expect(
          [tile(s, x + 1, y), tile(s, x, y + 1), tile(s, x + 1, y + 1)].every(
            (t) => t === ".",
          ),
        ).toBe(false);
      }
    expect(flood(s, points[0].tx, points[0].ty).size).toBe(points.length);
    expect(
      points.length / ((C.GRID_COLS - 2) * (C.GRID_ROWS - 2)),
    ).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(degrees / points.length).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(degrees / points.length).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    const todo = new Set(
      points
        .filter(
          (p) => exits(s, { ...center(p.tx, p.ty), dir: "up" }).length === 2,
        )
        .map((p) => `${p.tx},${p.ty}`),
    );
    const runs: number[] = [];
    while (todo.size) {
      const first = todo.values().next().value as string;
      todo.delete(first);
      const queue = [first];
      for (let i = 0; i < queue.length; i++) {
        const [x, y] = queue[i].split(",").map(Number);
        for (const d of exits(s, { ...center(x, y), dir: "up" })) {
          const [dx, dy] = {
            up: [0, -1],
            down: [0, 1],
            left: [-1, 0],
            right: [1, 0],
          }[d];
          const k = `${(x + dx + C.GRID_COLS) % C.GRID_COLS},${y + dy}`;
          if (todo.delete(k)) queue.push(k);
        }
      }
      runs.push(queue.length);
    }
    expect(
      runs.reduce((a, b) => a + b, 0) / runs.length,
    ).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(runs.reduce((a, b) => a + b, 0) / runs.length).toBeLessThanOrEqual(
      C.MAZE_MAZING_MAX,
    );
    expect(rows.filter((r) => r[0] === ".")).toHaveLength(1);
    expect(rows.join("").split("g")).toHaveLength(2);
  });
});
describe("engine integration and screens", () => {
  it("starts complete, loads real art, registers diagnostics, and preserves prior values", async () => {
    const { e } = await setup();
    const old = e.state;
    expect(old.screen).toBe("title");
    expect(old.art["trench-walls"]).toHaveLength(19);
    expect(old.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    expect(e.diagnostics().map((r) => r.name)).toContain("windowRadius");
    await e.advance(10);
    expect(old.simTime).toBe(0);
    expect(e.state.simTime).toBeCloseTo(10 * C.TICK_DT);
    expect(JSON.parse(JSON.stringify(debug.snapshot(e.state)))).toEqual(
      debug.snapshot(e.state),
    );
  });
  it("remembers the title selection, wraps menus and returns from howto", async () => {
    const { e, press } = await setup();
    await press("ArrowUp");
    expect(e.state.menuIndex).toBe(1);
    await press("Enter");
    expect(e.state.screen).toBe("howto");
    expect(e.state.titleIndex).toBe(1);
    await press("Escape");
    expect(e.state.screen).toBe("title");
    expect(e.state.menuIndex).toBe(1);
  });
  it("holds a consistent countdown, pauses once on Escape and resumes once", async () => {
    const { e, press } = await setup();
    await press("Enter");
    expect(e.state.screen).toBe("countdown");
    await e.advance(C.TICK_HZ * 2);
    expect(e.state.screen).toBe("playing");
    await press("Escape");
    expect(e.state.screen).toBe("paused");
    const pos = e.state.forager.x;
    await e.advance(20);
    expect(e.state.forager.x).toBe(pos);
    await press("Escape");
    expect(e.state.screen).toBe("playing");
  });
  it("confirms pointer clicks only if both edges land in the same region", async () => {
    const { e, pointer } = await setup();
    const r = debug.menuItemRect(e.state, 1)!;
    pointer("pointermove", r.x + 5, r.y + 5);
    await e.advance(1);
    expect(e.state.menuIndex).toBe(1);
    pointer("pointerdown", r.x + 5, r.y + 5);
    await e.advance(1);
    pointer("pointerup", 0, 0);
    await e.advance(1);
    expect(e.state.screen).toBe("title");
    pointer("pointerdown", r.x + 5, r.y + 5);
    pointer("pointerup", r.x + 5, r.y + 5);
    await e.advance(1);
    expect(e.state.screen).toBe("howto");
    pointer("pointerdown", 30, 40);
    pointer("pointerup", 30, 40);
    await e.advance(1);
    expect(e.state.screen).toBe("title");
  });
  it("mirrors the engine mute bit and still emits muted event cues", async () => {
    const { e, press, played } = await setup();
    await press("KeyM");
    expect(e.state.muted).toBe(true);
    arrange(e);
    await press("Space");
    expect(played).toContain(C.CUES.sonar);
    expect(e.state.muted).toBe(true);
  });
  it("renders every screen and records drawing with no state changes from render", async () => {
    const { e } = await setup();
    for (const screen of [
      "howto",
      "countdown",
      "playing",
      "paused",
      "cleared",
      "gameover",
      "title",
    ] as const) {
      e.apply((s) => debug.setScreen(s, screen));
      e.startRecording();
      await e.advance(1);
      const record = e.stopRecording();
      expect(record.frames).toHaveLength(1);
      expect(record.ops.length).toBeGreaterThan(20);
    }
  });
});
describe("fixed-step travel", () => {
  it("moves at the canonical rate and stops instantly when released", async () => {
    const { e, key } = await setup();
    arrange(e);
    key("ArrowRight");
    await e.advance(60);
    expect(e.state.forager.x).toBeCloseTo(
      center(5, 5).x + C.FORAGER_SPEED * 0.5,
    );
    key("ArrowRight", false);
    await e.advance(30);
    expect(e.state.forager.moving).toBe(false);
    expect(e.state.forager.x).toBeCloseTo(center(7, 5).x);
  });
  it("buffers a perpendicular turn until a center and reverses mid-tile", async () => {
    const { e, key } = await setup();
    const rows = fixture();
    for (let y = 5; y < 10; y++) writeCell(rows, 6, y, ".");
    arrange(e, rows);
    key("ArrowRight");
    await e.advance(10);
    const x = e.state.forager.x;
    key("ArrowRight", false);
    key("ArrowLeft");
    await e.advance(1);
    expect(e.state.forager.x).toBeLessThan(x);
    key("ArrowLeft", false);
    key("ArrowRight");
    await e.advance(10);
    key("ArrowRight", false);
    key("ArrowDown");
    await e.advance(30);
    expect(e.state.forager.x).toBeCloseTo(center(6, 5).x);
    expect(e.state.forager.y).toBeGreaterThan(center(6, 5).y);
  });
  it("carries continuous distance across the wrap edge", async () => {
    const { e, key } = await setup();
    arrange(e, fixture({ 5: [0, 35] }), 0);
    key("ArrowLeft");
    await e.advance(30);
    expect(e.state.forager.x).toBeCloseTo(center(35, 5).x);
    expect(e.state.forager.tx).toBe(35);
  });
  it("never moves a body from a closed fixture tile", async () => {
    const { e, key } = await setup();
    arrange(e);
    e.apply((s) => debug.setMaze(s, layer("#")));
    key("ArrowRight");
    await e.advance(60);
    expect(e.state.forager.x).toBe(center(5, 5).x);
  });
  it("runs exactly the same ticks under uneven frame deltas", async () => {
    const a = await setup(new ConstantClock(10)),
      b = await setup(new SequenceClock([3, 17]));
    arrange(a.e);
    arrange(b.e);
    a.key("ArrowRight");
    b.key("ArrowRight");
    await a.e.advance(50);
    await b.e.advance(50);
    expect(debug.snapshot(a.e.state)).toEqual(debug.snapshot(b.e.state));
  });
});
describe("food, cooldowns, fog, and progression", () => {
  it("eats for score and brightness and holds then halves its light", async () => {
    const { e, played } = await setup();
    arrange(e);
    e.apply((s) => debug.setPlankton(s, 5, 5, true));
    e.apply((s) => debug.setPlankton(s, 25, 5, true));
    await e.advance(1);
    expect(e.state.score).toBe(C.SCORE_PLANKTON);
    expect(e.state.brightness).toBe(C.BRIGHT_PER_EAT);
    expect(played).toContain(C.CUES.eat);
    await e.advance(C.TICK_HZ);
    expect(e.state.brightness).toBeCloseTo(C.BRIGHT_PER_EAT, 2);
    await e.advance(C.TICK_HZ * C.BRIGHT_HALFLIFE);
    expect(e.state.brightness).toBeCloseTo(C.BRIGHT_PER_EAT / 2, 2);
  });
  it("clears only by eating, awards the bonus and descends with score and lives", async () => {
    const { e } = await setup();
    arrange(e);
    await e.advance(1);
    expect(e.state.screen).toBe("playing");
    e.apply((s) => debug.setPlankton(s, 5, 5, true));
    await e.advance(1);
    expect(e.state.screen).toBe("cleared");
    expect(e.state.score).toBe(C.SCORE_PLANKTON + C.SCORE_CLEAR);
    await e.advance(220);
    expect(e.state.depth).toBe(2);
    expect(e.state.predators).toHaveLength(4);
    expect(e.state.screen).toBe("countdown");
  });
  it("remembers explored terrain after leaving and lets rock occlude passive light", async () => {
    const { e } = await setup();
    arrange(e);
    await e.advance(1);
    expect(e.state.visibility[5][5]).toBe("l");
    expect(e.state.visibility[3][5]).toBe("u");
    e.apply((s) => debug.setForagerTile(s, 25, 5));
    await e.advance(1);
    expect(e.state.visibility[5][5]).toBe("r");
    expect(e.state.windowRadius).toBe(C.KINDLE_VISION_MIN);
  });
  it("floods around a corner on arrival, marks hunters but not amber bodies", async () => {
    const { e, press } = await setup();
    const rows = fixture({ 5: [3, 8], 8: [8, 15] });
    for (let y = 5; y <= 8; y++) writeCell(rows, 8, y, ".");
    arrange(e, rows, 3);
    e.apply((s) => debug.addPredator(s, "gloamfin", 8, 8));
    e.apply((s) => debug.setPredatorMind(s, 0, false));
    e.apply((s) => debug.addPredator(s, "lanternjaw", 8, 8));
    e.apply((s) => debug.setPredatorMind(s, 1, false));
    await press("Space");
    expect(e.state.visibility[8][8]).toBe("u");
    await e.advance(70);
    expect(e.state.visibility[8][8]).toBe("l");
    expect(e.state.predators[0].lit).toBe(true);
    expect(e.state.predators[1].lit).toBe(false);
  });
  it("places stationary ink with its own cooldown and expiration", async () => {
    const { e, press, key } = await setup();
    arrange(e);
    await press("ShiftLeft");
    expect(e.state.inkClouds).toHaveLength(1);
    expect(e.state.ink.cooldown).toBe(C.INK_COOLDOWN);
    const x = e.state.inkClouds[0].x;
    key("ArrowRight");
    await e.advance(60);
    expect(e.state.inkClouds[0].x).toBe(x);
    await e.advance(301);
    expect(e.state.inkClouds).toHaveLength(0);
  });
  it("admits drifters only with a gate and plankton, and eats them for a bonus", async () => {
    const { e } = await setup();
    e.apply((s) => debug.clearPredators(s));
    e.apply((s) => debug.setScreen(s, "playing"));
    e.apply((s) => debug.setDrifterIn(s, 0));
    await e.advance(1);
    expect(e.state.drifters).toHaveLength(1);
    arrange(e);
    e.apply((s) => debug.clearDrifters(s));
    e.apply((s) => debug.spawnDrifter(s, 5, 5));
    e.apply((s) => debug.setDrifterMind(s, 0, false));
    await e.advance(1);
    expect(e.state.score).toBeGreaterThanOrEqual(C.SCORE_DRIFTER);
    expect(e.state.drifters).toHaveLength(0);
  });
  it("loses reserves, preserves food and fog, then ends with zero in reserve", async () => {
    const { e } = await setup();
    arrange(e);
    e.apply((s) => debug.setPlankton(s, 25, 5, true));
    await e.advance(1);
    e.apply((s) => debug.addPredator(s, "lanternjaw", 5, 5));
    e.apply((s) => debug.setPredatorMind(s, 0, false));
    await e.advance(1);
    expect(e.state.lives).toBe(C.START_LIVES - 1);
    expect(e.state.screen).toBe("countdown");
    expect(e.state.planktonRemaining).toBe(1);
    expect(e.state.visibility[5][5]).not.toBe("u");
    arrange(e);
    e.apply((s) => debug.setLives(s, 0));
    e.apply((s) => debug.addPredator(s, "flarefish", 5, 5));
    await e.advance(1);
    expect(e.state.screen).toBe("gameover");
    expect(e.state.lives).toBe(0);
  });
});
describe("three predator minds", () => {
  it("releases on a live-play schedule, independent of body travel", async () => {
    const { e } = await setup();
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    e.apply((s) => debug.setScreen(s, "playing"));
    await e.advance(1);
    expect(e.state.predators[0].released).toBe(true);
    expect(e.state.predators[0].state).toBe("den");
    expect(e.state.predators[1].released).toBe(false);
    await e.advance(C.TICK_HZ * 5);
    expect(e.state.predators[1].released).toBe(true);
    expect(e.state.predators[2].released).toBe(false);
  });
  it("lets the Lanternjaw hunt light, linger on a lost fix, and drop it to ink", async () => {
    const { e, press } = await setup();
    arrange(e);
    e.apply((s) => debug.addPredator(s, "lanternjaw", 8, 5));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(body(e.state).state).toBe("chase");
    expect(body(e.state).speed).toBe(C.PREDATOR_SPEED);
    expect(body(e.state).alert).toBe(false);
    e.apply((s) => debug.setForagerTile(s, 25, 5));
    await e.advance(120);
    expect(body(e.state).state).toBe("chase");
    await e.advance(121);
    expect(body(e.state).state).toBe("wander");
    expect(body(e.state).speed).toBe(C.DRIFTER_SPEED);
    e.apply((s) => debug.setForagerTile(s, 5, 5));
    await e.advance(1);
    await press("ShiftLeft");
    expect(body(e.state).state).toBe("wander");
  });
  it("hears through rock and ink, alerts, and respects mind-off exactly", async () => {
    const { e, press } = await setup();
    const rows = fixture({ 5: [4, 6], 7: [4, 6] });
    arrange(e, rows, 5, 5);
    e.apply((s) => debug.addPredator(s, "gloamfin", 5, 7));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await press("ShiftLeft");
    expect(body(e.state).hearingLock).toBe(true);
    expect(body(e.state).alert).toBe(true);
    expect(body(e.state).state).toBe("chase");
    expect(body(e.state).speed).toBe(C.GLOAMFIN_CHASE_SPEED);
    e.apply((s) => debug.setPredatorMind(s, 0, false));
    const old = body(e.state);
    e.apply((s) => debug.setForagerTile(s, 4, 5));
    await e.advance(20);
    expect(body(e.state).fix).toEqual(old.fix);
    expect(body(e.state).x).toBe(old.x);
  });
  it("acquires a sound fix on wave arrival, not when a pulse is cast", async () => {
    const { e, press } = await setup();
    arrange(e);
    e.apply((s) => debug.addPredator(s, "gloamfin", 12, 5));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await press("Space");
    expect(body(e.state).state).toBe("wander");
    await e.advance(61);
    expect(body(e.state).state).toBe("chase");
    expect(body(e.state).alert).toBe(true);
  });
  it("searches an empty sound fix, pings orange, and eventually gives up", async () => {
    const { e } = await setup();
    arrange(e);
    e.apply((s) => debug.addPredator(s, "gloamfin", 10, 5));
    e.apply((s) => debug.setForagerTile(s, 10, 5));
    e.apply((s) => debug.setPredatorState(s, 0, "chase"));
    e.apply((s) => debug.setForagerTile(s, 25, 5));
    await e.advance(1);
    expect(body(e.state).state).toBe("search");
    await e.advance(145);
    expect(e.state.pulses.some((p) => p.tint === "orange")).toBe(true);
    await e.advance(490);
    expect(body(e.state).state).toBe("wander");
  });
  it("routes a chase around rock instead of driving into it", async () => {
    const { e } = await setup();
    const rows = fixture({ 5: [4, 9], 8: [4, 9] });
    for (let y = 5; y <= 8; y++) {
      writeCell(rows, 4, y, ".");
      writeCell(rows, 9, y, ".");
    }
    arrange(e, rows, 9, 8);
    e.apply((s) => debug.addPredator(s, "gloamfin", 4, 5));
    e.apply((s) => debug.setPredatorState(s, 0, "chase"));
    await e.advance(50);
    const p = body(e.state);
    expect(tile(e.state, p.tx, p.ty)).toBe(".");
    expect(p.x > center(4, 5).x || p.y > center(4, 5).y).toBe(true);
  });
  it("charges, blooms through rock, and ends the bloom when it locks on", async () => {
    const { e, played } = await setup();
    const rows = fixture({ 5: [3, 30], 10: [3, 30] });
    arrange(e, rows, 25, 5);
    e.apply((s) => debug.addPredator(s, "flarefish", 5, 10));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(C.TICK_HZ * C.FLARE_INTERVAL + 2);
    expect(body(e.state).flareCharging).toBe(true);
    await e.advance(C.TICK_HZ * C.FLARE_CHARGE);
    expect(body(e.state).flaring).toBe(true);
    expect(played).toContain(C.CUES.flare);
    expect(e.state.visibility[9][5]).toBe("l");
    e.apply((s) => debug.setForagerTile(s, 5, 5));
    await e.advance(1);
    expect(body(e.state).state).toBe("chase");
    expect(body(e.state).flaring).toBe(false);
    expect(body(e.state).alert).toBe(true);
  });
});
describe("additional interaction and sensing edges", () => {
  it("keeps remembered ground black outside the exact circular window", async () => {
    const { e, canvas } = await setup();
    arrange(e);
    await e.advance(1);
    const c = center(5, 5);
    e.apply((s) => debug.setForagerTile(s, 25, 5));
    await e.advance(1);
    expect(e.state.visibility[5][5]).toBe("r");
    expect([
      ...canvas.getContext("2d").getImageData(c.x, c.y, 1, 1).data,
    ]).toEqual([3, 6, 12, 255]);
    e.apply((s) => debug.setForagerTile(s, 5, 5));
    await e.advance(1);
    expect(e.state.visibility[5][5]).toBe("l");
  });

  it("handles restart, quit, replay, and game-over back with the remembered title entry", async () => {
    const { e, press } = await setup();
    e.apply((s) => debug.setTitleIndex(s, 1));
    e.apply((s) => debug.setScreen(s, "paused"));
    e.apply((s) => debug.setMenuIndex(s, 1));
    e.apply((s) => debug.setScore(s, 500));
    await press("Enter");
    expect(e.state.score).toBe(0);
    expect(e.state.screen).toBe("countdown");
    e.apply((s) => debug.setScreen(s, "paused"));
    e.apply((s) => debug.setMenuIndex(s, 2));
    await press("Enter");
    expect(e.state.menuIndex).toBe(1);
    e.apply((s) => debug.setScreen(s, "gameover"));
    await press("Enter");
    expect(e.state.screen).toBe("countdown");
    e.apply((s) => debug.setScreen(s, "gameover"));
    await press("Escape");
    expect(e.state.screen).toBe("title");
    expect(e.state.menuIndex).toBe(1);
  });

  it("drops Gloamfin chase speed at a corner and ramps back to its cap", async () => {
    const { e } = await setup();
    const rows = fixture({ 5: [4, 9] });
    for (let y = 5; y <= 16; y++) writeCell(rows, 9, y, ".");
    arrange(e, rows, 9, 16);
    e.apply((s) => debug.addPredator(s, "gloamfin", 4, 5));
    e.apply((s) => debug.setPredatorDir(s, 0, "right"));
    e.apply((s) => debug.setPredatorState(s, 0, "chase"));
    for (let i = 0; i < 170 && body(e.state).dir !== "down"; i++)
      await e.advance(1);
    expect(body(e.state).dir).toBe("down");
    expect(body(e.state).speed).toBe(C.GLOAMFIN_CORNER_SPEED);
    await e.advance(C.TICK_HZ * C.GLOAMFIN_RAMP_TIME);
    expect(body(e.state).speed).toBe(C.GLOAMFIN_CHASE_SPEED);
  });

  it("runs minds with travel disabled, but holds bodies with their minds disabled", async () => {
    const { e } = await setup();
    arrange(e);
    e.apply((s) => debug.addPredator(s, "flarefish", 8, 5));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(body(e.state).state).toBe("chase");
    expect(body(e.state).x).toBe(center(8, 5).x);
    e.apply((s) => debug.setForagerTile(s, 25, 5));
    e.apply((s) => debug.setPredatorMind(s, 0, false));
    await e.advance(C.TICK_HZ * 3);
    expect(body(e.state).state).toBe("chase");
    expect(body(e.state).x).toBe(center(8, 5).x);
  });
});

describe("debug contract", () => {
  it("reconciles purely, never relights fog, and resets every run field", async () => {
    const { e } = await setup();
    arrange(e);
    e.apply((s) => debug.setBrightness(s, 1));
    e.apply((s) => debug.setDepth(s, 9));
    e.apply((s) => debug.setScore(s, 900));
    e.apply((s) => debug.clearFog(s));
    const before = debug.snapshot(e.state);
    e.apply((s) => debug.reconcile(s));
    expect(debug.snapshot(e.state)).toEqual(before);
    expect(e.state.windowRadius).toBe(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN,
    );
    expect(e.state.sonar.range).toBe(C.SONAR_RANGE_MIN);
    expect(e.state.predators).toHaveLength(C.ROSTER_CAP * C.DEN_ORDER.length);
    e.apply((s) => debug.reset(s));
    expect(e.state.screen).toBe("title");
    expect(e.state.score).toBe(0);
    expect(e.state.simTime).toBe(0);
    expect(e.state.titleIndex).toBe(0);
  });
  it("poses every creature control without changing unrelated fields", async () => {
    const { e } = await setup();
    arrange(e);
    e.apply((s) => debug.setForagerDir(s, "right"));
    e.apply((s) => debug.addPredator(s, "lanternjaw", 9, 5));
    e.apply((s) => debug.setPredatorDir(s, 0, "left"));
    e.apply((s) => debug.setPredatorReleased(s, 0, false));
    e.apply((s) => debug.setPredatorTile(s, 0, 8, 5));
    e.apply((s) => debug.setPredatorState(s, 0, "wander"));
    expect(body(e.state).dir).toBe("left");
    expect(body(e.state).released).toBe(false);
    expect(e.state.forager.dir).toBe("right");
    e.apply((s) => debug.spawnDrifter(s, 20, 5));
    e.apply((s) => debug.setDrifterMind(s, 0, false));
    e.apply((s) => debug.setDrifterTravel(s, 0, false));
    e.apply((s) => debug.setSonarCooldown(s, 5));
    e.apply((s) => debug.setInkCooldown(s, 7));
    const before = debug.snapshot(e.state);
    e.apply((s) => debug.reconcile(s));
    expect(debug.snapshot(e.state)).toEqual(before);
    e.apply((s) => debug.clearDrifters(s));
    expect(e.state.drifters).toHaveLength(0);
    e.apply((s) => debug.reset(s));
    e.apply((s) => debug.setPredatorTile(s, 0, 17, 8));
    e.apply((s) => debug.setPredatorState(s, 0, "den"));
    expect(body(e.state).state).toBe("den");
  });

  it("rejects malformed domains instead of clamping or silently doing nothing", async () => {
    const { e } = await setup();
    expect(() => debug.setBrightness(e.state, 2)).toThrow();
    expect(() => debug.setScore(e.state, -1)).toThrow();
    expect(() => debug.setLives(e.state, 0.5)).toThrow();
    expect(() => debug.setDepth(e.state, 0)).toThrow();
    expect(() => debug.setMaze(e.state, ["."])).toThrow();
    expect(() => debug.setPredatorMind(e.state, 20, false)).toThrow();
    expect(() => debug.setPlankton(e.state, 0, 0, true)).toThrow();
    expect(() => debug.setBrightHold(e.state, C.BRIGHT_HOLD + 1)).toThrow();
    expect(() => debug.setTitleIndex(e.state, 2)).toThrow();
    expect(() => debug.setSonarCooldown(e.state, NaN)).toThrow();
  });
  it("leaves fixtures exact and permits posed extras beyond the normal limits", async () => {
    const { e } = await setup();
    arrange(e);
    const rows = fixture();
    e.apply((s) => debug.setMaze(s, rows));
    expect(e.state.tiles).toEqual(rows);
    for (let i = 0; i < 4; i++) e.apply((s) => debug.spawnDrifter(s, 20, 5));
    expect(e.state.drifters).toHaveLength(4);
    e.apply((s) => debug.setDrifterTravel(s, 0, false));
    e.apply((s) => debug.setDrifterMind(s, 1, false));
    e.apply((s) => debug.setSonarCooldown(s, 100));
    e.apply((s) => debug.setInkCooldown(s, 100));
    expect(e.state.sonar.cooldown).toBe(100);
    expect(e.state.ink.ready).toBe(false);
    expect(debug.menuItemRect(e.state, 0)).toBeNull();
    expect(() => debug.setMenuIndex(e.state, 0)).toThrow();
  });
});
