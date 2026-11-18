import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { Banner } from "@/src/components/ui/Banner";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { LoadError } from "@/src/components/ui/LoadError";
import { errorKey } from "@/src/lib/errors/userMessage";
import { CustomerPaymentAction } from "@/src/components/clients/CustomerPaymentAction";
import { formatMAD } from "@/src/lib/money";
import { filterCustomers } from "@/src/lib/sales/cashEntry";
import {
  fetchCustomerBalances,
  recordCustomerPayment,
  type CustomerBalance,
} from "@/src/lib/sales/queries";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, touch } from "@/src/theme/tokens";

export default function CreditScreen() {
  const { t } = useTranslation();
  // null = never read successfully. A failed read must never turn into an
  // empty list ("nobody owes anything", total 0): it is its own state.
  const [balances, setBalances] = useState<CustomerBalance[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  // A translation key (see errorKey), never the server's text.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    fetchCustomerBalances()
      .then((rows) => {
        setBalances(rows);
        setLoadError(null);
      })
      .catch((failure) => setLoadError(errorKey(failure)))
      .finally(() => setLoaded(true));
  }, []);

  // Re-read on every return to this screen (a payment or sale may have changed
  // a balance in a customer's history).
  useFocusEffect(load);

  const retry = useCallback(() => {
    setLoaded(false);
    load();
  }, [load]);

  if (!loaded) return <ActivityIndicator style={{ marginTop: 40 }} />;

  if (balances === null) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <LoadError
          title={t("credit.loadError")}
          reasonKey={loadError ?? "errors.generic"}
          onRetry={retry}
        />
      </ScrollView>
    );
  }

  if (balances.length === 0 && !loadError) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <EmptyState icon="users" title={t("credit.emptyTitle")} message={t("credit.emptyHint")} />
      </ScrollView>
    );
  }

  const open = (id: string) => router.push({ pathname: "/(app)/clients/[id]", params: { id } });

  const shown = filterCustomers(balances, search);
  const owing = shown.filter((balance) => balance.balance_cents > 0);
  const settled = shown.filter((balance) => balance.balance_cents <= 0);
  // The shop-wide total is never filtered by the search.
  const totalOwed = balances
    .filter((balance) => balance.balance_cents > 0)
    .reduce((sum, balance) => sum + balance.balance_cents, 0);
  const searching = search.trim() !== "";

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {loadError ? (
        <Banner
          tone="warn"
          text={t("credit.refreshFailed")}
          action={{ label: t("common.retry"), onPress: retry }}
        />
      ) : null}

      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>{t("credit.totalOwed")}</Text>
        <Text style={styles.summaryValue}>{isolateLtr(formatMAD(totalOwed))}</Text>
      </View>

      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder={t("credit.searchPlaceholder")}
        placeholderTextColor={colors.ink600}
        accessibilityLabel={t("credit.searchPlaceholder")}
        autoCorrect={false}
      />

      {searching && shown.length === 0 && <Text style={styles.empty}>{t("credit.noResults")}</Text>}
      {!searching && owing.length === 0 && <Text style={styles.empty}>{t("credit.nobody")}</Text>}

      {owing.map((balance) => (
        <View key={balance.id} style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("credit.openCustomer", { name: balance.name })}
            style={styles.rowTop}
            onPress={() => open(balance.id)}
          >
            <View style={styles.rowMain}>
              <Text style={styles.name}>{isolateBidi(balance.name)}</Text>
              <Text style={styles.meta}>
                {balance.phone ? `${isolateLtr(balance.phone)} · ` : ""}
                {t("credit.took")} {isolateLtr(formatMAD(balance.credit_total_cents))} ·{" "}
                {t("credit.paid")} {isolateLtr(formatMAD(balance.paid_total_cents))}
              </Text>
            </View>
            <Text style={styles.balance}>{isolateLtr(formatMAD(balance.balance_cents))}</Text>
          </Pressable>

          <CustomerPaymentAction
            customerId={balance.id}
            balanceCents={balance.balance_cents}
            onRecord={(paymentId, cents) =>
              recordCustomerPayment(paymentId, balance.id, cents, "cash")
            }
            onRecorded={load}
          />
        </View>
      ))}

      {settled.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{t("credit.settled")}</Text>
          {settled.map((balance) => (
            <Pressable
              key={balance.id}
              accessibilityRole="button"
              accessibilityLabel={t("credit.openCustomer", { name: balance.name })}
              style={styles.settledRow}
              onPress={() => open(balance.id)}
            >
              <Text style={styles.settledName}>{isolateBidi(balance.name)}</Text>
              <Text style={styles.settledValue}>
                {balance.balance_cents < 0
                  ? t("credit.inCredit", { amount: isolateLtr(formatMAD(-balance.balance_cents)) })
                  : t("credit.clear")}
              </Text>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 48 },
  summary: { backgroundColor: colors.danger100, borderRadius: radius.panel, padding: 16, gap: 4 },
  summaryLabel: { fontSize: 14, color: colors.ink700 },
  // Money owed is the danger colour everywhere on this screen.
  summaryValue: { fontSize: 28, fontWeight: "800", color: colors.danger600 },
  search: {
    minHeight: touch.min,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.ink900,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    padding: 14,
    gap: 10,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    minHeight: touch.min,
  },
  rowMain: { flex: 1, gap: 3 },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink900 },
  meta: { fontSize: 13, color: colors.ink600 },
  balance: { fontSize: 18, fontWeight: "800", color: colors.danger600 },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink600,
    marginTop: 10,
  },
  settledRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    minHeight: touch.min,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  settledName: { flex: 1, fontSize: 15, color: colors.ink900 },
  settledValue: { fontSize: 14, color: colors.ink600 },
  empty: { textAlign: "center", color: colors.ink600, marginVertical: 20 },
});
