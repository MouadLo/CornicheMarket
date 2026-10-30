import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { ContinuousScanner } from "@/src/components/sell/ContinuousScanner";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { applyStockCount } from "@/src/lib/inventory/queries";
import { parseQuantity } from "@/src/lib/money";
import { fetchProductByBarcode, type Product } from "@/src/lib/products/queries";

type CountLine = {
  product: Product;
  counted: string;
  applied?: { delta: number } | { error: string };
};

export default function StockCountScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
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

  const handleScanned = async (barcode: string): Promise<string | null> => {
    // Exact barcode only: a partial code must never pick a product to count.
    const match = await fetchProductByBarcode(barcode, true).catch(() => null);

    if (!match) return t("stockIn.countUnknown", { barcode });
    addProduct(match);
    return t("stockIn.countAdded", { name: match.name });
  };

  const apply = async () => {
    setApplying(true);
    setDone(null);

    const results = await Promise.all(
      lines.map(async (line) => {
        const counted = parseQuantity(line.counted);
        if (counted === null || !profile) return line;
        try {
          const delta = await applyStockCount(
            line.product.id,
            counted,
            line.product.stock_quantity,
            "Shelf count",
            profile.id
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

    setLines(results);
    setApplying(false);
    const changed = results.filter(
      (line) => line.applied && "delta" in line.applied && line.applied.delta !== 0
    ).length;
    setDone(t("stockIn.countDone", { count: changed }));
  };

  const countable = lines.filter((line) => parseQuantity(line.counted) !== null && !line.applied);

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
          <View key={line.product.id} style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.name}>{line.product.name}</Text>
              <Pressable
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
                value={line.counted}
                onChangeText={(value) =>
                  setLines((current) =>
                    current.map((item, i) => (i === index ? { ...item, counted: value } : item))
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
                <Text style={styles.error}>{line.applied.error}</Text>
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
          onPress={apply}
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
