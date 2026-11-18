import { chromium } from "@playwright/test";
const [,, out, task = "Release a hold"] = process.argv;
const token = process.env.E2E_BYPASS_TOKEN ?? "";
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { "x-e2e-token": token, ...(process.env.LIVE ? {} : { "x-operator-stub": token }) } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 300)));
const t0 = Date.now(); const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
await page.goto("http://localhost:3112/demos/operator", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: new RegExp(task) }).first().click();
await page.getByRole("button", { name: "Let the Operator do it" }).click();
log("started");
const approve = page.getByRole("button", { name: "Approve", exact: true });
try { await approve.waitFor({ timeout: 400000 }); log("paused"); await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/paused.png` }); await approve.click(); log("approved"); } catch (e) { log("no pause", String(e).slice(0, 100)); await page.screenshot({ path: `${out}/nopause.png`, fullPage: true }); }
await page.waitForTimeout(8000); await page.screenshot({ path: `${out}/mid.png` });
try { await page.getByText(/^(Correct|Incorrect|Unverified)$/).first().waitFor({ timeout: 600000 }); log("verdict", await page.getByText(/^(Correct|Incorrect|Unverified)$/).first().textContent()); } catch (e) { log("no verdict", String(e).slice(0, 100)); }
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/done.png`, fullPage: true });
await browser.close();
