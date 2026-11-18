import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { isolateBidi } from "@/src/lib/text/bidi";
import { Icon } from "@/src/components/ui/Icon";
import { colors, radius, touch } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

import { BigButton } from "@/src/components/BigButton";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { StockInLine, type LineState } from "@/src/components/stock/StockInLine";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { centsToDisplay, formatMAD, lineTotalCents } from "@/src/lib/money";
import type { Product } from "@/src/lib/products/queries";
import { useUnsavedGuard } from "@/src/lib/products/useUnsavedGuard";
import {
  ReceiveDeliveryError,
  createSupplier,
  fetchLastPurchasePrice,
  fetchSuppliers,
  receiveDelivery,
  type Supplier,
} from "@/src/lib/stock/queries";
import { DEFAULT_STORE_TIMEZONE } from "@/src/lib/reports/ranges";
import { fetchStoreTimezone } from "@/src/lib/reports/queries";
import { storeDayKey } from "@/src/lib/sales/historyView";
import { buildReceivePayload } from "@/src/lib/stock/receive";

export default function ReceiveDeliveryScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
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
  // One id per delivery, kept across failed or unanswered saves so the
  // server recognises a retry instead of receiving the stock again. Cleared
  // only once the delivery is confirmed or the draft is emptied.
  const operationId = useRef<string | null>(null);
  const savingNow = useRef(false);

  // The store's day, not the device's, for the expiry calendar's Today shortcut.
  const [timeZone, setTimeZone] = useState(DEFAULT_STORE_TIMEZONE);
  useEffect(() => {
    Promise.resolve(fetchStoreTimezone())
      .then(setTimeZone)
      .catch(() => {});
  }, []);
  const today = storeDayKey(new Date().toISOString(), timeZone);

  useEffect(() => {
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  // Typed lines are unsaved work: leaving asks first. A confirmed save empties
  // the draft, which clears the flag.
  const setDirty = useUnsavedGuard({
    title: t("stockIn.unsavedTitle"),
    message: t("stockIn.unsavedMessage"),
    leave: t("stockIn.unsavedLeave"),
    stay: t("stockIn.unsavedStay"),
  });
  setDirty(lines.length > 0);

  if (profile && !isOwner) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>{t("stockIn.blockedText")}</Text>
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
      setError(supplierError instanceof Error ? supplierError.message : t("common.error"));
    }
  };

  const { lines: validLines, priceUpdates, invalid } = buildReceivePayload(lines);

  const total = validLines.reduce(
    (sum, line) => sum + lineTotalCents(line.quantity, line.unit_cost_cents),
    0
  );
  // A delivery is saved whole or not at all: goods that arrived must never be
  // left out of stock silently (UX O3).
  const incomplete = invalid.length > 0;

  const handleSave = async () => {
    if (!profile || validLines.length === 0 || incomplete || savingNow.current) return;

    savingNow.current = true;
    operationId.current ??= Crypto.randomUUID();
    setSaving(true);
    setError(null);
    try {
      await receiveDelivery(operationId.current, {
        supplierId,
        notes: notes.trim() || null,
        lines: validLines,
        priceUpdates,
      });

      operationId.current = null;
      setDone(t("stockIn.recordDelivery", { count: validLines.length }) + ` · ${formatMAD(total)}`);
      setLines([]);
      setNotes("");
    } catch (saveError) {
      setError(
        saveError instanceof ReceiveDeliveryError && saveError.kind === "already_saved"
          ? t("stockIn.alreadySaved")
          : saveError instanceof Error
            ? saveError.message
            : t("common.error")
      );
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {done && <Text style={styles.success}>{done}</Text>}

      <Text style={styles.sectionLabel}>{t("stockIn.supplier")}</Text>
      <View style={styles.chips}>
        <Chip
          label={t("stockIn.noSupplier")}
          selected={supplierId === null}
          onPress={() => setSupplierId(null)}
        />
        {suppliers.map((supplier) => (
          <Chip
            key={supplier.id}
            label={supplier.name}
            selected={supplierId === supplier.id}
            onPress={() => setSupplierId(supplier.id)}
          />
        ))}
      </View>
      <Pressable
        style={styles.addSupplier}
        accessibilityRole="button"
        onPress={() => setAddingSupplier(true)}
      >
        <Icon name="plus" size={18} color={colors.brand700} />
        <Text style={styles.addSupplierText}>{t("stockIn.addSupplier")}</Text>
      </Pressable>

      {addingSupplier && (
        <View style={styles.supplierForm}>
          <TextInput
            style={styles.input}
            placeholder={t("stockIn.supplierName")}
            value={newSupplierName}
            onChangeText={setNewSupplierName}
          />
          <TextInput
            style={styles.input}
            placeholder={t("stockIn.supplierPhone")}
            value={newSupplierPhone}
            onChangeText={setNewSupplierPhone}
            keyboardType="phone-pad"
          />
          <View style={styles.supplierButtons}>
            <BigButton label={t("stockIn.saveSupplier")} onPress={handleAddSupplier} />
            <BigButton
              label={t("common.cancel")}
              variant="secondary"
              onPress={() => setAddingSupplier(false)}
            />
          </View>
        </View>
      )}

      <Text style={styles.sectionLabel}>{t("stockIn.productsReceived")}</Text>
      <ProductSearchPicker onPick={addProduct} excludeIds={lines.map((line) => line.product.id)} />

      {lines.map((line, index) => (
        <StockInLine
          key={line.product.id}
          line={line}
          today={today}
          onChange={(next) =>
            setLines((current) => current.map((item, i) => (i === index ? next : item)))
          }
          onRemove={() => {
            const next = lines.filter((_, i) => i !== index);
            // An emptied draft is abandoned: the next one is a new delivery.
            if (next.length === 0) operationId.current = null;
            setLines(next);
          }}
        />
      ))}

      {lines.length > 0 && (
        <>
          <TextInput
            style={styles.input}
            placeholder={t("stockIn.notesPlaceholder")}
            value={notes}
            onChangeText={setNotes}
          />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t("stockIn.deliveryTotal")}</Text>
            <Text style={styles.totalValue}>{formatMAD(total)}</Text>
          </View>

          {incomplete && (
            <View style={styles.incompleteBox} accessibilityRole="alert">
              <Text style={styles.warning}>
                {t("stockIn.incomplete", { count: invalid.length })}
              </Text>
              {invalid.map((line) => (
                <Text key={line.productId} style={styles.incompleteLine}>
                  {`• ${isolateBidi(line.name)}: ${line.problems
                    .map((problem) => t(`stockIn.problem.${problem}`))
                    .join(", ")}`}
                </Text>
              ))}
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <BigButton
            label={
              saving
                ? t("stockIn.saving")
                : t("stockIn.recordDelivery", { count: validLines.length })
            }
            onPress={handleSave}
            disabled={saving || validLines.length === 0 || incomplete}
          />
          <Text style={styles.note}>{t("stockIn.stockNote")}</Text>
        </>
      )}
    </ScrollView>
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
  addSupplier: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: touch.min,
    paddingHorizontal: 16,
    borderRadius: radius.control,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.brand700,
  },
  addSupplierText: { color: colors.brand700, fontWeight: "700", fontSize: 15 },
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
  incompleteBox: {
    gap: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.warning100,
  },
  incompleteLine: { fontSize: 14, color: colors.ink900 },
  error: { color: "#b3261e", fontSize: 14 },
  success: { color: "#1d7a46", fontSize: 15, fontWeight: "600" },
  blocked: { flex: 1, justifyContent: "center", padding: 32 },
  blockedText: { fontSize: 16, textAlign: "center", color: "#555", lineHeight: 23 },
});
