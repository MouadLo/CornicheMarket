import { useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { confirm, showToast } from "@/src/lib/dialog/store";
import { applyPercent, formatMAD } from "@/src/lib/money";
import {
  MAX_BULK_PERCENT,
  MIN_BULK_PERCENT,
  previewBulkPrice,
  validBulkPercent,
} from "@/src/lib/products/bulkPrice";
import {
  bulkAdjustSellingPrice,
  fetchBulkPriceTargets,
  type Category,
} from "@/src/lib/products/queries";
import { colors, radius } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

type Props = {
  visible: boolean;
  categories: Category[];
  onClose: () => void;
  onApplied: () => void;
};

export function BulkPriceModal({ visible, categories, onClose, onApplied }: Props) {
  const { t } = useTranslation();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [percent, setPercent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const percentValue = Number(percent.replace(",", "."));
  const valid = validBulkPercent(percentValue);
  const scope = categoryId
    ? (categories.find((category) => category.id === categoryId)?.name ?? "")
    : t("products.bulkAll");

  // Changing prices touches every till at once and has no undo, so the owner
  // first sees how many products change, real before/after prices, and how
  // many would sell below their buying price.
  const handleApply = async () => {
    if (submitting || !valid) return;
    setError(null);
    setSubmitting(true);
    try {
      const targets = await fetchBulkPriceTargets(categoryId);
      if (targets.length === 0) {
        setError(t("products.bulkNone"));
        return;
      }
      const preview = previewBulkPrice(targets, percentValue);
      if (preview.changed === 0) {
        setError(t("products.bulkNoChange"));
        return;
      }
      const lines = [
        preview.newlyBelowCost > 0
          ? t("products.bulkBelowCost", { count: preview.newlyBelowCost })
          : null,
        preview.freeAfter > 0 ? t("products.bulkFree", { count: preview.freeAfter }) : null,
        t("products.bulkTip"),
      ].filter(Boolean);
      const ok = await confirm({
        tone: "danger",
        title: t("products.bulkConfirmTitle", { count: preview.changed }),
        summary: `${percentValue > 0 ? "+" : ""}${percentValue}% · ${scope}`,
        message: lines.join("\n\n"),
        consequences: preview.samples.map((sample) => ({
          label: sample.name,
          before: formatMAD(sample.before),
          after: formatMAD(sample.after),
        })),
        confirmLabel: t("products.bulkConfirmLabel", { count: preview.changed }),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
      const count = await bulkAdjustSellingPrice(categoryId, percentValue);
      showToast({ text: t("products.bulkUpdated", { count }), tone: "success" });
      setPercent("");
      onApplied();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : t("products.bulkUpdateError"));
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    setError(null);
    setPercent("");
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t("products.bulkTitle")}</Text>

          <Text style={styles.label}>{t("products.bulkCategoryLabel")}</Text>
          <View style={styles.chips}>
            <Chip
              label={t("products.bulkAll")}
              selected={categoryId === null}
              onPress={() => setCategoryId(null)}
            />
            {categories.map((category) => (
              <Chip
                key={category.id}
                label={category.name}
                selected={categoryId === category.id}
                onPress={() => setCategoryId(category.id)}
              />
            ))}
          </View>

          <Text style={styles.label}>{t("products.bulkPercentLabel")}</Text>
          <TextInput
            style={styles.input}
            value={percent}
            onChangeText={setPercent}
            placeholder={t("products.bulkPlaceholder")}
            keyboardType="numbers-and-punctuation"
          />

          {valid ? (
            <Text style={styles.preview}>
              {t("products.bulkExample", {
                before: formatMAD(1000),
                after: formatMAD(applyPercent(1000, percentValue)),
              })}
            </Text>
          ) : percent.trim() !== "" ? (
            <Text style={styles.error}>
              {t("products.bulkPercentRange", { min: MIN_BULK_PERCENT, max: MAX_BULK_PERCENT })}
            </Text>
          ) : null}

          {error && <Text style={styles.error}>{error}</Text>}

          <BigButton
            label={submitting ? t("products.bulkChecking") : t("common.apply")}
            onPress={handleApply}
            disabled={!valid || submitting}
          />
          <BigButton label={t("common.close")} variant="secondary" onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },
  sheet: {
    backgroundColor: colors.white,
    borderRadius: radius.panel,
    padding: 20,
    gap: 12,
    maxHeight: "90%",
  },
  title: { fontSize: 20, fontWeight: "700" },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink700 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
  },
  chipSelected: { backgroundColor: colors.brand700 },
  chipText: { fontSize: 14, color: colors.ink700 },
  chipTextSelected: { color: colors.white, fontWeight: "600" },
  input: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  preview: { fontSize: 14, color: colors.ink600 },
  error: { color: colors.danger600 },
  success: { color: colors.success700 },
});
