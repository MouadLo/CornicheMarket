import { cardTokenFromScan, cardUrl, whatsappCardLink } from "../../src/lib/loyalty/card";
import { displayPhone, formatMaPhone, normalizeMaPhone } from "../../src/lib/loyalty/phone";
import {
  DEFAULT_RATES,
  expectedEarn,
  lineBonusPoints,
  maxRedeemablePoints,
  pointsEarned,
  pointsValueCents,
} from "../../src/lib/loyalty/points";

describe("normalizeMaPhone", () => {
  it.each([
    ["0612345678", "+212612345678"],
    ["06 12 34 56 78", "+212612345678"],
    ["06.12.34.56.78", "+212612345678"],
    ["0712-345-678", "+212712345678"],
    ["0522123456", "+212522123456"],
    ["+212612345678", "+212612345678"],
    ["+212 6 12 34 56 78", "+212612345678"],
    ["00212612345678", "+212612345678"],
    ["212612345678", "+212612345678"],
    ["612345678", "+212612345678"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeMaPhone(input)).toBe(expected);
  });

  it.each(["", "0812345678", "061234567", "06123456789", "+33612345678", "06a2345678", "12345"])(
    "rejects %p",
    (input) => {
      expect(normalizeMaPhone(input)).toBeNull();
    }
  );

  it("displays any stored phone the usual way, leaving foreign numbers alone", () => {
    expect(displayPhone("+212661223344")).toBe("06 61 22 33 44");
    expect(displayPhone("0622222222")).toBe("06 22 22 22 22");
    expect(displayPhone("+33 6 12 34 56 78")).toBe("+33 6 12 34 56 78");
  });

  it("formats for reading", () => {
    expect(formatMaPhone("+212612345678")).toBe("06 12 34 56 78");
    expect(formatMaPhone("nope")).toBe("nope");
  });
});

describe("points", () => {
  it("1 point per full 10.00 DH", () => {
    expect(pointsEarned(999, DEFAULT_RATES)).toBe(0);
    expect(pointsEarned(1000, DEFAULT_RATES)).toBe(1);
    expect(pointsEarned(12_345, DEFAULT_RATES)).toBe(12);
    expect(pointsEarned(-500, DEFAULT_RATES)).toBe(0);
  });

  it("100 points = 10.00 DH", () => {
    expect(pointsValueCents(100, DEFAULT_RATES)).toBe(1000);
    expect(pointsValueCents(0, DEFAULT_RATES)).toBe(0);
    expect(pointsValueCents(-3, DEFAULT_RATES)).toBe(0);
  });

  it("caps a redemption by balance, by eligible value and by the minimum", () => {
    expect(maxRedeemablePoints(340, 50_000, DEFAULT_RATES)).toBe(340);
    // a 20.00 DH eligible basket takes at most 200 points
    expect(maxRedeemablePoints(340, 2000, DEFAULT_RATES)).toBe(200);
    // under the 100-point minimum: nothing
    expect(maxRedeemablePoints(90, 50_000, DEFAULT_RATES)).toBe(0);
    expect(maxRedeemablePoints(340, 900, DEFAULT_RATES)).toBe(0);
  });

  it("expected earn spreads the sale discount over the lines and skips excluded ones", () => {
    const lines = [
      { totalCents: 6000, eligible: true },
      { totalCents: 4000, eligible: false }, // cigarettes
    ];
    expect(expectedEarn(lines, 0, DEFAULT_RATES).total).toBe(6);
    // 10.00 DH of points spent: 6.00 DH of it falls on the eligible line
    expect(expectedEarn(lines, 1000, DEFAULT_RATES).total).toBe(5);
    expect(expectedEarn([{ totalCents: 4000, eligible: false }], 0, DEFAULT_RATES).total).toBe(0);
    expect(expectedEarn([], 0, DEFAULT_RATES)).toEqual({ base: 0, bonus: 0, total: 0 });
  });

  it("adds bonus points per whole unit, never on excluded products", () => {
    const lines = [
      { totalCents: 1500, eligible: true, quantity: 3, bonusPerUnit: 20 }, // yogurt promo
      { totalCents: 4000, eligible: false, quantity: 1, bonusPerUnit: 50 }, // excluded: no bonus
      { totalCents: 900, eligible: true, quantity: 0.75, bonusPerUnit: 10 }, // 0.75 kg: none
      { totalCents: 2160, eligible: true, quantity: 2.4, bonusPerUnit: 10 }, // 2.4 kg: 2 bonuses
    ];
    expect(expectedEarn(lines, 0, DEFAULT_RATES)).toEqual({ base: 4, bonus: 80, total: 84 });
    expect(lineBonusPoints({ quantity: 3, eligible: true, bonusPerUnit: 0 })).toBe(0);
  });
});

describe("card links", () => {
  const token = "AbCdEfGhIjKlMnOpQrStUv";

  it("builds the card URL and recognises it when scanned", () => {
    const url = cardUrl("https://corniche-market.vercel.app/", token);
    expect(url).toBe(`https://corniche-market.vercel.app/card/${token}`);
    expect(cardTokenFromScan(url)).toBe(token);
    expect(cardTokenFromScan(`${url}/`)).toBe(token);
    expect(cardTokenFromScan(`${url}?lang=ar`)).toBe(token);
    expect(cardTokenFromScan(`/card/${token}`)).toBe(token);
  });

  it("ignores product barcodes and other codes", () => {
    expect(cardTokenFromScan("6111245100135")).toBeNull();
    expect(cardTokenFromScan("https://example.com/card/short")).toBeNull();
    expect(cardTokenFromScan(`https://x.test/cards/${token}`)).toBeNull();
  });

  it("makes a WhatsApp link with the message", () => {
    expect(whatsappCardLink("+212612345678", "Votre carte: https://x/card/a b")).toBe(
      "https://wa.me/212612345678?text=Votre%20carte%3A%20https%3A%2F%2Fx%2Fcard%2Fa%20b"
    );
  });
});
