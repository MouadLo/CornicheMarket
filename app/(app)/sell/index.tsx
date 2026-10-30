import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { CartLineRow } from "@/src/components/sell/CartLineRow";
import { ContinuousScanner } from "@/src/components/sell/ContinuousScanner";
import { PaymentSheet } from "@/src/components/sell/PaymentSheet";
import { WeightPad } from "@/src/components/sell/WeightPad";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { centsToDisplay, formatMAD, parseMoneyToCents } from "@/src/lib/money";
import {
  findCachedByBarcode,
  getProductCacheMeta,
  refreshProductCache,
  searchCachedProducts,
  type CachedProduct,
} from "@/src/lib/products/offlineCache";
import { fetchProducts, type Product } from "@/src/lib/products/queries";
import { enqueueSale, type PendingSale } from "@/src/lib/sales/offlineQueue";
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
import { pendingSaleFrom, useSaleSync } from "@/src/lib/sales/useSaleSync";
import { useDebouncedValue } from "@/src/lib/useDebouncedValue";

export default function SellScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isOwner = profile?.role === "owner";
  const sync = useSaleSync();
  const accepting = useRef(false);
  // Retain the operation in memory across an ambiguous storage failure.
  const attemptedSale = useRef<PendingSale | null>(null);

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
  const [offlineMeta, setOfflineMeta] = useState<{ refreshedAt: string } | null>(null);

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

  // Refresh the local product cache whenever the device comes online.
  useEffect(() => {
    if (sync.online) {
      refreshProductCache(isOwner)
        .then(() => getProductCacheMeta())
        .then(setOfflineMeta)
        .catch(() => {});
    }
  }, [sync.online, isOwner]);

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
          unit_cost_cents: product.current_cost_cents,
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
    async (barcode: string): Promise<string | null> => {
      try {
        let match: Product | CachedProduct | undefined;

        if (!sync.online) {
          match = (await findCachedByBarcode(barcode)) ?? undefined;
        } else {
          [match] = await fetchProducts(
            { search: barcode, categoryId: null, lowStockOnly: false, status: "active" },
            0,
            isOwner
          );
        }

        if (!match) {
          setFlash(t("sell.notFound", { barcode }));
          return t("sell.notFound", { barcode });
        }
        if (addProduct(match as Product)) {
          setFlash(t("sell.added", { name: match.name }));
        } else {
          // The weight keypad is a modal of its own; close the camera first
          // rather than stack two modals.
          setScannerOpen(false);
        }
        return `${match.name} · ${centsToDisplay(match.selling_price_cents)} DH`;
      } catch {
        setFlash(t("sell.lookupFailed"));
        return null;
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
      const sale = pendingSaleFrom(
        attemptedSale.current?.id ?? Crypto.randomUUID(),
        {
          customer_id: method === "credit" ? customerId : null,
          payment_method: method,
          discount_cents: discountCents,
          total_cents: total,
        },
        lines
      );
      if (
        attemptedSale.current &&
        JSON.stringify({ ...sale, created_at: attemptedSale.current.created_at }) !==
          JSON.stringify(attemptedSale.current)
      ) {
        throw new Error(
          "The previous sale may already be saved. Restore the original basket and payment before retrying."
        );
      }
      attemptedSale.current = attemptedSale.current ?? sale;
      // Queued first, then synced: if the request dies midway the sale is
      // still on the device, and the id makes a retry safe to repeat.
      await enqueueSale(attemptedSale.current);
      attemptedSale.current = null;
      // Local persistence is the acceptance boundary. Sync is best effort;
      // its failure must never leave this basket available to submit again.

      setLines([]);
      setSaleDiscount("");
      setPaymentOpen(false);
      setFlash(t("sell.recorded", { amount: formatMAD(total) }));
      void sync.sync().catch(() => {
        /* Hook reports sync errors; sale is already accepted. */
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("sell.couldNotRecord"));
    } finally {
      accepting.current = false;
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <SyncBadge online={sync.online} pending={sync.pending} syncing={sync.syncing} />
          <View style={styles.headerLinks}>
            {isOwner && sync.stuck > 0 && (
              <Pressable onPress={() => router.push("/(app)/sell/stuck" as never)}>
                <Text style={styles.stuckLink}>{t("sell.stuckBanner", { count: sync.stuck })}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => router.push("/(app)/sell/credit")}>
              <Text style={styles.link}>{t("sell.credit")}</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/(app)/sell/history")}>
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

        {!sync.online && offlineMeta && (
          <Text style={styles.offlineBanner}>
            {t("sell.offlineBanner", {
              time: new Date(offlineMeta.refreshedAt).toLocaleTimeString(),
            })}
          </Text>
        )}

        {flash && <Text style={styles.flash}>{flash}</Text>}

        {results.map((product) => (
          <Pressable key={product.id} style={styles.result} onPress={() => addProduct(product)}>
            <Text style={styles.resultName}>{product.name}</Text>
            <Text style={styles.resultPrice}>{formatMAD(product.selling_price_cents)}</Text>
          </Pressable>
        ))}
      </View>

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
        ListEmptyComponent={<Text style={styles.empty}>{t("sell.empty")}</Text>}
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
            onPress={() => setPaymentOpen(true)}
            disabled={discountInvalid || quantityInvalid}
          />
        </View>
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

function SyncBadge({
  online,
  pending,
  syncing,
}: {
  online: boolean;
  pending: number;
  syncing: boolean;
}) {
  const { t } = useTranslation();
  const label = syncing
    ? t("sell.syncSyncing")
    : !online
      ? pending > 0
        ? t("sell.syncOfflineQueued", { count: pending })
        : t("sell.syncOffline")
      : pending > 0
        ? t("sell.syncPending", { count: pending })
        : t("sell.syncOnline");

  return (
    <View
      style={[styles.badge, !online && styles.badgeOffline, pending > 0 && styles.badgePending]}
    >
      <Text style={[styles.badgeText, !online && styles.badgeTextOffline]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: { padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: "#eee" },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLinks: { flexDirection: "row", gap: 16 },
  link: { color: "#1d7a46", fontWeight: "600", fontSize: 15 },
  stuckLink: { color: "#b3261e", fontWeight: "700", fontSize: 14 },
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
  offlineBanner: { color: "#b36b00", fontSize: 13, fontStyle: "italic" },
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
  badge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "#e8f3ec",
  },
  badgePending: { backgroundColor: "#fff3d6" },
  badgeOffline: { backgroundColor: "#fdecea" },
  badgeText: { fontSize: 13, fontWeight: "700", color: "#1d7a46" },
  badgeTextOffline: { color: "#b3261e" },
});
