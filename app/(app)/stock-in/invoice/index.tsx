import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { listInvoiceDrafts, type InvoiceSummary } from "@/src/lib/stock/invoices";
import { isolateBidi } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

const statuses = {
  ready: "invoices.statusReady",
  failed: "invoices.statusFailed",
  extracting: "invoices.statusExtracting",
} as const;

export default function InvoiceList() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<InvoiceSummary[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const owner = profile?.role === "owner";

  const load = useCallback(async (offset: number) => {
    const version = ++request.current;
    setLoading(true);
    setError(false);
    try {
      const page = await listInvoiceDrafts(offset);
      if (version !== request.current) return;
      setRows((current) => (offset ? [...current, ...page] : page));
      setMore(page.length === 25);
    } catch {
      if (version === request.current) setError(true);
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (owner) void load(0);
      return () => {
        request.current++;
      };
    }, [load, owner])
  );

  if (!owner) return <Text>{t("stockIn.blockedText")}</Text>;

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshing={loading && !rows.length}
      onRefresh={() => load(0)}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator />
        ) : (
          <Text>{t(error ? "invoices.loadError" : "invoices.noDrafts")}</Text>
        )
      }
      ListFooterComponent={
        more || error ? (
          <BigButton
            variant="secondary"
            disabled={loading}
            label={t(error ? "invoices.retry" : "invoices.moreDrafts")}
            onPress={() => load(error ? 0 : rows.length)}
          />
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: "/(app)/stock-in/invoice/[id]", params: { id: item.id } })
          }
          style={{
            minHeight: 52,
            padding: 14,
            gap: 6,
            borderRadius: radius.panel,
            backgroundColor: colors.surface,
          }}
        >
          <Text style={{ fontWeight: "700" }}>
            {isolateBidi(item.invoice_number ?? t("invoices.untitled"))}
          </Text>
          {item.suppliers?.name && <Text>{isolateBidi(item.suppliers.name)}</Text>}
          {item.invoice_date && <Text>{isolateBidi(item.invoice_date)}</Text>}
          <Text>{t(item.purchase_id ? "invoices.statusApproved" : statuses[item.status])}</Text>
          {item.flags.map((flag) => (
            <Text key={flag} style={{ color: colors.warning700 }}>
              {t("invoices." + flag)}
            </Text>
          ))}
        </Pressable>
      )}
    />
  );
}
