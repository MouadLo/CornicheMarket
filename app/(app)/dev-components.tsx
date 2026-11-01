import { Redirect } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { Chip } from "@/src/components/ui/Chip";
import { Field } from "@/src/components/ui/Field";
import { ICONS, Icon, type IconName } from "@/src/components/ui/Icon";
import { ListRow } from "@/src/components/ui/ListRow";
import { Money } from "@/src/components/ui/Money";
import { Segmented } from "@/src/components/ui/Segmented";
import { StatusPill } from "@/src/components/ui/StatusPill";
import { Tabs } from "@/src/components/ui/Tabs";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

// Owner-only review page for the shared primitives (docs/THEME-STRUCTURE.md, D2).
// Not in the navigation: open /dev-components. Plain strings on purpose, this is
// a developer page, not a product screen.
export default function DevComponents() {
  const { profile } = useAuth();
  const { i18n } = useTranslation();
  const [chip, setChip] = useState("drinks");
  const [tab, setTab] = useState("receive");
  const [mode, setMode] = useState<"weight" | "amount">("weight");
  const [price, setPrice] = useState("6.50");
  const [picked, setPicked] = useState("c1");

  if (profile && profile.role !== "owner") return <Redirect href="/(app)/sell" />;

  const ar = i18n.language === "ar";
  const L = (fr: string, a: string) => (ar ? a : fr);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.h1}>{L("Composants partagés", "المكونات المشتركة")}</Text>

      <Card title="Money">
        <View style={styles.col}>
          <Money cents={348250} size="total" />
          <Money cents={74230} size="kpi" tone="flow" />
          <Money cents={-240} tone="flow" />
          <Money cents={0} tone="flow" />
          <Money cents={125} tone="muted" size="caption" />
        </View>
      </Card>

      <Card title="Chips">
        <View style={styles.row}>
          {[
            ["drinks", L("Boissons", "مشروبات")],
            ["bakery", L("Boulangerie", "مخبزة")],
            ["dairy", L("Laitier", "ألبان")],
          ].map(([k, label]) => (
            <Chip key={k} label={label} selected={chip === k} onPress={() => setChip(k)} />
          ))}
          <Chip label={L("Stock bas", "مخزون منخفض")} icon="alert" count={3} onPress={() => {}} />
        </View>
      </Card>

      <Card title="Tabs">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: "receive", label: L("Réception", "الاستلام") },
            { key: "buys", label: L("Achats", "المشتريات") },
            { key: "order", label: L("À commander", "للطلب"), badge: 5 },
            { key: "count", label: L("Inventaire", "الجرد"), badge: 1, badgeTone: "bad" },
          ]}
        />
      </Card>

      <Card title="Segmented">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { key: "weight", label: L("Poids", "الوزن") },
            { key: "amount", label: L("Montant", "المبلغ") },
          ]}
        />
      </Card>

      <Card title="Badges and status pills">
        <View style={styles.row}>
          <Badge value={4} />
          <Badge value={8} tone="warn" />
          <Badge value={1} tone="bad" />
          <Badge value={12} tone="neutral" />
          <Badge value={3} tone="ok" />
        </View>
        <View style={[styles.row, styles.gap]}>
          <StatusPill tone="ok" icon="check" label={L("Payée", "مدفوعة")} />
          <StatusPill tone="warn" icon="clock" label={L("Partielle", "جزئية")} />
          <StatusPill tone="bad" icon="alert" label={L("Impayée", "غير مدفوعة")} />
          <StatusPill tone="neutral" icon="x" label={L("Annulée", "ملغاة")} />
          <StatusPill tone="info" icon="book" label={L("Crédit", "كريدي")} />
        </View>
      </Card>

      <Card title="Fields">
        <View style={styles.col}>
          <Field
            label={L("Nom", "الاسم")}
            placeholder={L("Nom du produit", "اسم المنتج")}
            value=""
            onChangeText={() => {}}
          />
          <Field
            label={L("Prix de vente", "ثمن البيع")}
            numeric
            unit="DH"
            value={price}
            onChangeText={setPrice}
            helper={L("Marge +2.30 DH", "الهامش +2.30 DH")}
          />
          <Field
            label={L("Montant", "المبلغ")}
            numeric
            unit="DH"
            value="250"
            error={L("Dépasse 200.00 DH", "يتجاوز 200.00 DH")}
            onChangeText={() => {}}
          />
        </View>
      </Card>

      <Card title="List rows">
        {[
          ["c1", "Hassan El Idrissi", "0661 23 45 67", 112000],
          ["c2", "خديجة الجارة", "0655 40 30 20", 8600],
          ["c3", "Omar (café d’en face)", "0670 11 22 33", 41000],
        ].map(([id, name, phone, owed]) => (
          <ListRow
            key={id as string}
            title={isolateBidi(name as string)}
            subtitle={isolateLtr(phone as string)}
            selected={picked === id}
            onPress={() => setPicked(id as string)}
            trailing={<Money cents={owed as number} size="subtitle" />}
          />
        ))}
      </Card>

      <Card title="Buttons (BigButton)">
        <View style={styles.col}>
          <BigButton label={L("Enregistrer", "حفظ")} onPress={() => {}} />
          <BigButton
            label={L("Encaisser 32.55 DH", "تحصيل 32.55 DH")}
            variant="pay"
            onPress={() => {}}
          />
          <BigButton label={L("Retour", "رجوع")} variant="secondary" onPress={() => {}} />
          <BigButton
            label={L("Annuler la vente", "إلغاء البيع")}
            variant="danger"
            onPress={() => {}}
          />
          <BigButton label={L("Désactivé", "معطل")} disabled onPress={() => {}} />
        </View>
      </Card>

      <Card title={`Icons (${Object.keys(ICONS).length})`}>
        <View style={styles.row}>
          {(Object.keys(ICONS) as IconName[]).map((name) => (
            <View key={name} style={styles.icon}>
              <Icon name={name} color={colors.ink700} />
              <Text style={styles.iconLabel}>{name}</Text>
            </View>
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16, backgroundColor: colors.bg },
  h1: { fontSize: 24, fontWeight: "700", color: colors.ink900 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  col: { gap: 12 },
  gap: { marginTop: 12 },
  icon: { width: 84, alignItems: "center", gap: 4, paddingVertical: 6 },
  iconLabel: { fontSize: 12, color: colors.ink600 },
});
