import { useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { applyPercent, formatMAD } from "@/src/lib/money";
import { bulkAdjustSellingPrice, type Category } from "@/src/lib/products/queries";
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
  const [result, setResult] = useState<string | null>(null);

  const percentValue = Number(percent.replace(",", "."));
  const valid = Number.isFinite(percentValue) && percentValue !== 0;

  const handleApply = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const count = await bulkAdjustSellingPrice(categoryId, percentValue);
      setResult(`Updated ${count} product${count === 1 ? "" : "s"}.`);
      onApplied();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : t("products.bulkUpdateError"));
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    setResult(null);
    setError(null);
    setPercent("");
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Change selling prices</Text>

          <Text style={styles.label}>Category</Text>
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

          <Text style={styles.label}>Percent change</Text>
          <TextInput
            style={styles.input}
            value={percent}
            onChangeText={setPercent}
            placeholder="e.g. 5 or -10"
            keyboardType="numbers-and-punctuation"
          />

          {valid && (
            <Text style={styles.preview}>
              A {formatMAD(1000)} product becomes {formatMAD(applyPercent(1000, percentValue))}.
            </Text>
          )}

          {error && <Text style={styles.error}>{error}</Text>}
          {result && <Text style={styles.success}>{result}</Text>}

          <BigButton
            label={submitting ? t("common.applying") : t("common.apply")}
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
