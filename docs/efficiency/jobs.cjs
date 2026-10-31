// Drives each daily job on the web build and counts taps, keystrokes, scrolls
// and the time the app itself made the person wait (debounce + network +
// render), measured from action to the next control being usable.
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8120";
const VP = { tablet: { width: 1280, height: 800 }, phone: { width: 360, height: 800 } }[process.env.VP || "tablet"];
const PROF = process.env.PROF === "tablet" ? { cpu: 4, net: { offline: false, latency: 70, downloadThroughput: 1179648, uploadThroughput: 196608 } } : null;

function job(page) {
  const s = { taps: 0, keys: 0, scrolls: 0, waitMs: 0, steps: [] };
  const timed = async (label, fn) => { if (process.env.DEBUG) console.log("  >", label); const t = Date.now(); await fn(); const d = Date.now() - t; s.waitMs += d; s.steps.push(`${label}:${d}ms`); };
  return {
    s,
    tap: async (loc, label = "tap") => { s.taps++; await timed(label, () => loc.click()); },
    type: async (loc, text, label = "type") => { s.keys += text.length; await timed(label, () => loc.fill(text)); },
    scroll: () => { s.scrolls++; },
    waitFor: (loc, label) => timed(label, () => loc.waitFor({ timeout: 20000 })),
  };
}

async function newPage(browser, role) {
  const ctx = await browser.newContext({ viewport: VP });
  await ctx.addInitScript(() => localStorage.setItem("@corniche/language", "fr"));
  const page = await ctx.newPage();
  if (PROF) { const c = await ctx.newCDPSession(page); await c.send("Network.enable"); await c.send("Network.emulateNetworkConditions", PROF.net); await c.send("Emulation.setCPUThrottlingRate", { rate: PROF.cpu }); }
  await page.goto(BASE + "/sign-in");
  await page.getByPlaceholder("Email").fill(`${role}@corniche.local`);
  await page.getByPlaceholder("Mot de passe").fill(`${role}123`);
  await page.getByText("Se connecter", { exact: true }).click();
  await page.getByPlaceholder("Scanner ou chercher un produit").waitFor();
  await page.waitForTimeout(800);
  return { ctx, page };
}

const out = {};
(async () => {
  const browser = await chromium.launch();

  // 1. 5-item sale, 1 weighed, touch-only (search path; no keyboard wedge).
  {
    const { ctx, page } = await newPage(browser, "cashier"); const j = job(page);
    const search = page.getByPlaceholder("Scanner ou chercher un produit");
    for (const [q, name] of [["coca", "Coca-Cola 33cl"], ["lait", "Lait Centrale Danone 1L"], ["pain", "Pain complet"], ["dentif", "Dentifrice Signal"]]) {
      await j.tap(search, "focus search"); await j.type(search, q, "type");
      const r = page.getByText(name).first(); await j.waitFor(r, `results ${q}`); await j.tap(r, "pick");
    }
    await j.tap(search, "focus search"); await j.type(search, "banan");
    const b = page.getByText("Bananes").first(); await j.waitFor(b, "results banan"); await j.tap(b, "pick kg");
    for (const k of ["1", ".", "2", "5"]) await j.tap(page.getByTestId(`weight-key-${k}`), `key ${k}`);
    await j.tap(page.getByText("Ajouter", { exact: true }).last(), "add weight");
    await j.tap(page.getByText(/^Encaisser/).last(), "charge");
    await j.tap(page.getByText("Encaisser la vente", { exact: true }), "complete");
    await j.waitFor(page.getByText("Scannez ou cherchez pour commencer."), "cart cleared");
    out["1. 5-item sale (1 weighed), search path"] = j.s; await ctx.close();
  }

  // 2a. Credit sale (1 item) then 2b repayment from the credit screen.
  {
    const { ctx, page } = await newPage(browser, "cashier"); const j = job(page);
    const search = page.getByPlaceholder("Scanner ou chercher un produit");
    await j.tap(search); await j.type(search, "coca");
    const r = page.getByText("Coca-Cola 1.5L").first(); await j.waitFor(r, "results"); await j.tap(r, "pick");
    await j.tap(page.getByText(/^Encaisser/).last(), "charge");
    await j.tap(page.getByText("Crédit", { exact: true }).last(), "pay later");
    await j.tap(page.getByText("Fatima Zahra").last(), "customer");
    await j.tap(page.getByText("Encaisser la vente", { exact: true }), "complete");
    await j.waitFor(page.getByText("Scannez ou cherchez pour commencer."), "cart cleared");
    out["2a. Credit sale, 1 item"] = j.s;
    const k = job(page);
    await k.tap(page.getByText("Crédit", { exact: true }).first(), "open credit");
    const rp = page.getByText("Enregistrer un paiement").first(); await k.waitFor(rp, "credit list"); await k.tap(rp, "record payment");
    const amt = page.getByPlaceholder("Montant reçu"); await k.tap(amt); await k.type(amt, "15");
    await k.tap(page.getByText("Enregistrer le paiement", { exact: true }), "save payment");
    await k.waitFor(page.getByText("Enregistrer un paiement").first(), "list refreshed");
    out["2b. Repayment (later)"] = k.s; await ctx.close();
  }

  // 3. Receive a 10-line delivery (owner).
  {
    const { ctx, page } = await newPage(browser, "owner"); const j = job(page);
    await j.tap(page.getByText("Stock", { exact: true }).first(), "nav stock");
    await j.tap(page.getByText("Distributeur Atlas", { exact: true }), "supplier");
    const items = [["coca", "Coca-Cola 33cl"], ["lait", "Lait Centrale Danone 1L"], ["dentif", "Dentifrice Signal"], ["harissa", "Harissa Aicha"], ["tide", "Lessive Tide 1kg"], ["oulmes", "Oulmes 50cl"], ["riz", "Riz Dari 1kg"], ["bougies", "Bougies pack x4"], ["piles", "Piles AA pack x4"], ["oeufs", "Oeufs (boite de 12)"]];
    const search = page.getByPlaceholder("Rechercher un produit");
    for (const [q, name] of items) {
      await j.tap(search); await j.type(search, q);
      const r = page.getByText(name).last(); await j.waitFor(r, `results ${q}`); await j.tap(r, "pick");
      const qty = page.getByPlaceholder("0").last(); await j.tap(qty, "qty field"); await j.type(qty, "24", "qty");
    }
    await j.tap(page.getByText(/^Enregistrer la livraison/), "save");
    await j.waitFor(page.getByText(/· .* DH$/).first(), "saved banner");
    out["3. Receive 10-line delivery (costs unchanged)"] = j.s; await ctx.close();
  }

  // 4. Why is today's profit low? (owner)
  {
    const { ctx, page } = await newPage(browser, "owner"); const j = job(page);
    await j.tap(page.getByText("Rapports", { exact: true }).first(), "nav reports");
    await j.waitFor(page.getByText("MARGES LES PLUS BASSES", { exact: false }).first(), "report loaded");
    // Lowest margins, by category and losses are spread over the long screen.
    for (let i = 0; i < 4; i++) j.scroll();
    await j.tap(page.getByText("Hier", { exact: true }), "compare yesterday");
    await j.waitFor(page.getByText("RÉSULTATS — HIER", { exact: false }).first(), "yesterday loaded");
    for (let i = 0; i < 2; i++) j.scroll();
    out["4. Why is today's profit low"] = j.s; await ctx.close();
  }

  // 5. End-of-day check (owner): reports today, sales list, credit list.
  {
    const { ctx, page } = await newPage(browser, "owner"); const j = job(page);
    await j.tap(page.getByText("Rapports", { exact: true }).first(), "nav reports");
    await j.waitFor(page.getByText("CHIFFRE D'AFFAIRES", { exact: false }).first(), "today totals");
    await j.tap(page.getByText("Vente", { exact: true }).first(), "nav sell");
    await j.tap(page.getByText("Ventes", { exact: true }).first(), "sales history");
    await j.waitFor(page.getByText("Annuler / rembourser").first(), "history loaded");
    for (let i = 0; i < 6; i++) j.scroll(); // scan every row for card/credit/voids, add up by hand
    await j.tap(page.getByText("Vente", { exact: true }).first(), "back");
    await j.tap(page.getByText("Crédit", { exact: true }).first(), "credit");
    await j.waitFor(page.getByText("Enregistrer un paiement").first(), "credit loaded");
    await j.tap(page.getByText("Stock", { exact: true }).first(), "nav stock");
    await j.tap(page.getByText("Ajustement", { exact: true }).first(), "losses today");
    await j.waitFor(page.getByText("AJUSTEMENTS RÉCENTS", { exact: false }).first(), "adjustments loaded");
    out["5. End-of-day check"] = j.s; await ctx.close();
  }

  // 6. New product found on the shelf, no barcode (owner).
  {
    const { ctx, page } = await newPage(browser, "owner"); const j = job(page);
    await j.tap(page.getByText("Produits", { exact: true }).first(), "nav products");
    await j.tap(page.getByText("+ Nouveau", { exact: true }), "new");
    const name = page.getByPlaceholder("Nom du produit"); await j.waitFor(name, "form");
    await j.tap(name); await j.type(name, "Chebakia 250g");
    await j.tap(page.getByText("Snacks", { exact: true }).last(), "category");
    const price = page.getByPlaceholder("0.00"); await j.tap(price); await j.type(price, "12");
    const thr = page.getByPlaceholder("0").last(); await j.tap(thr); await j.type(thr, "5");
    await j.tap(page.getByText("Créer le produit", { exact: true }), "create");
    await j.waitFor(page.getByPlaceholder("Nom ou code-barres"), "back on list");
    out["6. New product, no barcode (no stock yet)"] = j.s; await ctx.close();
  }

  await browser.close();
  for (const [k, v] of Object.entries(out)) console.log(`${k}\n  taps ${v.taps} | keys ${v.keys} | scrolls ${v.scrolls} | app wait ${(v.waitMs / 1000).toFixed(1)} s\n  ${v.steps.filter((x) => /results|loaded|saved|cleared|refreshed|form|back on/.test(x)).join(" ")}`);
})().catch((e) => { console.error("FAIL", e.message.split("\n")[0]); process.exit(1); });
