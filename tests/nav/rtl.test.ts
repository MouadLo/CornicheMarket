import fs from "fs";
import path from "path";

import { describeReviewLine } from "../../src/components/shell/ReviewPanel";
import ar from "../../src/i18n/ar";
import en from "../../src/i18n/en";
import fr from "../../src/i18n/fr";

jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "ar" } }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});

const root = path.join(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

// The shell must mirror in Arabic with no special cases, which only holds if it
// never says "left" or "right". Start and end flip with the language; physical
// sides do not.
const SHELL_FILES = [
  ...fs
    .readdirSync(path.join(root, "src/components/shell"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `src/components/shell/${f}`),
  "app/(app)/_layout.tsx",
  "app/(app)/clients/_layout.tsx",
];

describe("the shell mirrors with start/end only", () => {
  it("covers the files that make up the shell", () => {
    expect(SHELL_FILES).toEqual(
      expect.arrayContaining([
        "src/components/shell/AppShell.tsx",
        "src/components/shell/TopBar.tsx",
        "src/components/shell/Rail.tsx",
        "src/components/shell/BottomTabs.tsx",
      ])
    );
  });

  it.each(SHELL_FILES)("%s uses no physical left/right styles", (file) => {
    const source = read(file);
    const physical = source.match(
      /\b(left|right|marginLeft|marginRight|paddingLeft|paddingRight|borderLeft\w*|borderRight\w*|borderTopLeftRadius|borderTopRightRadius)\s*:|textAlign\s*:\s*["'](left|right)["']|flexDirection\s*:\s*["']row-reverse["']/g
    );
    expect(physical).toBeNull();
  });
});

describe("Arabic wording for credit", () => {
  it("the Clients section is كريدي in Arabic", () => {
    expect(ar.nav.clients).toBe("كريدي");
    expect(ar.sell.credit).toBe("كريدي");
  });

  it("the older standard-Arabic word is gone", () => {
    expect(read("src/i18n/ar.ts")).not.toContain("آجل");
  });

  it("French and English keep Clients", () => {
    expect(fr.nav.clients).toBe("Clients");
    expect(en.nav.clients).toBe("Clients");
  });
});

describe("review sentences read correctly in Arabic", () => {
  // A stub t that exposes the interpolated values.
  const t = (key: string, options?: Record<string, unknown>) => `${key}|${JSON.stringify(options)}`;

  it("amounts are left-to-right islands and product names are isolated", () => {
    const out = describeReviewLine(
      { type: "price", name: "خبز", deviceCents: 100, expectedCents: 120, stale: false },
      t
    );
    const options = JSON.parse(out.split("|")[1]);
    expect(options.device).toBe("⁦1.00 DH⁩");
    expect(options.expected).toBe("⁦1.20 DH⁩");
    expect(options.name).toBe("⁨خبز⁩");
  });

  it("a stale price uses the stale sentence", () => {
    expect(
      describeReviewLine(
        { type: "price", name: "x", deviceCents: 1, expectedCents: 2, stale: true },
        t
      )
    ).toContain("shell.priceLineStale");
  });

  it("discount lines isolate the percent too, and use grouped thousands", () => {
    const out = describeReviewLine(
      { type: "discount", name: "Thé", amountCents: 348250, discountCents: 50000, percent: 14.36 },
      t
    );
    const options = JSON.parse(out.split("|")[1]);
    expect(options.amount).toBe("⁦3 482.50 DH⁩");
    expect(options.percent).toBe("⁦14.36⁩");
  });
});
