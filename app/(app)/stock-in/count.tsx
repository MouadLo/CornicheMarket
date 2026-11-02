import { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import * as Crypto from "expo-crypto";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { BigButton } from "@/src/components/BigButton";
import { ContinuousScanner } from "@/src/components/sell/ContinuousScanner";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { applyStockCount } from "@/src/lib/inventory/queries";
import { parseQuantity } from "@/src/lib/money";
import type { ScanOutcome } from "@/src/lib/sales/scanRules";
import { fetchProductByBarcode, type Product } from "@/src/lib/products/queries";

type CountLine = {
  product: Product;
  counted: string;
  operationId?: string;
  applied?: { delta: number } | { error: string };
};

export default function StockCountScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const busy = useRef(false);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const addProduct = (product: Product) => {
    setLines((current) =>
      current.some((line) => line.product.id === product.id)
        ? current
        : [...current, { product, counted: "" }]
    );
  };

  const handleScanned = async (barcode: string): Promise<ScanOutcome> => {
    // Exact barcode only: a partial code must never pick a product to count.
    const match = await fetchProductByBarcode(barcode, true).catch(() => null);

    if (!match) return { status: "unknown", message: t("stockIn.countUnknown", { barcode }) };
    addProduct(match);
    return { status: "added", message: t("stockIn.countAdded", { name: match.name }) };
  };

  const eligible = (line: CountLine) =>
    parseQuantity(line.counted) !== null && !(line.applied && "delta" in line.applied);

  const apply = async (onlyId?: string) => {
    if (busy.current || !profile) return;
    busy.current = true;
    try {
      const batch = lines.filter(
        (line) => eligible(line) && (!onlyId || line.product.id === onlyId)
      );
      if (!batch.length) return;
      const confirmed = await confirmDestructive(
        t("stockIn.countApply", { count: batch.length }),
        batch
          .map(
            (line) =>
              `${line.product.name}: ${line.product.stock_quantity} → ${parseQuantity(line.counted)} ${line.product.unit}`
          )
          .join("\n"),
        t("common.confirm"),
        t("common.cancel")
      );
      if (!confirmed) return;
      setApplying(true);
      setDone(null);
      const prepared = batch.map((line) => ({
        ...line,
        operationId: line.operationId ?? Crypto.randomUUID(),
      }));
      // Freeze the payload before the first request. Even a lost response must
      // keep the same operation ID and discrepancy on its next attempt.
      setLines((current) =>
        current.map((line) => prepared.find((p) => p.product.id === line.product.id) ?? line)
      );
      const results = await Promise.all(
        prepared.map(async (line): Promise<CountLine> => {
          try {
            const delta = await applyStockCount(
              line.product.id,
              parseQuantity(line.counted)!,
              line.product.stock_quantity,
              "Shelf count",
              profile.id,
              line.operationId
            );
            return { ...line, applied: { delta } };
          } catch (error) {
            return {
              ...line,
              applied: { error: error instanceof Error ? error.message : t("common.error") },
            };
          }
        })
      );
      setLines((current) =>
        current.map((line) => results.find((r) => r.product.id === line.product.id) ?? line)
      );
      setDone(
        t("stockIn.countDone", {
          count: results.filter(
            (line) => line.applied && "delta" in line.applied && line.applied.delta !== 0
          ).length,
        })
      );
    } finally {
      busy.current = false;
      setApplying(false);
    }
  };

  const countable = lines.filter(eligible);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.intro}>{t("stockIn.countIntro")}</Text>

      {Platform.OS !== "web" && (
        <BigButton label={t("stockIn.countScanItems")} onPress={() => setScannerOpen(true)} />
      )}

      <ProductSearchPicker onPick={addProduct} excludeIds={lines.map((line) => line.product.id)} />

      {done && <Text style={styles.done}>{done}</Text>}

      {lines.map((line, index) => {
        const counted = parseQuantity(line.counted);
        const difference = counted === null ? null : counted - line.product.stock_quantity;

        return (
          <View
            key={line.product.id}
            style={[styles.row, line.applied && "delta" in line.applied && styles.completed]}
          >
            <View style={styles.rowTop}>
              <Text style={styles.name}>{line.product.name}</Text>
              <Pressable
                disabled={applying || Boolean(line.operationId)}
                onPress={() => setLines((current) => current.filter((_, i) => i !== index))}
                hitSlop={8}
              >
                <Text style={styles.remove}>{t("stockIn.countRemove")}</Text>
              </Pressable>
            </View>

            <View style={styles.countRow}>
              <Text style={styles.systemQty}>
                {t("stockIn.countSystem")} {line.product.stock_quantity} {line.product.unit}
              </Text>
              <TextInput
                style={styles.input}
                editable={!applying && !line.operationId}
                value={line.counted}
                onChangeText={(value) =>
                  setLines((current) =>
                    current.map((item, i) =>
                      i === index && !item.operationId && !busy.current
                        ? { ...item, counted: value }
                        : item
                    )
                  )
                }
                keyboardType="decimal-pad"
                placeholder={t("stockIn.countCounted")}
              />
            </View>

            {line.applied ? (
              "delta" in line.applied ? (
                <Text style={styles.appliedOk}>
                  {line.applied.delta === 0
                    ? t("stockIn.countMatched")
                    : t("stockIn.countCorrected", {
                        delta:
                          line.applied.delta > 0
                            ? `+${line.applied.delta}`
                            : String(line.applied.delta),
                      })}
                </Text>
              ) : (
                <View>
                  <Text style={styles.error}>{line.applied.error}</Text>
                  <BigButton
                    label={t("common.retry")}
                    onPress={() => apply(line.product.id)}
                    disabled={applying}
                  />
                </View>
              )
            ) : (
              difference !== null && (
                <Text
                  style={[
                    styles.difference,
                    difference < 0 && styles.differenceNegative,
                    difference === 0 && styles.differenceZero,
                  ]}
                >
                  {difference === 0
                    ? t("stockIn.countMatched")
                    : `${difference > 0 ? "+" : ""}${Number(difference.toFixed(3))}`}
                </Text>
              )
            )}
          </View>
        );
      })}

      {countable.length > 0 && (
        <BigButton
          label={
            applying
              ? t("stockIn.countApplying")
              : t("stockIn.countApply", { count: countable.length })
          }
          onPress={() => apply()}
          disabled={applying}
        />
      )}

      <ContinuousScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={handleScanned}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 48 },
  intro: { fontSize: 13, color: "#666", lineHeight: 19 },
  completed: { backgroundColor: "#edf7ee", borderColor: "#1d7a46" },
  row: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 14, gap: 8 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  name: { fontSize: 16, fontWeight: "600", flex: 1 },
  remove: { color: "#b3261e", fontWeight: "600", fontSize: 14 },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  systemQty: { fontSize: 14, color: "#666" },
  input: {
    minHeight: 52,
    minWidth: 120,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 14,
    fontSize: 17,
    textAlign: "right",
  },
  difference: { fontSize: 15, fontWeight: "700", color: "#1d7a46" },
  differenceNegative: { color: "#b3261e" },
  differenceZero: { color: "#666", fontWeight: "500" },
  appliedOk: { fontSize: 14, fontWeight: "600", color: "#1d7a46" },
  done: { fontSize: 15, fontWeight: "700", color: "#1d7a46" },
  error: { color: "#b3261e", fontSize: 14 },
});
