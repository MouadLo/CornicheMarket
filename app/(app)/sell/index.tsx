import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { CartLineRow } from "@/src/components/sell/CartLineRow";
import { ContinuousScanner } from "@/src/components/sell/ContinuousScanner";
import { EmptyStorePrompt } from "@/src/components/sell/EmptyStorePrompt";
import { PaymentSheet } from "@/src/components/sell/PaymentSheet";
import { PendingAttemptCard } from "@/src/components/sell/PendingAttemptCard";
import { WeightPad } from "@/src/components/sell/WeightPad";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirm } from "@/src/lib/dialog/store";
import { centsToDisplay, formatMAD, parseMoneyToCents } from "@/src/lib/money";
import {
  findCachedByBarcode,
  getCachedGrid,
  refreshProductCache,
  searchCachedProducts,
  type CachedProduct,
} from "@/src/lib/products/offlineCache";
import {
  fetchProductByBarcode,
  fetchProducts,
  hasAnyProducts,
  type Product,
} from "@/src/lib/products/queries";
import { enqueueSale, type PendingSale } from "@/src/lib/sales/offlineQueue";
import type { ScanOutcome } from "@/src/lib/sales/scanRules";
import {
  createCustomer,
  fetchCustomers,
  type Customer,
  type PaymentMethod,
} from "@/src/lib/sales/queries";
import {
  cartSubtotal,
  hasInvalidQuantity,
  saleTotal,
  validateSaleDiscounts,
  type CartLine,
} from "@/src/lib/sales/totals";
import { useKeyboardWedge } from "@/src/lib/sales/useKeyboardWedge";
import { paymentMethodKey } from "@/src/lib/sales/paymentMethod";
import { pendingSaleFrom, useSaleSync } from "@/src/lib/sales/useSaleSync";
import { ProductGrid } from "@/src/components/sell/ProductGrid";
import { resolveGrid, sellLayoutFor, type ResolvedTab } from "@/src/lib/sellGrid/layout";
import { isolateBidi } from "@/src/lib/text/bidi";
import { useDebouncedValue } from "@/src/lib/useDebouncedValue";

export default function SellScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isOwner = profile?.role === "owner";
  const sync = useSaleSync();
  const accepting = useRef(false);
  // Retain the operation in memory across an ambiguous storage failure.
  const attemptedSale = useRef<PendingSale | null>(null);
  // The same attempt, for display: shown whenever its outcome is not known.
  const [unconfirmed, setUnconfirmed] = useState<PendingSale | null>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [saleDiscount, setSaleDiscount] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  // A weighed (kg) product waiting for its weight on the keypad.
  const [weighing, setWeighing] = useState<Product | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // null = not checked yet (or the check failed) -- only an explicit `false`
  // shows the empty-store prompt, so a load error never hides the normal
  // screen behind a wrong "add your first product" message.
  const [storeIsEmpty, setStoreIsEmpty] = useState<boolean | null>(null);

  // The Sell grid: tabs of tiles resolved from the cached layout and products.
  const { width } = useWindowDimensions();
  const split = sellLayoutFor(width) === "split";
  // Load the cached layout once (and again after each refresh); resolve it with
  // useMemo so a changing translation function can never retrigger the load.
  const [cachedGrid, setCachedGrid] = useState<Awaited<ReturnType<typeof getCachedGrid>>>(null);
  const loadGrid = useCallback(async () => {
    setCachedGrid(await getCachedGrid());
  }, []);
  useEffect(() => {
    void loadGrid();
  }, [loadGrid]);
  const gridTabs: ResolvedTab[] = useMemo(
    () =>
      cachedGrid
        ? resolveGrid({
            tabs: cachedGrid.tabs,
            tiles: cachedGrid.tiles,
            categories: cachedGrid.categories,
            favoritesLabel: t("sell.grid.favorites"),
            products: cachedGrid.products.map((p) => ({
              id: p.id,
              name: p.name,
              barcode: p.barcode,
              category_id: p.category_id ?? null,
              unit: p.unit,
              selling_price_cents: p.selling_price_cents,
              stock_quantity: p.stock_quantity ?? 0,
              low_stock_threshold: p.low_stock_threshold ?? 0,
              active: p.active,
            })),
          })
        : [],
    [cachedGrid, t]
  );

  const debounced = useDebouncedValue(search, 250);
  const discountCents = parseMoneyToCents(saleDiscount) ?? 0;
  const total = useMemo(() => saleTotal(lines, discountCents), [lines, discountCents]);
  const discountError = validateSaleDiscounts(lines, discountCents);
  const saleDiscountTooHigh = discountError === "sale";
  const discountInvalid = discountError !== null;
  const quantityInvalid = hasInvalidQuantity(lines);

  useEffect(() => {
    fetchCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, []);

  // Only the owner can act on the empty-store prompt (add/import products),
  // and only once online -- never label a merely-offline cache as "empty".
  useEffect(() => {
    if (!isOwner || !sync.online) return;
    hasAnyProducts()
      .then((has) => setStoreIsEmpty(!has))
      .catch(() => {});
  }, [isOwner, sync.online]);

  // Refresh the local product cache whenever the device comes online.
  useEffect(() => {
    if (sync.online) {
      refreshProductCache(isOwner)
        .then(loadGrid)
        .catch(() => {});
    }
  }, [sync.online, isOwner, loadGrid]);

  useEffect(() => {
    if (!debounced.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;

    if (!sync.online) {
      searchCachedProducts(debounced).then((rows) => {
        if (!cancelled) setResults(rows as unknown as Product[]);
      });
      return () => {
        cancelled = true;
      };
    }

    fetchProducts(
      { search: debounced, categoryId: null, lowStockOnly: false, status: "active" },
      0,
      isOwner
    )
      .then((rows) => !cancelled && setResults(rows.slice(0, 8)))
      .catch(() => !cancelled && setResults([]));
    return () => {
      cancelled = true;
    };
  }, [debounced, isOwner, sync.online]);

  const addLine = useCallback((product: Product, quantity: number) => {
    setLines((current) => {
      const existing = current.findIndex((line) => line.product_id === product.id);
      if (existing >= 0) {
        const next = [...current];
        next[existing] = {
          ...next[existing],
          quantity: Number((next[existing].quantity + quantity).toFixed(3)),
        };
        return next;
      }
      return [
        ...current,
        {
          product_id: product.id,
          name: product.name,
          unit: product.unit,
          quantity,
          unit_price_cents: product.selling_price_cents,
          discount_cents: 0,
          // Products picked from the offline cache carry no cost field at all.
          unit_cost_cents: product.current_cost_cents ?? null,
        },
      ];
    });
  }, []);

  // Returns false when nothing was added yet because the product is sold by
  // weight: the keypad opens and the line is added once a weight is entered,
  // instead of defaulting to 1 kg.
  const addProduct = useCallback(
    (product: Product): boolean => {
      setSearch("");
      setResults([]);
      if (product.unit === "kg") {
        setWeighing(product);
        return false;
      }
      addLine(product, 1);
      return true;
    },
    [addLine]
  );

  const addByBarcode = useCallback(
    async (barcode: string): Promise<ScanOutcome> => {
      try {
        let match: Product | CachedProduct | undefined;

        if (!sync.online) {
          match = (await findCachedByBarcode(barcode)) ?? undefined;
        } else {
          match = (await fetchProductByBarcode(barcode, isOwner)) ?? undefined;
        }

        if (!match) {
          setFlash(t("sell.notFound", { barcode }));
          return { status: "unknown", message: t("sell.notFound", { barcode }) };
        }
        if (addProduct(match as Product)) {
          setFlash(t("sell.added", { name: isolateBidi(match.name) }));
        } else {
          // The weight keypad is a modal of its own; close the camera first
          // rather than stack two modals.
          setScannerOpen(false);
        }
        return {
          status: "added",
          message: `${isolateBidi(match.name)} · ${centsToDisplay(match.selling_price_cents)} DH`,
        };
      } catch {
        setFlash(t("sell.lookupFailed"));
        return { status: "error", message: null };
      }
    },
    [addProduct, isOwner, sync.online, t]
  );

  // USB/Bluetooth scanners on web type the code and press Enter.
  useKeyboardWedge((barcode) => {
    setSearch("");
    addByBarcode(barcode);
  }, !paymentOpen && !weighing);

  const handleConfirm = async (method: PaymentMethod, customerId: string | null) => {
    if (accepting.current || !profile || lines.length === 0) return;

    if (hasInvalidQuantity(lines)) {
      setError(t("sell.weightRequired"));
      return;
    }

    // A discount too large for what it discounts must never reach
    // enqueueSale: anything already queued goes through the offline sync
    // retry/quarantine pipeline, which is the wrong place to discover a
    // data-entry error. Caught here, it never gets that far.
    const discountCheck = validateSaleDiscounts(lines, discountCents);
    if (discountCheck === "line") {
      setError(t("sell.lineDiscountTooHigh"));
      return;
    }
    if (discountCheck === "sale") {
      setError(t("sell.saleDiscountTooHigh"));
      return;
    }

    accepting.current = true;
    setSaving(true);
    setError(null);

    try {
      // Who rang this sale up, fixed now: only this user's session may send it.
      if (!profile) throw new Error(t("sell.couldNotRecord"));
      const sale = pendingSaleFrom(
        attemptedSale.current?.id ?? Crypto.randomUUID(),
        {
          customer_id: method === "credit" ? customerId : null,
          payment_method: method,
          discount_cents: discountCents,
          total_cents: total,
        },
        lines,
        profile.id
      );
      if (
        attemptedSale.current &&
        JSON.stringify({ ...sale, created_at: attemptedSale.current.created_at }) !==
          JSON.stringify(attemptedSale.current)
      ) {
        // The basket changed since an attempt whose result is unknown. Never
        // reuse that attempt's id for a different basket, and never dead-end:
        // show the attempt and let the cashier retry it, check the history, or
        // discard it.
        setPaymentOpen(false);
        setUnconfirmed(attemptedSale.current);
        return;
      }
      attemptedSale.current = attemptedSale.current ?? sale;
      // Queued first, then synced: if the request dies midway the sale is
      // still on the device, and the id makes a retry safe to repeat.
      await enqueueSale(attemptedSale.current);
      attemptedSale.current = null;
      setUnconfirmed(null);
      // Local persistence is the acceptance boundary. Sync is best effort;
      // its failure must never leave this basket available to submit again.

      setLines([]);
      setSaleDiscount("");
      setPaymentOpen(false);
      setFlash(t("sell.recorded", { amount: formatMAD(total) }));
      void sync.sync().catch(() => {
        /* Hook reports sync errors; sale is already accepted. */
      });
    } catch {
      // The technical reason stays out of the cashier's way; the attempt is
      // kept (same id) so a retry is safe even if the write actually landed.
      setUnconfirmed(attemptedSale.current);
      setError(t("sell.couldNotRecord"));
    } finally {
      accepting.current = false;
      setSaving(false);
    }
  };

  // Basket quantities by product, for the grid's ×N badges.
  const inCart = useMemo(
    () =>
      Object.fromEntries(lines.map((l) => [l.product_id, l.quantity])) as Record<string, number>,
    [lines]
  );

  const retryAttempt = async () => {
    const attempt = attemptedSale.current;
    if (!attempt || accepting.current) return;
    accepting.current = true;
    setSaving(true);
    setError(null);
    try {
      await enqueueSale(attempt);
      attemptedSale.current = null;
      setUnconfirmed(null);
      // The basket is cleared only if it is the very sale that was just saved.
      if (JSON.stringify(lines) === JSON.stringify(attempt.lines)) {
        setLines([]);
        setSaleDiscount("");
        setPaymentOpen(false);
      }
      setFlash(t("sell.recorded", { amount: formatMAD(attempt.total_cents) }));
      void sync.sync().catch(() => {
        /* Hook reports sync errors; sale is already accepted. */
      });
    } catch {
      setError(t("sell.couldNotRecord"));
    } finally {
      accepting.current = false;
      setSaving(false);
    }
  };

  const discardAttempt = async () => {
    if (!attemptedSale.current) return;
    const ok = await confirm({
      tone: "danger",
      title: t("sell.attempt.discardTitle"),
      message: t("sell.attempt.discardMessage"),
      summary: t("sell.attempt.summary", {
        amount: formatMAD(attemptedSale.current.total_cents),
        method: t(paymentMethodKey(attemptedSale.current.payment_method)),
      }),
      confirmLabel: t("sell.attempt.discardConfirm"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    // Forgetting the attempt is what makes the next sale get a new id.
    attemptedSale.current = null;
    setUnconfirmed(null);
    setError(null);
  };

  const headerNode = (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <View style={styles.headerLinks}>
          <Pressable style={styles.headerLink} onPress={() => router.push("/(app)/sell/history")}>
            <Text style={styles.link}>{t("sell.history")}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={[styles.search, styles.flex]}
          placeholder={t("sell.searchPlaceholder")}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {Platform.OS !== "web" && (
          <Pressable style={styles.scanButton} onPress={() => setScannerOpen(true)}>
            <Text style={styles.scanButtonText}>{t("sell.scan")}</Text>
          </Pressable>
        )}
      </View>

      {flash && <Text style={styles.flash}>{flash}</Text>}

      {results.map((product) => (
        <Pressable key={product.id} style={styles.result} onPress={() => addProduct(product)}>
          <Text style={styles.resultName}>{isolateBidi(product.name)}</Text>
          <Text style={styles.resultPrice}>{formatMAD(product.selling_price_cents)}</Text>
        </Pressable>
      ))}
    </View>
  );
  const cartNode = (
    <>
      {unconfirmed && (
        <PendingAttemptCard
          sale={unconfirmed}
          busy={saving}
          error={paymentOpen ? null : error}
          onRetry={retryAttempt}
          onHistory={() => router.push("/(app)/sell/history")}
          onDiscard={discardAttempt}
        />
      )}

      <FlatList
        data={lines}
        keyExtractor={(line) => line.product_id}
        renderItem={({ item, index }) => (
          <CartLineRow
            line={item}
            onChange={(next) =>
              setLines((current) => current.map((line, i) => (i === index ? next : line)))
            }
            onRemove={() => setLines((current) => current.filter((_, i) => i !== index))}
          />
        )}
        ListEmptyComponent={
          isOwner && storeIsEmpty ? (
            <EmptyStorePrompt />
          ) : (
            <Text style={styles.empty}>{t("sell.empty")}</Text>
          )
        }
      />

      {lines.length > 0 && (
        <View style={styles.footer}>
          <View style={styles.discountRow}>
            <Text style={styles.footerLabel}>{t("sell.saleDiscount")}</Text>
            <TextInput
              style={[styles.discountInput, saleDiscountTooHigh && styles.discountInputInvalid]}
              value={saleDiscount}
              onChangeText={setSaleDiscount}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </View>

          {saleDiscountTooHigh && (
            <Text style={styles.discountError}>{t("sell.saleDiscountTooHigh")}</Text>
          )}

          <View style={styles.totalRow}>
            <Text style={styles.footerLabel}>
              {t("sell.subtotal", { amount: formatMAD(cartSubtotal(lines)) })}
            </Text>
            <Text style={styles.totalValue}>{formatMAD(total)}</Text>
          </View>

          <BigButton
            label={t("sell.charge")}
            variant="pay"
            onPress={() => setPaymentOpen(true)}
            disabled={discountInvalid || quantityInvalid}
          />
        </View>
      )}
    </>
  );

  return (
    <View style={styles.container}>
      {split ? (
        <View style={styles.split}>
          <View style={styles.gridPane}>
            {headerNode}
            {results.length === 0 && !search.trim() ? (
              <ProductGrid
                tabs={gridTabs}
                inCart={inCart}
                // The cache rows and live rows share the fields addProduct reads.
                onAdd={(product) => addProduct(product as unknown as Product)}
              />
            ) : null}
          </View>
          <View style={styles.cartPane}>{cartNode}</View>
        </View>
      ) : (
        <>
          {headerNode}
          {cartNode}
        </>
      )}

      <ContinuousScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={addByBarcode}
      />

      {weighing && (
        <WeightPad
          productName={weighing.name}
          unitPriceCents={weighing.selling_price_cents}
          onCancel={() => setWeighing(null)}
          onConfirm={(quantity) => {
            addLine(weighing, quantity);
            setFlash(t("sell.added", { name: weighing.name }));
            setWeighing(null);
          }}
        />
      )}

      <PaymentSheet
        visible={paymentOpen}
        totalCents={total}
        customers={customers}
        saving={saving}
        error={error}
        onClose={() => setPaymentOpen(false)}
        onConfirm={handleConfirm}
        onCreateCustomer={async (name) => {
          try {
            const created = await createCustomer(name, null);
            setCustomers((current) => [...current, created]);
            return created;
          } catch {
            return null;
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  // Tablet and laptop (>= 900 dp): grid and cart side by side, cart always visible.
  split: { flex: 1, flexDirection: "row" },
  gridPane: { flex: 1, minWidth: 0 },
  cartPane: { width: 420, borderStartWidth: 1, borderStartColor: "#e7ebee" },
  header: { padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: "#eee" },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLinks: { flexDirection: "row", gap: 8 },
  headerLink: { minHeight: 48, minWidth: 48, justifyContent: "center", paddingHorizontal: 8 },
  link: { color: "#1d7a46", fontWeight: "600", fontSize: 15 },
  searchRow: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  search: {
    minHeight: 56,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 16,
    fontSize: 17,
  },
  scanButton: {
    minHeight: 56,
    paddingHorizontal: 22,
    borderRadius: 10,
    backgroundColor: "#1d7a46",
    alignItems: "center",
    justifyContent: "center",
  },
  scanButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  flash: { color: "#1d7a46", fontSize: 14 },
  result: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#f4f4f4",
  },
  resultName: { fontSize: 15, fontWeight: "600", flex: 1 },
  resultPrice: { fontSize: 15, fontWeight: "700" },
  empty: { textAlign: "center", marginTop: 48, color: "#666", fontSize: 15 },
  footer: { padding: 16, gap: 12, borderTopWidth: 1, borderTopColor: "#eee" },
  discountRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footerLabel: { fontSize: 15, color: "#555" },
  discountInput: {
    minHeight: 48,
    minWidth: 110,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 14,
    fontSize: 16,
    textAlign: "right",
  },
  discountInputInvalid: { borderColor: "#b3261e" },
  discountError: { color: "#b3261e", fontSize: 13 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  totalValue: { fontSize: 30, fontWeight: "800" },
});
