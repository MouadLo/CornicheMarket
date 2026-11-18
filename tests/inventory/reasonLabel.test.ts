import fr from "../../src/i18n/fr";
import { ADJUSTMENT_REASONS } from "../../src/lib/inventory/queries";
import { reasonLabel } from "../../src/lib/inventory/reasonLabel";

jest.mock("../../src/lib/supabase/client", () => ({ supabase: {} }));

const t = (key: string) => `⟦${key}⟧`;

describe("reasonLabel", () => {
  it("translates every stored reason code through its own key", () => {
    for (const reason of ADJUSTMENT_REASONS) {
      expect(reasonLabel(reason, t)).toBe(`⟦leftovers.adjustReasons.${reason}⟧`);
      expect(Object.keys(fr.leftovers.adjustReasons)).toContain(reason);
    }
  });

  it("falls back to the raw value for an unknown reason", () => {
    expect(reasonLabel("recount_2027", t)).toBe("recount_2027");
    expect(reasonLabel("", t)).toBe("");
  });

  it("keeps the stored codes unchanged", () => {
    expect(ADJUSTMENT_REASONS).toEqual(["damaged", "expired", "theft", "count_correction"]);
  });
});
