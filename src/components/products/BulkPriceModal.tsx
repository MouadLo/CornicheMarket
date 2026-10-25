import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { BigButton } from "@/src/components/BigButton";
import { applyPercent, formatMAD } from "@/src/lib/money";
import { bulkAdjustSellingPrice, type Category } from "@/src/lib/products/queries";

type Props = {
  visible: boolean;
  categories: Category[];
  onClose: () => void;
  onApplied: () => void;
};

export function BulkPriceModal({ visible, categories, onClose, onApplied }: Props) {
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
      setError(applyError instanceof Error ? applyError.message : "Could not update prices.");
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
              label="All active products"
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
            label={submitting ? "Applying..." : "Apply"}
            onPress={handleApply}
            disabled={!valid || submitting}
          />
          <BigButton label="Close" variant="secondary" onPress={close} />
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
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 20, gap: 12, maxHeight: "90%" },
  title: { fontSize: 20, fontWeight: "700" },
  label: { fontSize: 14, fontWeight: "600", color: "#444" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, backgroundColor: "#eee" },
  chipSelected: { backgroundColor: "#1d7a46" },
  chipText: { fontSize: 14, color: "#333" },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  input: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 16,
    fontSize: 16,
  },
  preview: { fontSize: 14, color: "#555" },
  error: { color: "#b3261e" },
  success: { color: "#1d7a46" },
});
