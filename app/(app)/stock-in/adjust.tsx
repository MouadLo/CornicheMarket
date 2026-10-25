import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { BigButton } from "@/src/components/BigButton";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { formatMAD, parseQuantity } from "@/src/lib/money";
import {
  ADJUSTMENT_REASONS,
  createAdjustment,
  fetchRecentAdjustments,
  type AdjustmentReason,
  type AdjustmentRecord,
} from "@/src/lib/inventory/queries";
import { lossValueCents } from "@/src/lib/inventory/reorder";
import type { Product } from "@/src/lib/products/queries";

export default function AdjustScreen() {
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";

  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<AdjustmentReason>("damaged");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AdjustmentRecord[]>([]);

  const load = useCallback(() => {
    fetchRecentAdjustments(isOwner)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [isOwner]);

  useEffect(load, [load]);

  // Every reason here except a correction removes stock, so the number the
  // user types is treated as a quantity lost unless they are correcting.
  const isLoss = reason !== "count_correction";
  const parsed = parseQuantity(quantity);
  const delta = parsed === null ? null : isLoss ? -Math.abs(parsed) : parsed;

  const handleSave = async () => {
    if (!profile || !product || delta === null || delta === 0) return;

    setSaving(true);
    setError(null);
    try {
      await createAdjustment(product.id, delta, reason, note.trim() || null, profile.id);
      setProduct(null);
      setQuantity("");
      setNote("");
      load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the adjustment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionLabel}>Adjust stock</Text>

      {product ? (
        <View style={styles.selected}>
          <View style={styles.selectedMain}>
            <Text style={styles.name}>{product.name}</Text>
            <Text style={styles.meta}>
              {product.stock_quantity} {product.unit} on record
            </Text>
          </View>
          <Pressable onPress={() => setProduct(null)} hitSlop={8}>
            <Text style={styles.change}>Change</Text>
          </Pressable>
        </View>
      ) : (
        <ProductSearchPicker onPick={setProduct} excludeIds={[]} />
      )}

      {product && (
        <>
          <Text style={styles.label}>Reason</Text>
          <View style={styles.chips}>
            {ADJUSTMENT_REASONS.map((option) => (
              <Pressable
                key={option.value}
                style={[styles.chip, reason === option.value && styles.chipActive]}
                onPress={() => setReason(option.value)}
              >
                <Text
                  style={[styles.chipText, reason === option.value && styles.chipTextActive]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>
            {isLoss ? "Quantity lost" : "Difference (use - to reduce)"}
          </Text>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType={isLoss ? "decimal-pad" : "numbers-and-punctuation"}
            placeholder="0"
          />

          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="Note (optional)"
          />

          {delta !== null && delta !== 0 && (
            <Text style={styles.preview}>
              Stock {product.stock_quantity} → {Number((product.stock_quantity + delta).toFixed(3))}{" "}
              {product.unit}
              {isOwner && product.current_cost_cents
                ? ` · loss ${formatMAD(lossValueCents(delta, product.current_cost_cents) ?? 0)}`
                : ""}
            </Text>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <BigButton
            label={saving ? "Saving..." : "Record adjustment"}
            onPress={handleSave}
            disabled={saving || delta === null || delta === 0}
          />
        </>
      )}

      <Text style={styles.sectionLabel}>Recent adjustments</Text>
      {history.length === 0 ? (
        <Text style={styles.empty}>No adjustments recorded yet.</Text>
      ) : (
        history.map((record) => (
          <View key={record.id} style={styles.historyRow}>
            <View style={styles.rowMain}>
              <Text style={styles.historyName}>{record.product_name}</Text>
              <Text style={styles.meta}>
                {record.reason.replace("_", " ")} ·{" "}
                {new Date(record.created_at).toLocaleDateString()}
                {record.note ? ` · ${record.note}` : ""}
              </Text>
            </View>
            <View style={styles.historyRight}>
              <Text style={[styles.delta, record.quantity_delta < 0 && styles.deltaNegative]}>
                {record.quantity_delta > 0 ? "+" : ""}
                {record.quantity_delta}
              </Text>
              {isOwner && record.unit_cost_cents != null && record.quantity_delta < 0 && (
                <Text style={styles.lossValue}>
                  {formatMAD(lossValueCents(record.quantity_delta, record.unit_cost_cents) ?? 0)}
                </Text>
              )}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 48 },
  sectionLabel: { fontSize: 14, fontWeight: "700", color: "#555", textTransform: "uppercase", marginTop: 8 },
  selected: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f4f6f5",
    borderRadius: 10,
    padding: 14,
    gap: 12,
  },
  selectedMain: { flex: 1, gap: 3 },
  name: { fontSize: 16, fontWeight: "700" },
  meta: { fontSize: 13, color: "#666" },
  change: { color: "#1d7a46", fontWeight: "600" },
  label: { fontSize: 14, fontWeight: "600", color: "#444" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, backgroundColor: "#eee" },
  chipActive: { backgroundColor: "#1d7a46" },
  chipText: { fontSize: 14, color: "#333" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  input: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 16,
    fontSize: 16,
  },
  preview: { fontSize: 15, color: "#333", fontWeight: "600" },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 12,
  },
  rowMain: { flex: 1, gap: 3 },
  historyName: { fontSize: 15, fontWeight: "600" },
  historyRight: { alignItems: "flex-end" },
  delta: { fontSize: 16, fontWeight: "700", color: "#1d7a46" },
  deltaNegative: { color: "#b3261e" },
  lossValue: { fontSize: 12, color: "#666" },
  empty: { color: "#666", textAlign: "center", marginVertical: 16 },
  error: { color: "#b3261e" },
});
