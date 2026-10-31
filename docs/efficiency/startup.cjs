// Startup timing: time to sign-in screen, to ready-to-scan, to offline cache ready.
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8120";
const PROFILES = {
  "no throttle": null,
  "tablet profile (4x CPU, 4G 70ms)": { cpu: 4, net: { offline: false, latency: 70, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 } },
};
async function throttle(page, prof) {
  if (!prof) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", prof.net);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: prof.cpu });
}
const cacheReady = (page) => page.waitForFunction(() => {
  const raw = localStorage.getItem("corniche.productCache.v1");
  return raw && JSON.parse(raw).products.length > 0;
}, null, { timeout: 60000 });

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const [name, prof] of Object.entries(PROFILES)) {
    for (let run = 0; run < 3; run++) {
      // Cold: nothing cached, not signed in.
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(() => localStorage.setItem("@corniche/language", "fr"));
      const page = await ctx.newPage(); await throttle(page, prof);
      let t0 = Date.now();
      await page.goto(BASE + "/sign-in");
      await page.getByPlaceholder("Email").waitFor();
      const signinReady = Date.now() - t0;
      await page.getByPlaceholder("Email").fill("cashier@corniche.local");
      await page.getByPlaceholder("Mot de passe").fill("cashier123");
      t0 = Date.now();
      await page.getByText("Se connecter", { exact: true }).click();
      await page.getByPlaceholder("Scanner ou chercher un produit").waitFor();
      const loginToSell = Date.now() - t0;
      await cacheReady(page);
      const loginToCache = Date.now() - t0;
      const state = await ctx.storageState(); await ctx.close();

      // Warm: signed in, cache present (the normal "open the app in the morning" case).
      const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: state });
      const page2 = await ctx2.newPage(); await throttle(page2, prof);
      t0 = Date.now();
      await page2.goto(BASE + "/sell");
      await page2.getByPlaceholder("Scanner ou chercher un produit").waitFor();
      const warmReady = Date.now() - t0;
      await ctx2.close();
      results.push({ profile: name, run, signinReady, loginToSell, loginToCache, warmReady });
    }
  }
  await browser.close();
  const med = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  for (const name of Object.keys(PROFILES)) {
    const r = results.filter((x) => x.profile === name);
    console.log(`${name}: cold→sign-in ${med(r.map((x) => x.signinReady))} ms | sign-in→sell ${med(r.map((x) => x.loginToSell))} ms | sign-in→offline cache ${med(r.map((x) => x.loginToCache))} ms | warm open→ready ${med(r.map((x) => x.warmReady))} ms`);
  }
})();
