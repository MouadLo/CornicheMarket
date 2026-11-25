import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ConfirmTab } from "@/src/components/competitors/ConfirmTab";
import { MissingTab } from "@/src/components/competitors/MissingTab";
import { OpportunitiesTab } from "@/src/components/competitors/OpportunitiesTab";
import { ShopsTab } from "@/src/components/competitors/ShopsTab";
import { SourcingTab } from "@/src/components/competitors/SourcingTab";
import { TrackedList } from "@/src/components/competitors/TrackedList";
import { Tabs } from "@/src/components/ui/Tabs";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { fetchCatalogCounts, type CatalogCounts } from "@/src/lib/competitors/shops";
import { colors } from "@/src/theme/tokens";

type Tab = "tracked" | "opportunities" | "confirm" | "missing" | "sourcing" | "shops";
const TABS: readonly Tab[] = [
  "tracked",
  "opportunities",
  "confirm",
  "missing",
  "sourcing",
  "shops",
];

const isTab = (value: unknown): value is Tab =>
  typeof value === "string" && (TABS as readonly string[]).includes(value);

// Owner only (a cashier is sent back to Vente). Concurrents: the tracked
// products (phase 1), the proposed matches to confirm, the competitors' products
// we do not have, what to source, and the shops we read.
export default function Competitors() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [counts, setCounts] = useState<CatalogCounts | null>(null);
  // Remounts the list of the open tab after a change made in another one.
  const [version, setVersion] = useState(0);

  // The open tab lives in the URL (`/competitors?tab=sourcing`), so it survives
  // leaving the section and coming back (browser back, the header arrow of a
  // screen opened from a tab) and a reload. An unknown value means the default.
  // `r` changes on every return from "Créer le produit", so coming back twice
  // to the same tab still reloads it.
  const params = useLocalSearchParams<{ tab?: string; r?: string }>();
  const tab: Tab = isTab(params.tab) ? params.tab : "tracked";
  const lastR = useRef(params.r);
  useEffect(() => {
    if (params.r === lastR.current) return;
    lastR.current = params.r;
    setVersion((v) => v + 1);
  }, [params.r]);

  const refreshCounts = useCallback(() => {
    fetchCatalogCounts()
      .then(setCounts)
      .catch(() => setCounts(null));
  }, []);

  useEffect(() => {
    if (isOwner) refreshCounts();
  }, [isOwner, refreshCounts, tab]);

  if (profile && !isOwner) return <Redirect href="/(app)/sell" />;
  if (!isOwner) return null;

  const changed = () => {
    refreshCounts();
  };

  return (
    <View style={styles.screen}>
      <Tabs
        items={[
          { key: "tracked", label: t("competitors.tabs.tracked") },
          { key: "opportunities", label: t("competitors.tabs.opportunities") },
          { key: "confirm", label: t("competitors.tabs.confirm"), badge: counts?.proposed },
          { key: "missing", label: t("competitors.tabs.missing") },
          {
            key: "sourcing",
            label: t("competitors.tabs.sourcing"),
            badge: counts?.wanted,
            badgeTone: "info",
          },
          { key: "shops", label: t("competitors.tabs.shops") },
        ]}
        value={tab}
        onChange={(key) => {
          router.setParams({ tab: key });
          setVersion((v) => v + 1);
        }}
      />
      <View style={styles.body} key={`${tab}-${version}`}>
        {tab === "tracked" ? <TrackedList /> : null}
        {tab === "opportunities" ? <OpportunitiesTab /> : null}
        {tab === "confirm" ? <ConfirmTab onChanged={changed} /> : null}
        {tab === "missing" ? <MissingTab onChanged={changed} /> : null}
        {tab === "sourcing" ? <SourcingTab onChanged={changed} /> : null}
        {tab === "shops" ? <ShopsTab onChanged={changed} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
});
