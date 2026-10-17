import type { UpdateApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { Direction, FathomState, Predator, StateView } from "./types";
import { menuItemRect, menuItems } from "./debug";
import {
  atCenter,
  beginDive,
  blinded,
  changeScreen,
  clone,
  DIRS,
  distance,
  drifter,
  exits,
  flood,
  fresh,
  illuminate,
  lineOfSight,
  move,
  neighbor,
  opposite,
  path,
  random,
  reconcile,
  resetAttempt,
  returnTitle,
  tile,
  wander,
  writeCell,
} from "./world";

// Timer endpoints are exact tick boundaries, not an extra tick of floating-point dust.
const down = (n: number) => (n <= C.TICK_DT + 1e-10 ? 0 : n - C.TICK_DT);
function fix(s: FathomState, p: Predator): void {
  if (p.state !== "chase") {
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
    if (p.kind !== "lanternjaw") p.alertLeft = C.ALERT_TIME;
  }
  p.state = "chase";
  p.fix = { tx: s.forager.tx, ty: s.forager.ty };
  p.linger = C.LINGER_TIME;
  if (p.kind === "flarefish") {
    if (p.flaring) p.fade = 0.35;
    p.flareTime = 0;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
  }
}
function drop(p: Predator): void {
  p.state = "wander";
  p.fix = null;
  p.linger = 0;
  if (p.kind === "flarefish") {
    p.flareIn = C.FLARE_INTERVAL;
    p.flareTime = 0;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
  }
}
function cast(
  s: FathomState,
  p: Predator | null,
  index: number | null,
  tint: "cyan" | "violet" | "orange",
  cues: Set<C.CueName>,
): void {
  const b = p ?? s.forager;
  s.pulses.push({
    source: p ? "gloamfin" : "forager",
    tint,
    ox: b.tx,
    oy: b.ty,
    front: -1e-7,
    range: p ? C.GLOAMFIN_PING_RANGE : s.sonar.range,
    owner: index,
    caught: false,
  });
  if (p) {
    p.pingIn = C.GLOAMFIN_PING_INTERVAL;
    p.pingAgo = 0;
    cues.add(C.CUES.predatorPing);
  } else {
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    cues.add(C.CUES.sonar);
  }
}
function pulses(s: FathomState): void {
  for (const pulse of s.pulses) {
    const old = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const map = flood(s, pulse.ox, pulse.oy);
    const reached = (x: number, y: number) => {
      const d = map.get(`${x},${y}`);
      return d !== undefined && d > old && d <= pulse.front && d <= pulse.range;
    };
    if (pulse.source === "forager") {
      for (const [key, d] of map)
        if (d > old && d <= pulse.front && d <= pulse.range) {
          const [x, y] = key.split(",").map(Number);
          s.tileMarks[y][x] = s.playTime + C.SONAR_MARK_TIME;
          for (const dir of DIRS) {
            const [nx, ny] = neighbor(s, x, y, dir);
            if (tile(s, nx, ny) === "#" && s.tileMarks[ny]?.[nx] !== undefined)
              s.tileMarks[ny][nx] = s.playTime + C.SONAR_MARK_TIME;
          }
        }
      for (const p of s.predators)
        if (p.state !== "den" && reached(p.tx, p.ty)) {
          if (p.kind !== "lanternjaw") p.mark = C.SONAR_MARK_TIME;
          if (p.kind === "gloamfin" && p.mind) fix(s, p);
        }
    } else if (!pulse.caught && reached(s.forager.tx, s.forager.ty)) {
      pulse.caught = true;
      const p = pulse.owner === null ? undefined : s.predators[pulse.owner];
      if (p?.mind && p.state !== "den") fix(s, p);
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}
function senses(
  s: FathomState,
  p: Predator,
  index: number,
  cues: Set<C.CueName>,
): void {
  const dt = C.TICK_DT;
  if (
    p.state === "den" &&
    p.releaseAt !== null &&
    s.playTime + 1e-7 >= p.releaseAt
  )
    p.released = true;
  if (!p.mind) {
    p.alert = p.alertLeft > 0;
    return;
  }
  if (p.state === "den") {
    const gate = s.tiles.flatMap((r, y) =>
      [...r].flatMap((t, x) => (t === "g" ? [{ tx: x, ty: y }] : [])),
    )[0];
    if (!gate || !s.tiles.some((r) => r.includes("d"))) return;
    if (p.released && p.travel) {
      const target =
        tile(s, p.tx, p.ty) === "g"
          ? exits(s, p, true)
              .map((d) => neighbor(s, p.tx, p.ty, d))
              .filter(([x, y]) => tile(s, x, y) === ".")
              .map(([tx, ty]) => ({ tx, ty }))[0]
          : gate;
      if (target) move(s, p, p.speed, () => path(s, p, target, true), true);
      if (tile(s, p.tx, p.ty) === ".") p.state = "wander";
    }
    return;
  }
  if (p.kind === "gloamfin") {
    const wasLock = p.hearingLock;
    p.hearingLock = distance(p, s.forager) <= C.GLOAMFIN_HEAR;
    p.pingIn = down(p.pingIn);
    p.pingAgo += dt;
    if (p.hearingLock) fix(s, p);
    if (wasLock && !p.hearingLock) p.pingIn = 0;
    if (
      p.state === "chase" &&
      p.fix &&
      p.tx === p.fix.tx &&
      p.ty === p.fix.ty &&
      (p.tx !== s.forager.tx || p.ty !== s.forager.ty)
    ) {
      p.state = "search";
      p.searchTime = 0;
      p.searchPing = false;
    }
    if (p.state === "search") {
      p.searchTime += dt;
      if (p.searchTime >= C.GLOAMFIN_GIVEUP) drop(p);
    }
    const guaranteed =
      p.state === "search" &&
      !p.searchPing &&
      p.searchTime >= C.GLOAMFIN_SEARCH_DELAY;
    if (
      !p.hearingLock &&
      p.pingAgo + 1e-7 >= C.GLOAMFIN_PING_MIN_GAP &&
      (guaranteed || p.pingIn === 0)
    ) {
      cast(s, p, index, guaranteed ? "orange" : "violet", cues);
      if (guaranteed) p.searchPing = true;
    }
    p.chaseSpeed = Math.min(
      C.GLOAMFIN_CHASE_SPEED,
      p.chaseSpeed +
        ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * dt) /
          C.GLOAMFIN_RAMP_TIME,
    );
  } else {
    const blind = blinded(s, p);
    const sees =
      !blind &&
      distance(p, s.forager) <= (p.detectRange ?? 0) &&
      lineOfSight(s, p, s.forager);
    const bloomLock =
      p.kind === "flarefish" &&
      p.flaring &&
      !blind &&
      distance(p, s.forager) <= C.FLARE_RADIUS;
    if (blind && p.state === "chase") drop(p);
    else if (sees || bloomLock) fix(s, p);
    else if (p.state === "chase") {
      p.linger = down(p.linger);
      if (p.linger === 0) drop(p);
    }
    if (p.kind === "flarefish" && p.state === "wander") {
      if (p.flareTime > 0) {
        const before = p.flareTime;
        p.flareTime += dt;
        if (before < C.FLARE_CHARGE && p.flareTime + 1e-7 >= C.FLARE_CHARGE)
          cues.add(C.CUES.flare);
        if (p.flareTime >= C.FLARE_CHARGE + C.FLARE_BLOOM) {
          p.flareTime = 0;
          p.flareIn = C.FLARE_INTERVAL;
          p.fade = 0.35;
        }
      } else {
        p.flareIn = down(p.flareIn);
        if (p.flareIn === 0) p.flareTime = dt;
      }
      p.flareCharging = p.flareTime > 0 && p.flareTime < C.FLARE_CHARGE;
      p.flaring = p.flareTime >= C.FLARE_CHARGE;
      p.flareRadius = p.flaring ? C.FLARE_RADIUS : 0;
      // The bloom's sense is continuous, including its opening tick.
      if (p.flaring && !blind && distance(p, s.forager) <= C.FLARE_RADIUS)
        fix(s, p);
    }
  }
  p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
  p.speed =
    p.kind === "lanternjaw" && p.state === "wander"
      ? C.DRIFTER_SPEED
      : p.kind === "gloamfin" && p.state === "chase"
        ? p.chaseSpeed
        : C.PREDATOR_SPEED;
  if (p.travel) {
    const choose = (): Direction => {
      if (p.state === "chase" && p.fix) {
        if (p.tx === p.fix.tx && p.ty === p.fix.ty) {
          if (
            p.kind === "gloamfin" &&
            (p.tx !== s.forager.tx || p.ty !== s.forager.ty)
          ) {
            p.state = "search";
            p.searchTime = 0;
            p.searchPing = false;
          } else return p.dir;
        }
        if (p.state === "chase") return path(s, p, p.fix);
      }
      if (p.state === "search" && p.fix) {
        const distances = flood(s, p.fix.tx, p.fix.ty);
        const options = exits(s, p).filter((d) => {
          const [x, y] = neighbor(s, p.tx, p.ty, d);
          return (
            (distances.get(`${x},${y}`) ?? Infinity) <= C.GLOAMFIN_SEARCH_ROAM
          );
        });
        const forward = options.filter((d) => d !== opposite(p.dir));
        const choices = forward.length ? forward : options;
        return choices.length
          ? choices[Math.floor(random(s) * choices.length)]
          : path(s, p, p.fix);
      }
      return wander(s, p);
    };
    const oldDir = p.dir;
    if (p.state === "chase" && p.fix) {
      const dir = path(s, p, p.fix);
      if (dir === opposite(p.dir)) p.dir = dir;
    }
    const holding =
      p.state === "chase" &&
      p.kind !== "gloamfin" &&
      p.fix &&
      p.tx === p.fix.tx &&
      p.ty === p.fix.ty &&
      atCenter(p);
    if (!holding) move(s, p, p.speed, choose);
    if (
      p.kind === "gloamfin" &&
      p.state === "chase" &&
      p.dir !== oldDir &&
      p.dir !== opposite(oldDir)
    ) {
      p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
      p.speed = p.chaseSpeed;
    }
  }
}
/** A single render-free transition over an owned draft. All timers use this clock. */
export function tick(s: FathomState, held: Direction | null): Set<C.CueName> {
  const cues = new Set<C.CueName>();
  s.simTime += C.TICK_DT;
  if (s.screen === "countdown") {
    s.screenTime += C.TICK_DT;
    illuminate(s);
    if (s.screenTime + 1e-7 >= 2) {
      changeScreen(s, "playing");
      for (const p of s.predators) if (p.releaseAt === 0) p.released = true;
    }
    return cues;
  }
  if (s.screen === "cleared") {
    s.screenTime += C.TICK_DT;
    if (s.screenTime >= 1.8) {
      const n = fresh(s.art, s.muted);
      n.depth = s.depth + 1;
      n.score = s.score;
      n.lives = s.lives;
      n.titleIndex = s.titleIndex;
      n.simTime = s.simTime;
      n.accumulator = s.accumulator;
      Object.assign(s, n);
      resetAttempt(s);
    }
    return cues;
  }
  if (s.screen !== "playing") return cues;
  s.playTime += C.TICK_DT;
  s.sonar.cooldown = down(s.sonar.cooldown);
  s.ink.cooldown = down(s.ink.cooldown);
  if (s.brightHold > 0) s.brightHold = down(s.brightHold);
  else s.brightness *= 0.5 ** (C.TICK_DT / C.BRIGHT_HALFLIFE);
  s.inkClouds = s.inkClouds
    .map((c) => ({ ...c, remaining: down(c.remaining) }))
    .filter((c) => c.remaining > 0);
  if (s.pendingSonar && s.sonar.cooldown === 0)
    cast(s, null, null, "cyan", cues);
  if (s.pendingInk && s.ink.cooldown === 0) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    cues.add(C.CUES.ink);
  }
  s.pendingSonar = false;
  s.pendingInk = false;
  const f = s.forager;
  if (held) {
    f.desired = held;
    if (held === opposite(f.dir)) f.dir = held;
    f.moving = move(s, f, C.FORAGER_SPEED, () =>
      exits(s, f).includes(f.desired) ? f.desired : f.dir,
    );
  } else f.moving = false;
  let ate = false;
  if (tile(s, f.tx, f.ty) === "." && s.plankton[f.ty]?.[f.tx] === "*") {
    writeCell(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cues.add(C.CUES.eat);
    ate = true;
  }
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  for (const p of s.predators)
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
  for (const p of s.predators) {
    p.alertLeft = down(p.alertLeft);
    p.mark = down(p.mark);
    p.fade = down(p.fade);
  }
  pulses(s);
  s.predators.forEach((p, i) => senses(s, p, i, cues));
  s.drifterIn = down(s.drifterIn);
  if (
    s.drifterIn === 0 &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const gy = s.tiles.findIndex((r) => r.includes("g"));
    const gx = gy < 0 ? -1 : s.tiles[gy].indexOf("g");
    if (gx >= 0) {
      const adjacent = DIRS.map((d) => neighbor(s, gx, gy, d)).find(
        ([x, y]) => tile(s, x, y) === ".",
      );
      if (adjacent) {
        s.drifters.push(drifter(...adjacent));
        s.drifterIn = C.DRIFTER_INTERVAL;
      }
    }
  }
  for (const d of s.drifters)
    if (d.mind && d.travel) move(s, d, C.DRIFTER_SPEED, () => wander(s, d));
  s.drifters = s.drifters.filter((d) => {
    if (d.tx === f.tx && d.ty === f.ty) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  illuminate(s);
  if (
    s.predators.some((p) => p.state !== "den" && p.tx === f.tx && p.ty === f.ty)
  ) {
    cues.add(C.CUES.caught);
    if (s.lives === 0) changeScreen(s, "gameover");
    else {
      s.lives--;
      resetAttempt(s);
      illuminate(s);
    }
  } else if (ate && s.planktonRemaining === 0) {
    s.score += C.SCORE_CLEAR;
    changeScreen(s, "cleared");
    cues.add(C.CUES.descend);
  }
  return cues;
}
function confirm(s: FathomState): FathomState {
  const i = s.menuIndex;
  if (s.screen === "title") {
    s.titleIndex = i ?? 0;
    if (i === 0) return beginDive(s);
    changeScreen(s, "howto");
  } else if (s.screen === "paused") {
    if (i === 0) changeScreen(s, "playing");
    else if (i === 1) return beginDive(s);
    else return returnTitle(s);
  } else if (s.screen === "gameover") {
    if (i === 0) return beginDive(s);
    return returnTitle(s);
  }
  return s;
}
export function update(
  state: StateView,
  api: UpdateApi,
  dt: number,
): FathomState {
  let s = clone(state);
  const readable: readonly C.ActionName[] =
    state.screen === "playing"
      ? ["up", "down", "left", "right", "a", "b", "pause", "mute"]
      : state.screen === "paused"
        ? ["up", "down", "confirm", "back", "pause", "mute"]
        : state.screen === "title" || state.screen === "gameover"
          ? ["up", "down", "confirm", "back", "mute"]
          : state.screen === "howto"
            ? ["confirm", "back", "mute"]
            : ["mute"];
  const pressed = new Set(readable.filter((a) => api.input.pressed(a)));
  if (pressed.has("mute")) api.audio.setMuted(!api.audio.muted());
  s.muted = api.audio.muted();
  const screen = s.screen;
  if (screen === "playing") {
    if (pressed.has("pause")) changeScreen(s, "paused");
    else {
      s.pendingSonar ||= pressed.has("a");
      s.pendingInk ||= pressed.has("b");
    }
  } else if (
    screen === "paused" &&
    (pressed.has("pause") || pressed.has("back"))
  )
    changeScreen(s, "playing");
  else if ((screen === "howto" || screen === "gameover") && pressed.has("back"))
    s = returnTitle(s);
  else {
    const items = menuItems(s);
    let accept = pressed.has("confirm");
    if (items.length) {
      if (pressed.has("up"))
        s.menuIndex = ((s.menuIndex ?? 0) + items.length - 1) % items.length;
      if (pressed.has("down"))
        s.menuIndex = ((s.menuIndex ?? 0) + 1) % items.length;
    }
    for (const sample of api.input.pointerSamples()) {
      if (!sample.primary) continue;
      const i = items.findIndex((_, i) => {
        const r = menuItemRect(s, i);
        return (
          r &&
          sample.x >= r.x &&
          sample.x <= r.x + r.w &&
          sample.y >= r.y &&
          sample.y <= r.y + r.h
        );
      });
      if (i >= 0) s.menuIndex = i;
      if (sample.type === "down")
        s.pointerDown = { id: sample.id, index: i < 0 ? null : i };
      if (sample.type === "up") {
        if (
          s.pointerDown?.id === sample.id &&
          ((i >= 0 && s.pointerDown.index === i) || screen === "howto")
        )
          accept = true;
        s.pointerDown = null;
      }
    }
    if (screen === "howto" && accept) s = returnTitle(s);
    else if (items.length && accept) s = confirm(s);
  }
  const heldDirections =
    screen === "playing" && s.screen === "playing"
      ? DIRS.filter((d) => api.input.value(d) > 0)
      : [];
  const newDirection = heldDirections.find((d) => pressed.has(d));
  const held: Direction | null =
    newDirection ??
    (heldDirections.includes(s.forager.desired)
      ? s.forager.desired
      : (heldDirections[0] ?? null));
  s.accumulator += dt;
  while (s.accumulator + 1e-10 >= C.TICK_DT) {
    s.accumulator -= C.TICK_DT;
    for (const cue of tick(s, held)) api.audio.play(cue);
  }
  return reconcile(s);
}
