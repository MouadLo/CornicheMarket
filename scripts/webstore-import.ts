// Webstore import CLI. Never touches a database or the network.
//   node scripts/webstore-import.ts sql --sheet feed.json --out import.sql
//   node scripts/webstore-import.ts report --sheet feed.json --products products.json --out report.csv
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  buildMatchReport,
  matchReportToCsv,
  summarizeMatchReport,
} from "../src/lib/webstore/matchReport.ts";
import {
  buildImportSql,
  priceToCents,
  validateSheetFeed,
} from "../src/lib/webstore/sheetImport.ts";

const USAGE = `usage:
  node scripts/webstore-import.ts sql --sheet <feed.json> --out <file.sql>
  node scripts/webstore-import.ts report --sheet <feed.json> --products <products.json> --out <file.csv>`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return fail(`cannot read ${path}: ${(e as Error).message}`);
  }
}

function loadFeed(path: string) {
  const { feed, errors, warnings } = validateSheetFeed(readJson(path));
  for (const w of warnings) console.warn(`warning: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);
  if (!feed) fail(`${errors.length} error(s): nothing written`);
  console.log(
    `feed: ${feed.categories.length} categories, ${feed.products.length} products, ${feed.kits.length} kits, ${warnings.length} warning(s)`
  );
  return feed;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    sheet: { type: "string" },
    products: { type: "string" },
    out: { type: "string" },
  },
});
const [command] = positionals;

if (command === "sql") {
  if (!values.sheet || !values.out) fail(USAGE);
  const feed = loadFeed(values.sheet);
  writeFileSync(values.out, buildImportSql(feed));
  console.log(`wrote ${values.out}`);
} else if (command === "report") {
  if (!values.sheet || !values.products || !values.out) fail(USAGE);
  const feed = loadFeed(values.sheet);
  // A plain array, or the output of `supabase db query` ({ rows: [...] }).
  const raw = readJson(values.products);
  const rows = Array.isArray(raw) ? raw : (raw as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) fail("products file is neither an array nor { rows: [...] }");
  const report = buildMatchReport(
    feed.products.map((p) => ({
      id: p.id,
      name: p.name,
      name_fr: p.name_fr ?? null,
      size: p.size ?? null,
      price_cents: priceToCents(p.price),
    })),
    rows
  );
  writeFileSync(values.out, matchReportToCsv(report));
  const s = summarizeMatchReport(report);
  console.log(
    `${s.total} web products: ${s.proposed} proposed, ${s.uncertain} uncertain, ${s.none} none, ${s.priceDiffers} price difference(s)`
  );
  console.log(`wrote ${values.out}`);
} else {
  fail(USAGE);
}
