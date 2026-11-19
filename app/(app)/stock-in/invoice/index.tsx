import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import { errorKey } from "@/src/lib/errors/userMessage";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { confirmAndDeleteInvoiceDraft } from "@/src/lib/stock/deleteInvoiceDraftFlow";
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
  // A translation key (see errorKey), never the server's text.
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const deleting = useRef(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const owner = profile?.role === "owner";

  const load = useCallback(async (offset: number) => {
    const version = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listInvoiceDrafts(offset);
      if (version !== request.current) return;
      setRows((current) => (offset ? [...current, ...page] : page));
      setMore(page.length === 25);
    } catch (failure) {
      if (version === request.current) setError(errorKey(failure));
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

  async function remove(row: InvoiceSummary) {
    if (deleting.current) return;
    deleting.current = true;
    setDeleteError(null);
    try {
      const outcome = await confirmAndDeleteInvoiceDraft(row, t);
      if (outcome.result === "deleted")
        setRows((current) => current.filter((r) => r.id !== row.id));
      else if (outcome.result === "error") setDeleteError(outcome.key);
    } finally {
      deleting.current = false;
    }
  }

  if (!owner) return <Text>{t("stockIn.blockedText")}</Text>;

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      ListHeaderComponent={
        deleteError ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger700 }}>
            {t(deleteError)}
          </Text>
        ) : null
      }
      refreshing={loading && !rows.length}
      onRefresh={() => load(0)}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator />
        ) : error ? (
          <LoadError title={t("invoices.loadError")} reasonKey={error} onRetry={() => load(0)} />
        ) : (
          <EmptyState
            icon="receipt"
            title={t("invoices.noDrafts")}
            message={t("invoices.noDraftsHint")}
            action={
              <BigButton
                label={t("invoices.scan")}
                onPress={() => router.push("/(app)/stock-in/invoice/capture")}
              />
            }
          />
        )
      }
      ListFooterComponent={
        more || (error && rows.length > 0) ? (
          <BigButton
            variant="secondary"
            disabled={loading}
            label={t(error ? "invoices.retry" : "invoices.moreDrafts")}
            onPress={() => load(error ? 0 : rows.length)}
          />
        ) : null
      }
      renderItem={({ item }) => (
        <View style={{ gap: 4 }}>
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
          {!item.purchase_id && (
            <Pressable
              accessibilityRole="button"
              onPress={() => remove(item)}
              style={{
                minHeight: 44,
                justifyContent: "center",
                alignSelf: "flex-end",
                paddingHorizontal: 8,
              }}
            >
              <Text style={{ color: colors.danger700, fontWeight: "700" }}>
                {t("invoices.deleteDraft")}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    />
  );
}
