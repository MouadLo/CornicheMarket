import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BarcodeScannerModal } from "@/src/components/products/BarcodeScannerModal";
import { fetchProducts, findByBarcode, type Product } from "@/src/lib/products/queries";
import { appDirection, isolateBidi } from "@/src/lib/text/bidi";
import { useDebouncedValue } from "@/src/lib/useDebouncedValue";
import { colors, radius } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

type Props = {
  onPick: (product: Product) => void;
  excludeIds: string[];
};

export function ProductSearchPicker({ onPick, excludeIds }: Props) {
  const { t, i18n } = useTranslation();
  // A product name must not flip its own row based on its script -- see
  // src/lib/text/bidi.ts.
  const dir = appDirection(i18n.language);
  const textAlign = dir === "rtl" ? "right" : "left";
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const debounced = useDebouncedValue(term, 300);

  useEffect(() => {
    if (!debounced.trim()) {
      setResults([]);
      return;
    }

    let cancelled = false;
    fetchProducts(
      { search: debounced, categoryId: null, lowStockOnly: false, status: "active" },
      0,
      true
    )
      .then((rows) => {
        if (!cancelled) setResults(rows.slice(0, 8));
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const pick = (product: Product) => {
    setTerm("");
    setResults([]);
    setNotice(null);
    onPick(product);
  };

  const handleScanned = async (barcode: string) => {
    setScannerOpen(false);
    try {
      const match = await findByBarcode(barcode, true);
      if (!match) {
        setNotice(`No product has barcode ${barcode}.`);
        return;
      }
      const [full] = await fetchProducts(
        { search: barcode, categoryId: null, lowStockOnly: false, status: "all" },
        0,
        true
      );
      if (full) pick(full);
    } catch {
      setNotice(t("stockIn.barcodeError"));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.flex]}
          placeholder={t("stockIn.searchProduct")}
          value={term}
          onChangeText={setTerm}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {Platform.OS !== "web" && (
          <Pressable style={styles.scanButton} onPress={() => setScannerOpen(true)}>
            <Text style={styles.scanButtonText}>Scan</Text>
          </Pressable>
        )}
      </View>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {results.map((product) => {
        const alreadyAdded = excludeIds.includes(product.id);
        return (
          <Pressable
            key={product.id}
            style={[styles.result, { direction: dir }, alreadyAdded && styles.resultDisabled]}
            disabled={alreadyAdded}
            onPress={() => pick(product)}
          >
            <Text style={[styles.resultName, { textAlign }]} numberOfLines={1}>
              {isolateBidi(product.name)}
            </Text>
            <Text style={[styles.resultMeta, { textAlign }]}>
              {product.barcode ?? "no barcode"} · stock {product.stock_quantity}
              {alreadyAdded ? " · already added" : ""}
            </Text>
          </Pressable>
        );
      })}

      <BarcodeScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={handleScanned}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  input: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: colors.white,
  },
  scanButton: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: radius.control,
    backgroundColor: colors.brand700,
    alignItems: "center",
    justifyContent: "center",
  },
  scanButtonText: { color: colors.white, fontWeight: "600", fontSize: 16 },
  result: {
    padding: 12,
    borderRadius: radius.control,
    backgroundColor: colors.sunken,
    gap: 2,
  },
  resultDisabled: { opacity: 0.5 },
  resultName: { fontSize: 15, fontWeight: "600" },
  resultMeta: { fontSize: 13, color: colors.ink600 },
  notice: { color: colors.warning700, fontSize: 14 },
});
