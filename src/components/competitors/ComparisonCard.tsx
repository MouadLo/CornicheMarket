import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { agoText } from "@/src/components/competitors/CompetitorSection";
import { Icon } from "@/src/components/ui/Icon";
import { Money } from "@/src/components/ui/Money";
import { StatusPill } from "@/src/components/ui/StatusPill";
import type { ProductComparison } from "@/src/lib/competitors/overview";
import {
  bpToDisplay,
  cheaperPercent,
  needsReview,
  type Outcome,
} from "@/src/lib/competitors/pricing";
import { formatMAD } from "@/src/lib/money";
import { isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";
import type { Tone } from "@/src/theme/tones";

const OUTCOME: Record<
  Outcome,
  { tone: Tone; icon: "check" | "tag" | "alert" | "x" | "info" | "minus"; key: string }
> = {
  ok: { tone: "ok", icon: "check", key: "ok" },
  lower: { tone: "warn", icon: "tag", key: "lower" },
  floor: { tone: "warn", icon: "alert", key: "floor" },
  dont_follow: { tone: "bad", icon: "x", key: "dontFollow" },
  could_raise: { tone: "info", icon: "info", key: "raise" },
  no_data: { tone: "neutral", icon: "minus", key: "noData" },
  no_cost: { tone: "neutral", icon: "minus", key: "noCost" },
};

const dh = (cents: number) => isolateLtr(formatMAD(cents));
const pct = (bp: number) => isolateLtr(`${bpToDisplay(bp)} %`);

export function ComparisonCard({
  product,
  selected = false,
  disabled,
  onToggle,
  onOpen,
  onApply,
}: {
  product: ProductComparison;
  selected?: boolean;
  disabled: boolean;
  // Both optional: the product page shows the card without a checkbox or link.
  onToggle?: () => void;
  onOpen?: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const { decision } = product;
  const offer = decision.offer;
  const spec = OUTCOME[decision.outcome];
  const suggested = decision.suggestedCents;
  const reviewable = needsReview(decision);
  const floor = pct(product.minMarginBp);

  const label = t(
    `competitors.outcome.${decision.outcome === "floor" && suggested === null ? "floorStay" : spec.key}`,
    { price: suggested === null ? "" : dh(suggested) }
  );
  const why = (() => {
    switch (decision.outcome) {
      case "lower":
        return t("competitors.why.lower", { margin: pct(decision.marginIfMatchedBp ?? 0), floor });
      case "floor":
        return suggested === null
          ? t("competitors.why.floorStay", { floor })
          : t("competitors.why.floor", { margin: pct(decision.marginIfMatchedBp ?? 0), floor });
      case "could_raise":
        return t("competitors.why.raise", {
          percent: isolateLtr(
            `${cheaperPercent(product.sellingPriceCents, offer?.priceCents ?? 0)} %`
          ),
          shop: offer?.shopName ?? "",
        });
      case "ok":
        return t("competitors.why.ok");
      case "dont_follow":
        return t("competitors.why.dontFollow");
      case "no_cost":
        return t("competitors.why.noCost");
      default:
        return t("competitors.why.noData");
    }
  })();

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        {reviewable && onToggle ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={t("competitors.select", { name: product.name })}
            onPress={onToggle}
            style={[styles.check, selected && styles.checkOn]}
          >
            {selected ? <Icon name="check" size={18} color={colors.white} /> : null}
          </Pressable>
        ) : null}
        {onOpen ? (
          <Pressable accessibilityRole="link" style={styles.flex} onPress={onOpen}>
            <Text style={styles.name}>{product.name}</Text>
          </Pressable>
        ) : (
          <Text style={[styles.name, styles.flex]}>{product.name}</Text>
        )}
        {product.priceCheck ? (
          <StatusPill label={t("competitors.priceCheckBadge")} tone="info" icon="tag" />
        ) : null}
        <Text style={styles.hint}>{t("competitors.links", { count: product.offers.length })}</Text>
      </View>

      <View style={styles.grid}>
        <Cell label={t("competitors.cost")}>
          {product.costCents !== null && product.costCents > 0 ? (
            <Money cents={product.costCents} />
          ) : (
            <Text>-</Text>
          )}
        </Cell>
        <Cell label={t("competitors.ourPrice")}>
          <Money cents={product.sellingPriceCents} />
        </Cell>
        <Cell label={t("competitors.margin")}>
          <Text>{decision.currentMarginBp === null ? "-" : pct(decision.currentMarginBp)}</Text>
        </Cell>
      </View>

      {offer && offer.priceCents !== null ? (
        <View style={styles.grid}>
          <Cell label={t("competitors.cheapest")}>
            <Text style={styles.shop}>{offer.shopName}</Text>
            <View style={styles.priceRow}>
              <Money cents={offer.priceCents} />
              {decision.promo ? (
                <StatusPill label={t("competitors.promo")} tone="warn" icon="tag" />
              ) : null}
            </View>
            <Text style={styles.hint}>{agoText(offer.checkedAt, t) ?? ""}</Text>
          </Cell>
          <Cell label={t("competitors.gap")}>
            <Text>
              {decision.gapCents === null
                ? "-"
                : isolateLtr(
                    `${decision.gapCents > 0 ? "+" : decision.gapCents < 0 ? "-" : ""}${formatMAD(Math.abs(decision.gapCents))}`
                  )}
            </Text>
          </Cell>
          <Cell label={t("competitors.ifMatched")}>
            <Text>
              {decision.marginIfMatchedBp === null ? "-" : pct(decision.marginIfMatchedBp)}
            </Text>
          </Cell>
        </View>
      ) : null}

      <View style={styles.outcome}>
        <StatusPill label={label} tone={spec.tone} icon={spec.icon} />
        <Text style={styles.why}>{why}</Text>
        {reviewable ? (
          <BigButton label={t("competitors.apply")} onPress={onApply} disabled={disabled} />
        ) : null}
      </View>
    </View>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  flex: { flex: 1 },
  card: {
    gap: 12,
    padding: 12,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  check: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.ink400,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.brand700, borderColor: colors.brand700 },
  name: { fontSize: 17, fontWeight: "700", color: colors.ink900 },
  grid: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  cell: { flexGrow: 1, flexBasis: 100, gap: 2 },
  cellLabel: { fontSize: 13, color: colors.ink600 },
  shop: { fontSize: 14, fontWeight: "600", color: colors.ink900 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  outcome: { gap: 8, alignItems: "flex-start" },
  why: { fontSize: 14, color: colors.ink700, lineHeight: 20 },
});
