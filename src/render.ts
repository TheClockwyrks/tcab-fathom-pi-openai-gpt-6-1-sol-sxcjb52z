import type { RenderApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { Body, StateView } from "./types";
import { menuItemRect, menuItems } from "./debug";
import { center, distance, flood, lineOfSight, tile } from "./world";

export const BACKGROUND = "#03060c";
const CYAN = "#8ef6e6",
  DIM = "#54767d",
  WHITE = "#ddf6f0",
  AMBER = "#ff9362";
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
type Context = RenderApi["ctx"];
function text(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  size = 16,
  color = WHITE,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}
function tracked(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  size: number,
  spacing: number,
  color = CYAN,
): void {
  for (const char of value) {
    text(ctx, char, x, y, size, color);
    x += ctx.measureText(char).width + spacing;
  }
}
function line(
  ctx: Context,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = DIM,
): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function circle(ctx: Context, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
function glow(
  ctx: Context,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function image(
  ctx: Context,
  s: StateView,
  sheet: string,
  index: number,
  x: number,
  y: number,
  w = C.TILE,
  h = w,
): void {
  const im = s.art[sheet]?.[index];
  if (im) ctx.drawImage(im, x, y, w, h);
}
function frame(b: Body, time: number, moving = true): number {
  return (
    { down: 0, up: 2, left: 4, right: 6 }[b.dir] +
    (moving ? Math.floor(time * 8) % 2 : 0)
  );
}
function amber(ctx: Context, b: { x: number; y: number }): void {
  glow(ctx, b.x, b.y, 20, "#ff713248");
  ctx.fillStyle = AMBER;
  circle(ctx, b.x, b.y, 3);
  ctx.fill();
  ctx.fillStyle = "#ffe3a2";
  circle(ctx, b.x, b.y, 1.3);
  ctx.fill();
}
function terrain(ctx: Context, s: StateView, all = false): void {
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const vis = all ? "l" : s.visibility[y][x];
      if (vis === "u") continue;
      const t = tile(s, x, y);
      let index = 16;
      if (t === "#")
        index =
          (tile(s, x, y - 1) === "#" ? 1 : 0) +
          (tile(s, x + 1, y) === "#" ? 2 : 0) +
          (tile(s, x, y + 1) === "#" ? 4 : 0) +
          (tile(s, x - 1, y) === "#" ? 8 : 0);
      else if (t === "g") index = 18;
      const px = C.GRID_ORIGIN_X + x * C.TILE,
        py = C.GRID_ORIGIN_Y + y * C.TILE;
      ctx.globalAlpha = vis === "r" ? 0.24 : 1;
      image(ctx, s, "trench-walls", index, px, py);
      if (s.plankton[y][x] === "*") {
        const c = center(x, y);
        ctx.fillStyle = CYAN;
        ctx.shadowColor = CYAN;
        ctx.shadowBlur = vis === "r" ? 0 : 8;
        circle(ctx, c.x, c.y, C.PLANKTON_DOT / 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  ctx.globalAlpha = 1;
}
function mazeView(ctx: Context, s: StateView): void {
  const f = s.forager;
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
  ctx.save();
  circle(ctx, f.x, f.y, s.windowRadius);
  ctx.clip();
  terrain(ctx, s);
  glow(ctx, f.x, f.y, s.windowRadius, "#57f7cf0e");
  for (const p of s.predators)
    if (p.kind === "lanternjaw" && p.state !== "den") amber(ctx, p);
  for (const d of s.drifters) amber(ctx, d);
  ctx.restore();
  // A flare is full vision, over the outer-circle blackout.
  for (const p of s.predators)
    if (p.flaring) {
      ctx.save();
      circle(ctx, p.x, p.y, C.FLARE_RADIUS);
      ctx.clip();
      terrain(ctx, s);
      ctx.restore();
    }
  for (const cloud of s.inkClouds) {
    const g = ctx.createRadialGradient(
      cloud.x,
      cloud.y,
      cloud.radius * 0.6,
      cloud.x,
      cloud.y,
      cloud.radius,
    );
    g.addColorStop(0, "#000107f2");
    g.addColorStop(1, "#00010700");
    ctx.fillStyle = g;
    circle(ctx, cloud.x, cloud.y, cloud.radius);
    ctx.fill();
  }
  for (const pulse of s.pulses) {
    const map = flood(s, pulse.ox, pulse.oy);
    const color =
      pulse.tint === "cyan"
        ? CYAN
        : pulse.tint === "violet"
          ? "#ba8eff"
          : "#ff9b53";
    for (const [key, d] of map) {
      const age = pulse.front - d;
      if (age < 0 || age > 1.6) continue;
      const [x, y] = key.split(",").map(Number);
      const c = center(x, y);
      ctx.globalAlpha = (1 - age / 1.6) * 0.85;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillRect(c.x - 13, c.y - 13, 26, 26);
      ctx.globalAlpha = (1 - age / 1.6) * 0.8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x - 15, c.y - 15, 30, 30);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
  for (const d of s.drifters)
    if (d.lit)
      image(
        ctx,
        s,
        "drifter",
        d.mind && d.travel ? Math.floor(s.playTime * 8) % 8 : 0,
        d.x - 16,
        d.y - 16,
      );
  for (const p of s.predators) {
    if (p.state === "den") continue;
    if (p.lit) {
      const directlyLit =
        (distance(f, p) <= s.visionRadius && lineOfSight(s, f, p)) ||
        s.predators.some(
          (flare) => flare.flaring && distance(flare, p) <= C.FLARE_RADIUS,
        );
      if (p.mark > 0 && !directlyLit && !p.alert && !p.flareCharging)
        ctx.globalAlpha = p.mark / C.SONAR_MARK_TIME;
      const i =
        p.kind === "lanternjaw" && p.state === "wander"
          ? 8 + (Math.floor(s.playTime * 8) % 8)
          : frame(p, s.playTime, p.mind && p.travel);
      image(ctx, s, p.kind, i, p.x - 16, p.y - 16);
      ctx.globalAlpha = 1;
    }
    if (p.alert) {
      const color = p.kind === "gloamfin" ? "#ba8eff" : "#ffb56c";
      const t = 1 - p.alertLeft / C.ALERT_TIME;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      circle(ctx, p.x, p.y, 18 + t * 30);
      ctx.stroke();
      for (let n = 0; n < 8; n++) {
        const a = (n * Math.PI) / 4;
        line(
          ctx,
          p.x + Math.cos(a) * (20 + t * 15),
          p.y + Math.sin(a) * (20 + t * 15),
          p.x + Math.cos(a) * (28 + t * 30),
          p.y + Math.sin(a) * (28 + t * 30),
          color,
        );
      }
      ctx.globalAlpha = 1;
    }
    if (
      p.kind === "flarefish" &&
      (p.flareCharging || p.flaring || p.fade > 0)
    ) {
      const i = p.flareCharging
        ? Math.min(2, Math.floor((p.flareTime / C.FLARE_CHARGE) * 3))
        : p.flaring
          ? 3 +
            Math.min(
              2,
              Math.floor(((p.flareTime - C.FLARE_CHARGE) / C.FLARE_BLOOM) * 3),
            )
          : p.fade > 0.17
            ? 6
            : 7;
      image(
        ctx,
        s,
        "flare-bloom",
        i,
        p.x - C.FLARE_RADIUS,
        p.y - C.FLARE_RADIUS,
        C.FLARE_RADIUS * 2,
      );
    }
  }
  glow(ctx, f.x, f.y, 44, "#62ffd950");
  image(
    ctx,
    s,
    "glimmerfin",
    frame(f, s.playTime, f.moving),
    f.x - 16,
    f.y - 16,
  );
  ctx.restore();
  // Quiet surveying marks keep the darkness intentional, without revealing it.
  const left = C.GRID_ORIGIN_X,
    top = C.GRID_ORIGIN_Y,
    right = left + C.GRID_COLS * C.TILE,
    bottom = top + C.GRID_ROWS * C.TILE;
  for (const [x, y, dx, dy] of [
    [left, top, 1, 1],
    [right, top, -1, 1],
    [left, bottom, 1, -1],
    [right, bottom, -1, -1],
  ]) {
    line(ctx, x, y, x + dx * 18, y, "#244049");
    line(ctx, x, y, x, y + dy * 18, "#244049");
  }
  text(ctx, "01", 30, top + 18, 11, DIM);
  text(ctx, "18", 30, bottom, 11, DIM);
}
function gauge(
  ctx: Context,
  label: string,
  key: string,
  x: number,
  ready: boolean,
  cooldown: number,
  max: number,
  color: string,
): void {
  text(ctx, `[${key}] ${label}`, x, 682, 13, ready ? color : DIM);
  text(
    ctx,
    ready ? "READY" : `${cooldown.toFixed(1)}s`,
    x + 194,
    682,
    12,
    ready ? color : DIM,
    "right",
  );
  ctx.fillStyle = "#14252d";
  ctx.fillRect(x, 694, 194, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x, 694, 194 * Math.max(0, 1 - cooldown / max), 3);
}
function hud(ctx: Context, s: StateView): void {
  text(ctx, "FORAGE", 64, 23, 11, DIM);
  text(ctx, String(s.score).padStart(6, "0"), 64, 67, 48, WHITE);
  tracked(ctx, C.TITLE_TEXT, 525, 35, 24, 7);
  tracked(ctx, C.DIVE_LABEL, 587, 58, 10, 4, DIM);
  text(
    ctx,
    `${String(s.planktonRemaining).padStart(3, "0")} MOTES REMAIN`,
    1216,
    32,
    13,
    CYAN,
    "right",
  );
  text(
    ctx,
    `LIGHT ${Math.round(s.brightness * 100)
      .toString()
      .padStart(3, "0")}%   /   ${s.muted ? "MUTED" : "M SOUND"}   P PAUSE`,
    1216,
    57,
    11,
    DIM,
    "right",
  );
  line(ctx, 64, 75, 1216, 75, "#17303a");
  line(ctx, 64, 661, 1216, 661, "#17303a");
  text(ctx, `DEPTH ${String(s.depth).padStart(2, "0")}`, 64, 690, 18, WHITE);
  text(ctx, "RESERVE", 235, 691, 11, DIM);
  for (let i = 0; i < s.lives; i++)
    image(ctx, s, "glimmerfin", 6, 310 + i * 29, 674, 26);
  gauge(
    ctx,
    "SONAR",
    "SPACE",
    525,
    s.sonar.ready,
    s.sonar.cooldown,
    C.SONAR_COOLDOWN,
    CYAN,
  );
  gauge(
    ctx,
    "INK",
    "SHIFT",
    780,
    s.ink.ready,
    s.ink.cooldown,
    C.INK_COOLDOWN,
    "#a6b6f9",
  );
  text(ctx, "WASD / ARROWS", 1216, 690, 12, DIM, "right");
}
function menus(ctx: Context, s: StateView): void {
  menuItems(s).forEach((label, i) => {
    const r = menuItemRect(s, i);
    if (!r) return;
    const active = s.menuIndex === i;
    ctx.fillStyle = active ? "#102c31" : "#081218";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = active ? "#5bc6b4" : "#19303a";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (active) {
      ctx.fillStyle = CYAN;
      ctx.fillRect(r.x, r.y, 3, r.h);
      text(ctx, "›", r.x + 20, r.y + 33, 24, CYAN);
    }
    text(ctx, label, r.x + 49, r.y + 31, 17, active ? WHITE : DIM);
    text(ctx, active ? "↵" : "", r.x + r.w - 22, r.y + 31, 18, CYAN, "right");
  });
}
function title(ctx: Context, s: StateView): void {
  // A specimen-like sonar vignette: a suggestion of the trench, not a revealed map.
  const cx = 934,
    cy = 352;
  glow(ctx, cx, cy, 300, "#10594c30");
  ctx.save();
  circle(ctx, cx, cy, 210);
  ctx.clip();
  ctx.translate(310, -65);
  ctx.globalAlpha = 0.45;
  terrain(ctx, s, true);
  ctx.globalAlpha = 1;
  ctx.restore();
  const fade = ctx.createRadialGradient(cx, cy, 50, cx, cy, 215);
  fade.addColorStop(0, "#03060c00");
  fade.addColorStop(1, BACKGROUND);
  ctx.fillStyle = fade;
  circle(ctx, cx, cy, 216);
  ctx.fill();
  for (const r of [78, 142, 216, 240]) {
    circle(ctx, cx, cy, r);
    ctx.strokeStyle = r === 216 ? "#32645d" : "#18322f";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  for (let n = 0; n < 60; n++) {
    const a = (n * Math.PI) / 30;
    line(
      ctx,
      cx + Math.cos(a) * 233,
      cy + Math.sin(a) * 233,
      cx + Math.cos(a) * (n % 5 === 0 ? 245 : 237),
      cy + Math.sin(a) * (n % 5 === 0 ? 245 : 237),
      "#416b64",
    );
  }
  line(ctx, cx - 258, cy, cx - 220, cy, "#59867e");
  line(ctx, cx + 220, cy, cx + 258, cy, "#59867e");
  line(ctx, cx, cy - 258, cx, cy - 220, "#59867e");
  line(ctx, cx, cy + 220, cx, cy + 258, "#59867e");
  glow(ctx, cx, cy, 80, "#79ffdf45");
  image(ctx, s, "glimmerfin", 6, cx - 16, cy - 16);
  amber(ctx, { x: cx + 115, y: cy - 87 });
  amber(ctx, { x: cx - 87, y: cy + 115 });
  text(ctx, "SIGNAL  /  UNKNOWN", cx, cy + 282, 11, DIM, "center");
  tracked(ctx, "A B Y S S A L   F I E L D N O T E S", 128, 136, 11, 1, DIM);
  text(ctx, C.TITLE_TEXT, 122, 285, 100, WHITE);
  tracked(ctx, C.TAGLINE_TEXT, 130, 326, 15, 4, CYAN);
  text(ctx, "A little light. A very deep dark.", 130, 374, 15, DIM);
  menus(ctx, s);
  text(ctx, "↑ ↓ SELECT   /   ENTER TO DESCEND", 640, 615, 12, DIM, "center");
  line(ctx, 64, 655, 1216, 655, "#17303a");
  text(ctx, `01 / ${C.DIVE_LABEL}`, 64, 687, 13, CYAN);
  text(ctx, "GRAZE. LISTEN. DISAPPEAR.", 640, 687, 11, DIM, "center");
  text(ctx, "M SOUND   ·   ` TELEMETRY", 1216, 687, 11, DIM, "right");
}
function howto(ctx: Context): void {
  tracked(ctx, "DIVE MANUAL / 01", 96, 72, 12, 3, DIM);
  text(ctx, "Know what hunts you.", 96, 136, 40, WHITE);
  const cards = [
    [
      "01",
      "LANTERNJAW",
      "LIGHT",
      "#ff9362",
      "An amber glimmer could be dinner.",
      "Or jaws. Bright feeding draws it in.",
    ],
    [
      "02",
      "GLOAMFIN",
      "SOUND",
      "#ba8eff",
      "Your sonar is a map — and a dinner bell.",
      "Break its pursuit with sharp corners.",
    ],
    [
      "03",
      "FLAREFISH",
      "FLASH",
      "#ffc579",
      "Darkness hides it until the bloom.",
      "Its flash sees straight through rock.",
    ],
  ];
  cards.forEach(([n, name, sense, color, a, b], i) => {
    const x = 96 + i * 372;
    ctx.fillStyle = "#09151d";
    ctx.fillRect(x, 186, 344, 205);
    line(ctx, x, 186, x + 344, 186, color);
    text(ctx, n, x + 20, 220, 12, DIM);
    text(ctx, name, x + 20, 260, 23, color);
    text(ctx, `HUNTS ${sense}`, x + 20, 289, 11, DIM);
    text(ctx, a, x + 20, 334, 12, WHITE);
    text(ctx, b, x + 20, 358, 12, WHITE);
  });
  text(ctx, "KEEP A LITTLE DARKNESS BETWEEN YOU.", 96, 446, 17, CYAN);
  text(
    ctx,
    "Eat every mote to descend. Eating grows your light — and gives you away.",
    96,
    480,
    15,
    WHITE,
  );
  text(
    ctx,
    "Your light finds nearby rock. Sonar remembers corridors around corners.",
    96,
    508,
    15,
    WHITE,
  );
  text(
    ctx,
    "Explored ground is dim inside your circle; beyond it, the abyss closes in.",
    96,
    536,
    15,
    DIM,
  );
  text(
    ctx,
    "WASD / ARROWS  Swim     SPACE  Sonar     SHIFT  Ink: blind light hunters",
    96,
    589,
    14,
    CYAN,
  );
  text(
    ctx,
    "ESC / P  Pause     M  Sound     ENTER / SPACE  Confirm",
    96,
    618,
    14,
    CYAN,
  );
  text(
    ctx,
    "ENTER, ESC, OR CLICK ANYWHERE TO RETURN",
    640,
    685,
    12,
    DIM,
    "center",
  );
}
export function render(s: StateView, api: RenderApi): void {
  const ctx = api.ctx;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  if (s.screen === "title") {
    title(ctx, s);
    return;
  }
  if (s.screen === "howto") {
    howto(ctx);
    return;
  }
  if (s.screen !== "gameover") {
    mazeView(ctx, s);
    hud(ctx, s);
  }
  if (s.screen === "playing") return;
  if (s.screen === "countdown") {
    text(ctx, "DIVE", 640, 325, 18, CYAN, "center");
    text(
      ctx,
      String(Math.max(1, Math.ceil(2 - s.screenTime))),
      640,
      399,
      64,
      WHITE,
      "center",
    );
    text(ctx, "LET YOUR EYES ADJUST", 640, 433, 11, DIM, "center");
    return;
  }
  if (s.screen === "cleared") {
    text(ctx, `DEPTH ${s.depth} CLEARED`, 640, 330, 36, CYAN, "center");
    text(
      ctx,
      `+${C.SCORE_CLEAR}   /   DESCENDING`,
      640,
      373,
      16,
      WHITE,
      "center",
    );
    return;
  }
  if (s.screen === "paused") {
    ctx.fillStyle = "#03060cbb";
    ctx.fillRect(0, 80, C.STAGE_W, 576);
    text(ctx, "HOLD YOUR BREATH", 640, 280, 36, WHITE, "center");
    text(ctx, "PAUSED / THE DEEP CAN WAIT", 640, 316, 12, DIM, "center");
  }
  if (s.screen === "gameover") {
    glow(ctx, 640, 290, 260, "#603a2728");
    tracked(ctx, "SIGNAL LOST", 502, 172, 18, 6, AMBER);
    text(ctx, "The abyss remembers.", 640, 245, 40, WHITE, "center");
    text(
      ctx,
      `${String(s.score).padStart(6, "0")} POINTS    /    DEPTH ${s.depth}`,
      640,
      302,
      18,
      CYAN,
      "center",
    );
  }
  menus(ctx, s);
  text(ctx, "↑ ↓ SELECT   /   ENTER CONFIRM", 640, 615, 12, DIM, "center");
}
