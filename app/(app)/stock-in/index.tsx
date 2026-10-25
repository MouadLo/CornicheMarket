import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { BigButton } from "@/src/components/BigButton";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { StockInLine, type LineState } from "@/src/components/stock/StockInLine";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { centsToDisplay, formatMAD, parseMoneyToCents, parseQuantity } from "@/src/lib/money";
import { updateSellingPrice, type Product } from "@/src/lib/products/queries";
import {
  createPurchase,
  createSupplier,
  fetchLastPurchasePrice,
  fetchSuppliers,
  type DraftLine,
  type Supplier,
} from "@/src/lib/stock/queries";

export default function StockInScreen() {
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");

  const [lines, setLines] = useState<LineState[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  if (profile && !isOwner) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>
          Recording a delivery means entering buying prices, which only the owner can see.
        </Text>
      </View>
    );
  }

  const addProduct = async (product: Product) => {
    const lastCost = await fetchLastPurchasePrice(product.id).catch(() => null);
    setLines((current) => [
      ...current,
      {
        product,
        quantity: "",
        // Pre-filled with the last price paid, falling back to the running
        // average cost so the field is rarely empty.
        unitCost: centsToDisplay(lastCost ?? product.current_cost_cents ?? 0),
        lastCostCents: lastCost,
        newSellingPriceCents: null,
        expiryDate: "",
      },
    ]);
  };

  const handleAddSupplier = async () => {
    if (!newSupplierName.trim()) return;
    try {
      const supplier = await createSupplier(
        newSupplierName.trim(),
        newSupplierPhone.trim() || null
      );
      setSuppliers((current) => [...current, supplier]);
      setSupplierId(supplier.id);
      setAddingSupplier(false);
      setNewSupplierName("");
      setNewSupplierPhone("");
    } catch (supplierError) {
      setError(
        supplierError instanceof Error ? supplierError.message : "Could not create the supplier."
      );
    }
  };

  const validLines: DraftLine[] = lines.flatMap((line) => {
    const quantity = parseQuantity(line.quantity);
    const cost = parseMoneyToCents(line.unitCost);
    if (quantity === null || quantity <= 0 || cost === null) return [];
    return [
      {
        product_id: line.product.id,
        quantity,
        unit_cost_cents: cost,
        expiry_date: /^\d{4}-\d{2}-\d{2}$/.test(line.expiryDate.trim())
          ? line.expiryDate.trim()
          : null,
      },
    ];
  });

  const total = validLines.reduce(
    (sum, line) => sum + Math.round(line.unit_cost_cents * line.quantity),
    0
  );
  const incomplete = lines.length > 0 && validLines.length !== lines.length;

  const handleSave = async () => {
    if (!profile || validLines.length === 0) return;

    setSaving(true);
    setError(null);
    try {
      await createPurchase(supplierId, validLines, profile.id, notes.trim() || null);

      // Accepted price suggestions are applied after the delivery lands, so a
      // failure here cannot leave stock unrecorded.
      for (const line of lines) {
        if (line.newSellingPriceCents !== null) {
          await updateSellingPrice(line.product.id, line.newSellingPriceCents);
        }
      }

      setDone(`Recorded ${validLines.length} line${validLines.length === 1 ? "" : "s"} · ${formatMAD(total)}`);
      setLines([]);
      setNotes("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the delivery.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Stock In</Text>

      <View style={styles.toolRow}>
        <ToolLink label="Low stock" href="/(app)/stock-in/low-stock" />
        <ToolLink label="Count" href="/(app)/stock-in/count" />
        <ToolLink label="Adjust" href="/(app)/stock-in/adjust" />
        <ToolLink label="Expiring" href="/(app)/stock-in/expiring" />
        <ToolLink label="History" href="/(app)/stock-in/history" />
      </View>

      {done && <Text style={styles.success}>{done}</Text>}

      <Text style={styles.sectionLabel}>Supplier</Text>
      <View style={styles.chips}>
        <Chip label="No supplier" selected={supplierId === null} onPress={() => setSupplierId(null)} />
        {suppliers.map((supplier) => (
          <Chip
            key={supplier.id}
            label={supplier.name}
            selected={supplierId === supplier.id}
            onPress={() => setSupplierId(supplier.id)}
          />
        ))}
        <Chip label="+ New supplier" selected={false} onPress={() => setAddingSupplier(true)} />
      </View>

      {addingSupplier && (
        <View style={styles.supplierForm}>
          <TextInput
            style={styles.input}
            placeholder="Supplier name"
            value={newSupplierName}
            onChangeText={setNewSupplierName}
          />
          <TextInput
            style={styles.input}
            placeholder="Phone (optional)"
            value={newSupplierPhone}
            onChangeText={setNewSupplierPhone}
            keyboardType="phone-pad"
          />
          <View style={styles.supplierButtons}>
            <BigButton label="Save supplier" onPress={handleAddSupplier} />
            <BigButton
              label="Cancel"
              variant="secondary"
              onPress={() => setAddingSupplier(false)}
            />
          </View>
        </View>
      )}

      <Text style={styles.sectionLabel}>Products received</Text>
      <ProductSearchPicker onPick={addProduct} excludeIds={lines.map((line) => line.product.id)} />

      {lines.map((line, index) => (
        <StockInLine
          key={line.product.id}
          line={line}
          onChange={(next) =>
            setLines((current) => current.map((item, i) => (i === index ? next : item)))
          }
          onRemove={() => setLines((current) => current.filter((_, i) => i !== index))}
        />
      ))}

      {lines.length > 0 && (
        <>
          <TextInput
            style={styles.input}
            placeholder="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
          />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Delivery total</Text>
            <Text style={styles.totalValue}>{formatMAD(total)}</Text>
          </View>

          {incomplete && (
            <Text style={styles.warning}>
              Lines without a quantity and buying price will not be saved.
            </Text>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <BigButton
            label={saving ? "Saving..." : `Record delivery (${validLines.length})`}
            onPress={handleSave}
            disabled={saving || validLines.length === 0}
          />
          <Text style={styles.note}>
            Stock and average cost update automatically when this is saved.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function ToolLink({ label, href }: { label: string; href: string }) {
  return (
    <Pressable style={styles.tool} onPress={() => router.push(href as never)}>
      <Text style={styles.toolText}>{label}</Text>
    </Pressable>
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
  container: { padding: 20, gap: 14, paddingBottom: 60 },
  title: { fontSize: 24, fontWeight: "700" },
  toolRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tool: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#eef3ef",
  },
  toolText: { color: "#1d7a46", fontWeight: "700", fontSize: 14 },
  sectionLabel: { fontSize: 14, fontWeight: "700", color: "#555", textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, backgroundColor: "#eee" },
  chipSelected: { backgroundColor: "#1d7a46" },
  chipText: { fontSize: 14, color: "#333" },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  supplierForm: { gap: 10, padding: 14, backgroundColor: "#f6f6f6", borderRadius: 12 },
  supplierButtons: { gap: 8 },
  input: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: "#fff",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#e4e4e4",
  },
  totalLabel: { fontSize: 16, fontWeight: "600" },
  totalValue: { fontSize: 22, fontWeight: "800" },
  note: { fontSize: 13, color: "#666", fontStyle: "italic" },
  warning: { color: "#b36b00", fontSize: 14 },
  error: { color: "#b3261e", fontSize: 14 },
  success: { color: "#1d7a46", fontSize: 15, fontWeight: "600" },
  blocked: { flex: 1, justifyContent: "center", padding: 32 },
  blockedText: { fontSize: 16, textAlign: "center", color: "#555", lineHeight: 23 },
});
