/* global document, KeyboardEvent */
// Run against `npm run dev`: node scripts/capture.mjs [origin]
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { Buffer } from "node:buffer";
import process from "node:process";

const origin = process.argv[2] ?? "http://localhost:5173";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  await page.goto(origin);
  await page.waitForTimeout(700);
  await mkdir("showcase", { recursive: true });
  await page.screenshot({ path: "showcase/title.png" });
  const captured = await page.evaluate(async () => {
    const { createEngine, ConstantClock } =
      await import("/.vendor/engine/@clockwyrks/simple-2d/dist/index.js");
    const { game, BACKGROUND } = await import("/src/game.ts");
    const C = await import("/src/constants.ts");
    // A separate engine, not a page-global hook into the shipped game.
    const canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:fixed;inset:0;width:100vw;height:100vh;background:#03060c";
    document.body.append(canvas);
    const e = createEngine({
      canvas,
      width: C.STAGE_W,
      height: C.STAGE_H,
      game,
      background: BACKGROUND,
      clock: new ConstantClock(1000 / 30),
      layout: C.LAYOUT,
    });
    await e.initialize();
    const d = e.debug;
    const pose = (fn) => e.apply(fn);
    pose((s) => d.clearPredators(s));
    pose((s) => d.setForagerTile(s, 13, 11));
    pose((s) => d.setScreen(s, "playing"));
    pose((s) => d.addPredator(s, "flarefish", 26, 7));
    pose((s) => d.setPredatorTravel(s, 0, false));
    await e.advance(216);
    pose((s) => d.setForagerTile(s, 13, 11));
    pose((s) => d.setBrightness(s, 1));
    pose((s) => d.setBrightHold(s, C.BRIGHT_HOLD));
    pose((s) => d.setScore(s, 2680));
    pose((s) => d.addPredator(s, "lanternjaw", 9, 11));
    pose((s) => d.setPredatorState(s, 1, "chase"));
    pose((s) => d.addPredator(s, "gloamfin", 13, 14));
    pose((s) => d.spawnDrifter(s, 22, 11));
    const key = (code, down) =>
      document.dispatchEvent(
        new KeyboardEvent(down ? "keydown" : "keyup", { code, bubbles: true }),
      );
    e.startRecording();
    key("ArrowRight", true);
    key("Space", true);
    await e.advance(1);
    key("Space", false);
    await e.advance(29);
    const screenshot = canvas.toDataURL("image/png");
    await e.advance(15);
    key("Space", true);
    await e.advance(1);
    key("Space", false);
    await e.advance(44);
    key("ArrowRight", false);
    const recording = e.stopRecording();
    e.destroy();
    return { recording, screenshot };
  });
  await writeFile(
    "showcase/dive.json.gz",
    gzipSync(JSON.stringify(captured.recording)),
  );
  await writeFile(
    "showcase/dive.png",
    Buffer.from(captured.screenshot.split(",")[1], "base64"),
  );
} finally {
  await browser.close();
}
