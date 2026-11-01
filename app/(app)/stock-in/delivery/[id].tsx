import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { formatMAD } from "@/src/lib/money";
import {
  fetchPurchase,
  previewVoidPurchase,
  voidPurchase,
  type PurchaseDetail,
} from "@/src/lib/stock/queries";
import { voidDeliveryConfirmMessage } from "@/src/lib/stock/voidConfirm";
import { unitLabel } from "@/src/lib/products/unitLabel";
import { formatLocaleDate, formatLocaleDateTime } from "@/src/lib/text/dates";
import { isolateBidi } from "@/src/lib/text/bidi";

export default function DeliveryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();
  const isOwner = profile?.role === "owner";

  const [purchase, setPurchase] = useState<PurchaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // Synchronous latch: a second tap lands before React re-renders `saving`.
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPurchase(await fetchPurchase(id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("stockIn.deliveryLoadError"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  if (!isOwner) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t("stockIn.deliveryOwnerOnly")}</Text>
      </View>
    );
  }
  if (loading && !purchase) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (!purchase) return <Text style={styles.error}>{error}</Text>;

  const voided = purchase.voidedAt !== null;
  const canVoid = reason.trim().length > 0 && !saving;

  const handleVoid = async () => {
    if (inFlight.current || reason.trim().length === 0) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      // Show exactly what the void will do before doing it; the numbers
      // come from the same SQL function that applies it.
      const preview = await previewVoidPurchase(purchase.id);
      const confirmed = await confirmDestructive(
        t("stockIn.deliveryVoidConfirmTitle"),
        voidDeliveryConfirmMessage(preview, t, formatMAD),
        t("stockIn.deliveryVoidButton"),
        t("common.cancel")
      );
      if (!confirmed) return;

      await voidPurchase(purchase.id, reason.trim());
      setReason("");
      await load();
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : t("common.error"));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {voided && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {t("stockIn.deliveryVoidedBanner", {
              date: formatLocaleDateTime(new Date(purchase.voidedAt as string), i18n.language),
              name: purchase.voidedByName ?? "",
            })}
          </Text>
          <Text style={styles.bannerReason}>{purchase.voidReason}</Text>
        </View>
      )}

      <View style={styles.header}>
        <Text style={[styles.title, voided && styles.struck]}>
          {purchase.supplierName ?? t("stockIn.historyNoSupplier")}
        </Text>
        <Text style={styles.meta}>
          {formatLocaleDate(new Date(purchase.purchaseDate), i18n.language)}
          {purchase.notes ? ` · ${purchase.notes}` : ""}
        </Text>
      </View>

      {purchase.lines.map((line) => (
        <View key={line.id} style={styles.line}>
          <View style={styles.lineMain}>
            <Text style={[styles.lineName, voided && styles.struck]}>
              {isolateBidi(line.productName)}
            </Text>
            <Text style={styles.meta}>
              {line.quantity} {unitLabel(line.unit, line.quantity, t)} ×{" "}
              {formatMAD(line.unitCostCents)}
              {line.expiryDate
                ? ` · ${t("stockIn.deliveryExpiry", { date: line.expiryDate })}`
                : ""}
            </Text>
          </View>
          <Text style={[styles.lineTotal, voided && styles.struck]}>
            {formatMAD(line.lineTotalCents)}
          </Text>
        </View>
      ))}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{t("stockIn.deliveryTotal")}</Text>
        <Text style={[styles.totalValue, voided && styles.struck]}>
          {formatMAD(purchase.totalCents)}
        </Text>
      </View>

      {!voided && (
        <View style={styles.voidBox}>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder={t("stockIn.deliveryVoidReason")}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <BigButton
            label={saving ? t("stockIn.deliveryVoiding") : t("stockIn.deliveryVoidButton")}
            variant="danger"
            onPress={handleVoid}
            disabled={!canVoid}
          />
        </View>
      )}
      {voided && error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: "center", padding: 32 },
  muted: { fontSize: 16, textAlign: "center", color: "#555" },
  header: { gap: 4 },
  title: { fontSize: 20, fontWeight: "700" },
  meta: { fontSize: 13, color: "#666" },
  struck: { textDecorationLine: "line-through", color: "#777" },
  banner: { backgroundColor: "#fdecea", borderRadius: 12, padding: 14, gap: 4 },
  bannerText: { color: "#b3261e", fontWeight: "700", fontSize: 14 },
  bannerReason: { color: "#333", fontSize: 14 },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  lineMain: { flex: 1, gap: 3 },
  lineName: { fontSize: 15, fontWeight: "600" },
  lineTotal: { fontSize: 16, fontWeight: "700" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  totalLabel: { fontSize: 16, fontWeight: "600" },
  totalValue: { fontSize: 20, fontWeight: "800" },
  voidBox: { gap: 10, marginTop: 8 },
  input: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: "#fff",
  },
  error: { color: "#b3261e", fontSize: 14 },
});
