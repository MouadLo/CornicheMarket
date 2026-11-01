import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { BarcodeScannerModal } from "@/src/components/products/BarcodeScannerModal";
import {
  centsToDisplay,
  formatMAD,
  formatMargin,
  marginPercent,
  parseMoneyToCents,
  parseQuantity,
} from "@/src/lib/money";
import {
  findByBarcode,
  type Category,
  type Product,
  type ProductInput,
  type ProductUnit,
} from "@/src/lib/products/queries";
import { colors, radius } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

const UNITS: ProductUnit[] = ["piece", "kg", "pack"];

type Props = {
  categories: Category[];
  initial?: Product | null;
  submitLabel: string;
  onSubmit: (input: ProductInput) => Promise<void>;
};

export function ProductForm({ categories, initial, submitLabel, onSubmit }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [barcode, setBarcode] = useState(initial?.barcode ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(initial?.category_id ?? null);
  const [unit, setUnit] = useState<ProductUnit>(initial?.unit ?? "piece");
  const [price, setPrice] = useState(initial ? centsToDisplay(initial.selling_price_cents) : "");
  const [threshold, setThreshold] = useState(String(initial?.low_stock_threshold ?? 0));
  const [active, setActive] = useState(initial?.active ?? true);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const trimmed = barcode.trim();
    if (!trimmed || trimmed === initial?.barcode) {
      setDuplicate(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const existing = await findByBarcode(trimmed, true);
        if (!cancelled)
          setDuplicate(existing && existing.id !== initial?.id ? existing.name : null);
      } catch {
        if (!cancelled) setDuplicate(null);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [barcode, initial?.barcode, initial?.id]);

  const handleSubmit = async () => {
    setError(null);

    const priceCents = parseMoneyToCents(price);
    if (!name.trim()) return setError(t("products.formNameRequired"));
    if (priceCents === null) return setError(t("products.formPriceInvalid"));

    const thresholdValue = parseQuantity(threshold) ?? 0;

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        barcode: barcode.trim() || null,
        category_id: categoryId,
        unit,
        selling_price_cents: priceCents,
        low_stock_threshold: thresholdValue,
        active,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("products.formSaveError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Field label={t("products.formName")}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={t("products.formNamePlaceholder")}
        />
      </Field>

      <Field label={t("products.formBarcode")}>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={barcode}
            onChangeText={setBarcode}
            placeholder={t("products.formBarcodePlaceholder")}
            keyboardType="number-pad"
          />
          {Platform.OS !== "web" && (
            <Pressable style={styles.scanButton} onPress={() => setScannerOpen(true)}>
              <Text style={styles.scanButtonText}>{t("products.formScan")}</Text>
            </Pressable>
          )}
        </View>
        {duplicate && (
          <Text style={styles.warning}>
            {t("products.formDuplicateBarcode", { name: duplicate })}
          </Text>
        )}
      </Field>

      <Field label={t("products.formCategory")}>
        <View style={styles.chips}>
          <Chip
            label={t("products.formCategoryNone")}
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
      </Field>

      <Field label={t("products.formUnit")}>
        <View style={styles.chips}>
          {UNITS.map((value) => (
            <Chip
              key={value}
              label={value}
              selected={unit === value}
              onPress={() => setUnit(value)}
            />
          ))}
        </View>
      </Field>

      <Field label={t("products.formSellingPrice")}>
        <TextInput
          style={styles.input}
          value={price}
          onChangeText={setPrice}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
      </Field>

      <Field label={t("products.formLowStockThreshold")}>
        <TextInput
          style={styles.input}
          value={threshold}
          onChangeText={setThreshold}
          placeholder="0"
          keyboardType="decimal-pad"
        />
      </Field>

      <View style={styles.switchRow}>
        <Text style={styles.label}>{t("products.formActive")}</Text>
        <Switch value={active} onValueChange={setActive} />
      </View>

      {initial && <CostSummary product={initial} price={price} />}

      {error && <Text style={styles.error}>{error}</Text>}

      <BigButton
        label={submitting ? t("products.formSaving") : submitLabel}
        onPress={handleSubmit}
        disabled={submitting}
      />

      <BarcodeScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={(value) => {
          setBarcode(value);
          setScannerOpen(false);
        }}
      />
    </ScrollView>
  );
}

// Shows what the price being typed would actually earn, using the product's
// current weighted-average cost. Owners only: cashiers get no cost column.
function CostSummary({ product, price }: { product: Product; price: string }) {
  const { t } = useTranslation();
  const cost = product.current_cost_cents;
  const typedPrice = parseMoneyToCents(price);

  if (cost === null || cost <= 0) {
    return (
      <Text style={styles.note}>
        {t("products.formCostNoBuyingPrice", { qty: product.stock_quantity })}
      </Text>
    );
  }

  const profit = typedPrice === null ? null : typedPrice - cost;
  const margin = typedPrice === null ? null : marginPercent(typedPrice, cost);

  return (
    <View style={styles.summary}>
      <Text style={styles.summaryLine}>
        {t("products.formCostBuyingPrice", { qty: product.stock_quantity, price: formatMAD(cost) })}
      </Text>
      {profit !== null && (
        <Text style={[styles.summaryProfit, profit < 0 && styles.summaryLoss]}>
          {profit >= 0
            ? t("products.formCostProfit", {
                amount: formatMAD(Math.abs(profit)),
                unit: product.unit,
                margin: formatMargin(margin),
              })
            : t("products.formCostLoss", {
                amount: formatMAD(Math.abs(profit)),
                unit: product.unit,
                margin: formatMargin(margin),
              })}
        </Text>
      )}
      <Text style={styles.note}>{t("products.formStockNote")}</Text>
      <Pressable onPress={() => router.push(`/(app)/products/history/${product.id}`)}>
        <Text style={styles.historyLink}>{t("products.formPriceHistory")}</Text>
      </Pressable>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
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
  container: { padding: 20, gap: 18, paddingBottom: 48 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink700 },
  input: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: colors.white,
  },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  scanButton: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: radius.control,
    backgroundColor: colors.brand700,
    alignItems: "center",
    justifyContent: "center",
  },
  scanButtonText: { color: colors.white, fontWeight: "600", fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
  },
  chipSelected: { backgroundColor: colors.brand700 },
  chipText: { fontSize: 15, color: colors.ink700 },
  chipTextSelected: { color: colors.white, fontWeight: "600" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  note: { fontSize: 13, color: colors.ink600, fontStyle: "italic" },
  summary: { backgroundColor: colors.brand50, borderRadius: radius.control, padding: 14, gap: 6 },
  summaryLine: { fontSize: 15, color: colors.ink700 },
  summaryProfit: { fontSize: 17, fontWeight: "700", color: colors.success700 },
  summaryLoss: { color: colors.danger600 },
  historyLink: { color: colors.brand700, fontWeight: "600", fontSize: 14, marginTop: 2 },
  warning: { color: colors.warning700, fontSize: 14 },
  error: { color: colors.danger600, fontSize: 14 },
});
