import type { Game } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { Art, FathomDebugApi, FathomState } from "./types";
import { debug } from "./debug";
import { fresh } from "./world";
import { update } from "./simulation";
import { render } from "./render";
export { BACKGROUND } from "./render";
export type {
  FathomState,
  FathomDebugApi,
  Direction,
  Screen,
  Body,
  Forager,
  Drifter,
  Predator,
  Pulse,
  InkCloud,
  Snapshot,
  Rect,
} from "./types";

export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const name of C.ACTIONS)
      api.input.register(name, { keys: [...C.BINDINGS[name]] });
    const sounds = [
      { freq: 760, freqTo: 1120, durationMs: 65, gain: 0.055 },
      { freq: 660, freqTo: 150, durationMs: 450, gain: 0.11 },
      { freq: 110, freqTo: 35, durationMs: 350, gain: 0.14 },
      { freq: 330, freqTo: 180, durationMs: 500, gain: 0.1 },
      { freq: 170, freqTo: 870, durationMs: 600, gain: 0.08 },
      { freq: 160, freqTo: 42, durationMs: 650, gain: 0.18 },
      { freq: 300, freqTo: 1200, durationMs: 800, gain: 0.12 },
    ];
    Object.values(C.CUES).forEach((cue, i) => api.audio.define(cue, sounds[i]));
    const art: Art = {};
    await Promise.all(
      Object.entries({
        glimmerfin: 8,
        lanternjaw: 16,
        gloamfin: 8,
        flarefish: 8,
        drifter: 8,
        "flare-bloom": 8,
        "trench-walls": 19,
      }).map(async ([sheet, count]) => {
        art[sheet] = await Promise.all(
          Array.from({ length: count }, (_, i) =>
            api.assets.loadImage(`${sheet}/${i}.png`),
          ),
        );
      }),
    );
    for (const key of [
      "screen",
      "depth",
      "score",
      "lives",
      "brightness",
      "visionRadius",
      "windowRadius",
      "planktonRemaining",
    ] as const)
      api.diagnostics.register(key, (s) => s[key]);
    api.diagnostics.register("sonar cooldown", (s) => s.sonar.cooldown);
    api.diagnostics.register("ink cooldown", (s) => s.ink.cooldown);
    api.diagnostics.register(
      "forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    // Six is the natural roster cap; a seventh line also reports all posed extras.
    for (let i = 0; i < C.ROSTER_CAP * C.DEN_ORDER.length; i++)
      api.diagnostics.register(`predator ${i}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
          : "—";
      });
    api.diagnostics.register(
      "extra hunters",
      (s) =>
        s.predators
          .slice(C.ROSTER_CAP * C.DEN_ORDER.length)
          .map(
            (p) => `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed} ${p.alert}`,
          )
          .join("; ") || "—",
    );
    return [fresh(art), debug];
  },
  update,
  render,
};
