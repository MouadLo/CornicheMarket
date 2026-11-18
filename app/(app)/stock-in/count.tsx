import * as Crypto from "expo-crypto";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { ContinuousScanner } from "@/src/components/sell/ContinuousScanner";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import {
  APPLY_BATCH_SIZE,
  confirmPreview,
  countProgress,
  countedQuantity,
  hasUnsavedWork,
  isApplied,
  isEligible,
  mergeProducts,
  runInBatches,
  visibleLines,
  type CountLine,
} from "@/src/lib/inventory/countList";
import {
  applyStockCount,
  fetchLowStockProducts,
  fetchProductsForCount,
} from "@/src/lib/inventory/queries";
import { familyIds, inTreeOrder } from "@/src/lib/products/categories";
import { categoryPathLabel } from "@/src/lib/products/categoryCatalog";
import {
  fetchCategories,
  fetchProductByBarcode,
  type Category,
  type Product,
} from "@/src/lib/products/queries";
import { unitLabel } from "@/src/lib/products/unitLabel";
import { useUnsavedGuard } from "@/src/lib/products/useUnsavedGuard";
import type { ScanOutcome } from "@/src/lib/sales/scanRules";
import { useKeyboardWedge } from "@/src/lib/sales/useKeyboardWedge";
import { isolateBidi } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing, touch } from "@/src/theme/tokens";

type Translate = (key: string, options?: Record<string, unknown>) => string;
type Notice = { text: string; tone: "ok" | "error" };
type FocusRequest = { id: string; n: number };

type RowProps = {
  line: CountLine;
  locked: boolean;
  highlighted: boolean;
  focusToken: number;
  onChange: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  t: Translate;
};

const CountRow = memo(function CountRow({
  line,
  locked,
  highlighted,
  focusToken,
  onChange,
  onRemove,
  onRetry,
  t,
}: RowProps) {
  const inputRef = useRef<TextInput>(null);
  const { product, applied } = line;
  const counted = countedQuantity(line);
  const difference = counted === null ? null : counted - product.stock_quantity;
  const frozen = Boolean(line.operationId);

  // A scan of this product asks for focus: bumped token, not a boolean, so
  // scanning it twice focuses it twice.
  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus();
  }, [focusToken]);

  return (
    <View
      style={[
        styles.row,
        highlighted && styles.highlighted,
        applied && "delta" in applied && styles.completed,
      ]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.name}>{isolateBidi(product.name)}</Text>
        <Pressable disabled={locked || frozen} onPress={() => onRemove(product.id)} hitSlop={8}>
          <Text style={styles.remove}>{t("stockIn.countRemove")}</Text>
        </Pressable>
      </View>

      <View style={styles.countRow}>
        <Text style={styles.systemQty}>
          {t("stockIn.countSystem")} {product.stock_quantity}{" "}
          {unitLabel(product.unit, product.stock_quantity, t)}
        </Text>
        <TextInput
          ref={inputRef}
          style={styles.input}
          editable={!locked && !frozen}
          value={line.counted}
          onChangeText={(value) => onChange(product.id, value)}
          keyboardType="decimal-pad"
          placeholder={t("stockIn.countCounted")}
          placeholderTextColor={colors.ink400}
        />
      </View>

      {applied ? (
        "delta" in applied ? (
          <Text style={styles.appliedOk}>
            {applied.delta === 0
              ? t("stockIn.countMatched")
              : t("stockIn.countCorrected", {
                  delta: applied.delta > 0 ? `+${applied.delta}` : String(applied.delta),
                })}
          </Text>
        ) : (
          <View style={styles.retryBox}>
            <Text style={styles.error}>{applied.error}</Text>
            <BigButton
              label={t("common.retry")}
              onPress={() => onRetry(product.id)}
              disabled={locked}
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
});

export default function StockCountScreen() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();
  const isOwner = profile?.role === "owner";
  const busy = useRef(false);
  const listRef = useRef<FlatList<CountLine>>(null);
  const [lines, setLines] = useState<CountLine[]>([]);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const [scannerOpen, setScannerOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(false);

  const setDirty = useUnsavedGuard({
    title: t("stockIn.countUnsavedTitle"),
    message: t("stockIn.countUnsavedMessage"),
    leave: t("stockIn.countUnsavedLeave"),
    stay: t("stockIn.countUnsavedStay"),
  });
  const unsaved = hasUnsavedWork(lines);
  useEffect(() => setDirty(unsaved));

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightId]);

  const visible = useMemo(
    () => visibleLines(lines, onlyUncounted, pinnedId),
    [lines, onlyUncounted, pinnedId]
  );
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // Bring a line into view, highlight it and put the cursor in its box.
  const spotlight = useCallback((id: string) => {
    setPinnedId(id);
    setHighlightId(id);
    setFocusRequest((current) => ({ id, n: (current?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    const index = visibleRef.current.findIndex((line) => line.product.id === focusRequest.id);
    if (index < 0) return;
    try {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
    } catch {
      // Not measured yet: onScrollToIndexFailed retries.
    }
  }, [focusRequest]);

  const addProduct = useCallback((product: Product) => {
    setLines((current) => mergeProducts(current, [product]));
  }, []);

  const pickProduct = useCallback(
    (product: Product) => {
      addProduct(product);
      setPinnedId(product.id);
    },
    [addProduct]
  );

  // Camera and USB scanners share this. Exact barcode only: a partial code
  // must never pick a product to count.
  const handleScanned = async (barcode: string, focus: boolean): Promise<ScanOutcome> => {
    const known = linesRef.current.find((line) => line.product.barcode === barcode);
    if (known) {
      if (focus) spotlight(known.product.id);
      else {
        setPinnedId(known.product.id);
        setHighlightId(known.product.id);
      }
      return { status: "added", message: t("stockIn.countFound", { name: known.product.name }) };
    }
    const match = await fetchProductByBarcode(barcode, true).catch(() => null);

    if (!match) return { status: "unknown", message: t("stockIn.countUnknown", { barcode }) };
    const already = linesRef.current.some((line) => line.product.id === match.id);
    addProduct(match);
    if (focus) spotlight(match.id);
    else {
      setPinnedId(match.id);
      setHighlightId(match.id);
    }
    return {
      status: "added",
      message: t(already ? "stockIn.countFound" : "stockIn.countAdded", { name: match.name }),
    };
  };

  const handleWedge = async (barcode: string) => {
    const outcome = await handleScanned(barcode, true);
    setNotice({ text: outcome.message ?? "", tone: outcome.status === "unknown" ? "error" : "ok" });
  };
  // A USB scanner on web must never type into a quantity box: see useKeyboardWedge.
  useKeyboardWedge(handleWedge, !scannerOpen && !applying, true);

  const openPicker = async () => {
    setPicking((open) => !open);
    if (categories) return;
    try {
      setCategories(await fetchCategories());
    } catch {
      setNotice({ text: t("stockIn.countLoadError"), tone: "error" });
    }
  };

  const loadList = async (load: () => Promise<Product[]>) => {
    if (loading || busy.current) return;
    setLoading(true);
    setNotice(null);
    try {
      const products = await load();
      const known = new Set(linesRef.current.map((line) => line.product.id));
      const fresh = products.filter((product) => !known.has(product.id)).length;
      setLines((current) => mergeProducts(current, products));
      setNotice(
        products.length === 0
          ? { text: t("stockIn.countLoadEmpty"), tone: "error" }
          : { text: t("stockIn.countLoaded", { count: fresh }), tone: "ok" }
      );
      setPicking(false);
    } catch {
      setNotice({ text: t("stockIn.countLoadError"), tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  const loadCategory = (category: Category) =>
    loadList(() => fetchProductsForCount(familyIds(categories ?? [], category.id), true));
  const loadLowStock = () => loadList(() => fetchLowStockProducts(true));

  const onChange = useCallback((id: string, value: string) => {
    setPinnedId(id);
    setLines((current) =>
      current.map((item) =>
        item.product.id === id && !item.operationId && !busy.current
          ? { ...item, counted: value }
          : item
      )
    );
  }, []);
  const onRemove = useCallback((id: string) => {
    setLines((current) =>
      current.filter((line) => line.product.id !== id || Boolean(line.operationId))
    );
  }, []);

  const apply = async (onlyId?: string) => {
    if (busy.current || !profile) return;
    busy.current = true;
    try {
      const batch = linesRef.current.filter(
        (line) => isEligible(line) && (!onlyId || line.product.id === onlyId)
      );
      if (!batch.length) return;
      const preview = confirmPreview(batch);
      const detail = preview.shown
        .map(
          (line) =>
            `${isolateBidi(line.product.name)}: ${line.product.stock_quantity} → ${countedQuantity(line)} ${unitLabel(line.product.unit, countedQuantity(line) ?? 0, t)}`
        )
        .join("\n");
      const message = preview.summaryOnly
        ? [
            t("stockIn.countConfirmSummary", {
              count: preview.total,
              differ: preview.differing,
            }),
            detail,
            preview.hidden > 0 ? t("stockIn.countConfirmMore", { count: preview.hidden }) : "",
          ]
            .filter(Boolean)
            .join("\n")
        : detail;
      const confirmed = await confirmDestructive(
        t("stockIn.countApply", { count: batch.length }),
        message,
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
      const results = await runInBatches(
        prepared,
        APPLY_BATCH_SIZE,
        async (line): Promise<CountLine> => {
          let result: CountLine;
          try {
            const delta = await applyStockCount(
              line.product.id,
              countedQuantity(line)!,
              line.product.stock_quantity,
              "Shelf count",
              profile.id,
              line.operationId!
            );
            result = { ...line, applied: { delta } };
          } catch (error) {
            result = {
              ...line,
              applied: { error: error instanceof Error ? error.message : t("common.error") },
            };
          }
          setLines((current) =>
            current.map((item) => (item.product.id === result.product.id ? result : item))
          );
          return result;
        }
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
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const onRetry = useCallback((id: string) => void applyRef.current(id), []);

  const eligibleCount = lines.filter(isEligible).length;
  const progress = countProgress(lines);
  const main = categories ? inTreeOrder(categories) : [];

  const renderItem = useCallback(
    ({ item }: { item: CountLine }) => (
      <CountRow
        line={item}
        locked={applying}
        highlighted={highlightId === item.product.id}
        focusToken={focusRequest?.id === item.product.id ? focusRequest.n : 0}
        onChange={onChange}
        onRemove={onRemove}
        onRetry={onRetry}
        t={t as Translate}
      />
    ),
    [applying, highlightId, focusRequest, onChange, onRemove, onRetry, t]
  );

  if (profile && !isOwner) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>{t("stockIn.countBlocked")}</Text>
      </View>
    );
  }

  const header = (
    <View style={styles.header}>
      <Text style={styles.intro}>{t("stockIn.countIntro")}</Text>

      {Platform.OS !== "web" && (
        <BigButton label={t("stockIn.countScanItems")} onPress={() => setScannerOpen(true)} />
      )}

      <Text style={styles.section}>{t("stockIn.countStartTitle")}</Text>
      <View style={styles.startRow}>
        <View style={styles.startButton}>
          <BigButton
            label={t("stockIn.countCategory")}
            variant="secondary"
            onPress={openPicker}
            disabled={applying || loading}
          />
        </View>
        <View style={styles.startButton}>
          <BigButton
            label={t("stockIn.countLowStock")}
            variant="secondary"
            onPress={loadLowStock}
            disabled={applying || loading}
          />
        </View>
      </View>
      {picking && (
        <View style={styles.chips}>
          {main.map((category) => (
            <Pressable
              key={category.id}
              style={styles.chip}
              disabled={applying || loading}
              onPress={() => loadCategory(category)}
            >
              <Text style={styles.chipText}>
                {isolateBidi(categoryPathLabel(category, categories ?? [], i18n.language))}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <ProductSearchPicker onPick={pickProduct} excludeIds={lines.map((line) => line.product.id)} />

      {notice && (
        <Text style={notice.tone === "error" ? styles.error : styles.done}>{notice.text}</Text>
      )}
      {done && <Text style={styles.done}>{done}</Text>}

      {lines.length > 0 && (
        <View style={styles.progressRow}>
          <Text style={styles.progress}>
            {t("stockIn.countProgress", { counted: progress.counted, total: progress.total })}
          </Text>
          <Pressable onPress={() => setOnlyUncounted((on) => !on)} hitSlop={8}>
            <Text style={styles.toggle}>
              {onlyUncounted ? t("stockIn.countShowAll") : t("stockIn.countOnlyUncounted")}
            </Text>
          </Pressable>
        </View>
      )}
      {lines.length > 0 && visible.length === 0 && (
        <Text style={styles.done}>{t("stockIn.countAllCounted")}</Text>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.container}
        data={visible}
        keyExtractor={(line) => line.product.id}
        renderItem={renderItem}
        extraData={{ applying, highlightId, focusRequest }}
        ListHeaderComponent={header}
        ItemSeparatorComponent={Separator}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        onScrollToIndexFailed={(info) =>
          listRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: true,
          })
        }
      />

      {eligibleCount > 0 && (
        <View style={styles.footer}>
          <BigButton
            label={
              applying
                ? t("stockIn.countApplying")
                : t("stockIn.countApply", { count: eligibleCount })
            }
            onPress={() => apply()}
            disabled={applying}
          />
        </View>
      )}

      <ContinuousScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={(barcode) => handleScanned(barcode, false)}
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  container: { padding: spacing.s4, paddingBottom: spacing.s7 },
  header: { gap: spacing.s3, paddingBottom: spacing.s3 },
  separator: { height: spacing.s3 },
  blocked: { flex: 1, padding: spacing.s5, justifyContent: "center" },
  blockedText: { fontSize: 16, color: colors.ink700, textAlign: "center" },
  intro: { fontSize: 13, color: colors.ink600, lineHeight: 19 },
  section: { fontSize: 15, fontWeight: "700", color: colors.ink900 },
  startRow: { flexDirection: "row", gap: spacing.s3, flexWrap: "wrap" },
  startButton: { flexGrow: 1, flexBasis: 160 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s2 },
  chip: {
    minHeight: touch.min,
    justifyContent: "center",
    paddingHorizontal: spacing.s4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipText: { fontSize: 15, color: colors.ink900 },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s3,
    flexWrap: "wrap",
  },
  progress: { fontSize: 15, fontWeight: "700", color: colors.ink900 },
  toggle: { fontSize: 14, fontWeight: "600", color: colors.brand700 },
  completed: { backgroundColor: colors.success100, borderColor: colors.success600 },
  highlighted: { backgroundColor: colors.brand100, borderColor: colors.brand600 },
  row: {
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    borderRadius: radius.control,
    padding: 14,
    gap: spacing.s2,
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: spacing.s3 },
  name: { fontSize: 16, fontWeight: "600", flex: 1, color: colors.ink900 },
  remove: { color: colors.danger600, fontWeight: "600", fontSize: 14 },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s3,
  },
  systemQty: { fontSize: 14, color: colors.ink600, flexShrink: 1 },
  input: {
    minHeight: 52,
    minWidth: 120,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.ink900,
    paddingHorizontal: 14,
    fontSize: 17,
    textAlign: "center",
  },
  difference: { fontSize: 15, fontWeight: "700", color: colors.success600 },
  differenceNegative: { color: colors.danger600 },
  differenceZero: { color: colors.ink600, fontWeight: "500" },
  appliedOk: { fontSize: 14, fontWeight: "600", color: colors.success600 },
  done: { fontSize: 15, fontWeight: "700", color: colors.success700 },
  error: { color: colors.danger600, fontSize: 14 },
  retryBox: { gap: spacing.s2 },
  footer: {
    padding: spacing.s3,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
});
