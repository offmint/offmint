// Screenshot landing sections at 1440 px and 390 px. Usage: node scripts/shot.mjs <outDir> [sectionId ...] [--full]
import { chromium } from "playwright";
const [out, ...rest] = process.argv.slice(2);
const full = rest.includes("--full");
const ids = rest.filter((a) => !a.startsWith("--"));
const base = process.env.SHOT_URL || "http://localhost:3001/";
const b = await chromium.launch();
for (const width of [1440, 390]) {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(base, { waitUntil: "networkidle", timeout: 120_000 });
  await p.waitForTimeout(1500);
  // element shots: hide the sticky header so it doesn't overlap the section being captured
  if (ids.length) await p.addStyleTag({ content: "header{position:static!important}" });
  if (full) await p.screenshot({ path: `${out}/full-${width}.png`, fullPage: true });
  for (const id of ids) {
    const el = p.locator(`#${id}`);
    if ((await el.count()) === 0) { console.log(`missing #${id}`); continue; }
    await el.screenshot({ path: `${out}/${id}-${width}.png` });
    console.log(`${out}/${id}-${width}.png`);
  }
  await ctx.close();
}
await b.close();
