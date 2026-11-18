import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
  decideCategory,
  mainCategories,
  mainCategoryId,
  MAX_CATEGORY_NAME,
  subCategoriesOf,
  withCategory,
} from "@/src/lib/products/categories";
import {
  catalogLang,
  categoryLabel,
  existingFor,
  suggestionsFor,
  type CatalogEntry,
} from "@/src/lib/products/categoryCatalog";
import {
  createCategory,
  findByBarcode,
  type Category,
  type Product,
  type ProductInput,
  type ProductUnit,
} from "@/src/lib/products/queries";
import { confirm, showToast } from "@/src/lib/dialog/store";
import { priceWarning } from "@/src/lib/products/pricing";
import { unitLabel } from "@/src/lib/products/unitLabel";
import { colors, radius } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

const UNITS: ProductUnit[] = ["piece", "kg", "pack"];

type Props = {
  categories: Category[];
  initial?: Product | null;
  submitLabel: string;
  onSubmit: (input: ProductInput) => Promise<void>;
  // Tells the screen whether there are unsaved changes (it guards leaving).
  // Called with false just before onSubmit, since a saved screen navigates away.
  onDirtyChange?: (dirty: boolean) => void;
};

export function ProductForm({
  categories: loadedCategories,
  initial,
  submitLabel,
  onSubmit,
  onDirtyChange,
}: Props) {
  const { t, i18n } = useTranslation();
  const language = i18n?.language;
  // Categories made from this form join the loaded list (which can still be
  // arriving when the form opens), and the new one is selected.
  const [created, setCreated] = useState<Category[]>([]);
  const categories = useMemo(
    () => created.reduce(withCategory, [...loadedCategories]),
    [loadedCategories, created]
  );
  const [addingCategory, setAddingCategory] = useState(false);
  // "Other…": the owner types a name that is not in the starter list.
  const [typingCategory, setTypingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [barcode, setBarcode] = useState(initial?.barcode ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(initial?.category_id ?? null);
  const selectedMain = mainCategoryId(categories, categoryId);
  const subs = selectedMain ? subCategoriesOf(categories, selectedMain) : [];
  const [unit, setUnit] = useState<ProductUnit>(initial?.unit ?? "piece");
  const [price, setPrice] = useState(initial ? centsToDisplay(initial.selling_price_cents) : "");
  const [threshold, setThreshold] = useState(String(initial?.low_stock_threshold ?? 0));
  const [active, setActive] = useState(initial?.active ?? true);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const snapshot = JSON.stringify([name, barcode, categoryId, unit, price, threshold, active]);
  const [initialSnapshot] = useState(snapshot);
  useEffect(() => {
    onDirtyChange?.(snapshot !== initialSnapshot);
  }, [snapshot, initialSnapshot, onDirtyChange]);

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

  const closeCategoryForm = () => {
    setAddingCategory(false);
    setTypingCategory(false);
    setNewCategory("");
    setCategoryError(null);
  };

  // A category from the starter list: the one already in use for it, else made
  // with its French name and stable code (shown in the language in use).
  const handlePickSuggestion = async (entry: CatalogEntry) => {
    if (creatingCategory) return;
    setCreatingCategory(true);
    setCategoryError(null);
    try {
      // Already in the shop (made elsewhere meanwhile): use it, never a twin.
      const same = existingFor(entry, categories);
      if (same) {
        setCategoryId(same.id);
      } else {
        const category = await createCategory(entry.fr, entry.code);
        setCreated((current) => [...current, category]);
        setCategoryId(category.id);
      }
      closeCategoryForm();
    } catch {
      setCategoryError(t("products.formCategoryError"));
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleAddCategory = async () => {
    if (creatingCategory) return;
    const decision = decideCategory(newCategory, categories);
    if (decision.kind === "invalid") {
      setCategoryError(t("products.formCategoryInvalid", { max: MAX_CATEGORY_NAME }));
      return;
    }
    // It exists already: use it rather than creating a twin.
    if (decision.kind === "existing") {
      setCategoryId(decision.category.id);
      closeCategoryForm();
      return;
    }
    setCreatingCategory(true);
    setCategoryError(null);
    try {
      const category = await createCategory(decision.name);
      setCreated((current) => [...current, category]);
      setCategoryId(category.id);
      closeCategoryForm();
    } catch {
      setCategoryError(t("products.formCategoryError"));
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);

    const priceCents = parseMoneyToCents(price);
    if (!name.trim()) return setError(t("products.formNameRequired"));
    if (priceCents === null) return setError(t("products.formPriceInvalid"));

    const thresholdValue = parseQuantity(threshold) ?? 0;

    // Zero or below-cost prices are allowed, but never by accident. The cost
    // is only known to the owner (null for cashiers).
    const warning = priceWarning(priceCents, initial?.current_cost_cents ?? null);
    if (warning) {
      const ok = await confirm({
        tone: "danger",
        title:
          warning.kind === "zero"
            ? t("products.formZeroPriceTitle")
            : t("products.formBelowCostTitle"),
        message:
          warning.kind === "zero"
            ? t("products.formZeroPriceMessage", { price: formatMAD(priceCents) })
            : t("products.formBelowCostMessage", {
                price: formatMAD(warning.priceCents),
                cost: formatMAD(warning.costCents),
              }),
        confirmLabel: t("products.formSaveAnyway"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      onDirtyChange?.(false);
      await onSubmit({
        name: name.trim(),
        barcode: barcode.trim() || null,
        category_id: categoryId,
        unit,
        selling_price_cents: priceCents,
        low_stock_threshold: thresholdValue,
        active,
      });
      showToast({ text: t("products.formSavedToast"), tone: "success" });
    } catch (submitError) {
      onDirtyChange?.(true);
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
          {mainCategories(categories).map((category) => (
            <Chip
              key={category.id}
              label={categoryLabel(category, language)}
              selected={selectedMain === category.id}
              onPress={() => setCategoryId(category.id)}
            />
          ))}
          <Chip
            label={t("products.formNewCategory")}
            selected={false}
            onPress={() => setAddingCategory(true)}
          />
        </View>
        {selectedMain && subs.length > 0 && (
          <View style={styles.subRow}>
            <Text style={styles.suggestTitle}>{t("products.formSubCategory")}</Text>
            <View style={styles.chips}>
              <Chip
                label={t("products.formCategoryNone")}
                selected={categoryId === selectedMain}
                onPress={() => setCategoryId(selectedMain)}
              />
              {subs.map((sub) => (
                <Chip
                  key={sub.id}
                  label={categoryLabel(sub, language)}
                  selected={categoryId === sub.id}
                  onPress={() => setCategoryId(sub.id)}
                />
              ))}
            </View>
          </View>
        )}
        {addingCategory && (
          <View style={styles.newCategory}>
            <Text style={styles.suggestTitle}>{t("products.formCategorySuggested")}</Text>
            <View style={styles.chips}>
              {suggestionsFor(categories).map((entry) => (
                <Chip
                  key={entry.code}
                  label={entry[catalogLang(language)]}
                  selected={false}
                  onPress={() => handlePickSuggestion(entry)}
                />
              ))}
              <Chip
                label={t("products.formCategoryOther")}
                selected={typingCategory}
                onPress={() => setTypingCategory(true)}
              />
            </View>
            {typingCategory && (
              <>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={newCategory}
                  onChangeText={(value) => {
                    setNewCategory(value);
                    setCategoryError(null);
                  }}
                  placeholder={t("products.formCategoryName")}
                  accessibilityLabel={t("products.formCategoryName")}
                  maxLength={MAX_CATEGORY_NAME + 10}
                  autoFocus
                  onSubmitEditing={handleAddCategory}
                  returnKeyType="done"
                />
                <BigButton
                  label={
                    creatingCategory ? t("products.formSaving") : t("products.formCategoryAdd")
                  }
                  onPress={handleAddCategory}
                  disabled={creatingCategory || newCategory.trim() === ""}
                />
              </>
            )}
            <BigButton
              label={t("common.cancel")}
              variant="secondary"
              onPress={closeCategoryForm}
              disabled={creatingCategory}
            />
            {categoryError && <Text style={styles.error}>{categoryError}</Text>}
          </View>
        )}
      </Field>

      <Field label={t("products.formUnit")}>
        <View style={styles.chips}>
          {UNITS.map((value) => (
            <Chip
              key={value}
              label={unitLabel(value, 1, t)}
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
      <Text style={styles.note}>{t("products.formActiveHint")}</Text>

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
  subRow: { marginTop: 10, gap: 6 },
  newCategory: { gap: 10, marginTop: 4 },
  suggestTitle: { fontSize: 14, fontWeight: "600", color: colors.ink700 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
  },
  chipSelected: { backgroundColor: colors.brand700 },
  chipText: { fontSize: 15, color: colors.ink700 },
  chipTextSelected: { color: colors.white, fontWeight: "600" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  note: { fontSize: 13, color: colors.ink600, fontStyle: "italic" },
  summary: { backgroundColor: colors.brand50, borderRadius: radius.control, padding: 14, gap: 6 },
  summaryLine: { fontSize: 15, color: colors.ink700 },
  summaryProfit: { fontSize: 17, fontWeight: "700", color: colors.success700 },
  summaryLoss: { color: colors.danger600 },
  historyLink: { color: colors.brand700, fontWeight: "600", fontSize: 14, marginTop: 2 },
  warning: { color: colors.warning700, fontSize: 14 },
  error: { color: colors.danger600, fontSize: 14 },
});
