import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Banner } from "@/src/components/ui/Banner";
import { Field } from "@/src/components/ui/Field";
import { InlineError } from "@/src/components/ui/InlineError";
import { loyaltyErrorKey } from "@/src/lib/loyalty/errors";
import {
  fetchLoyaltyCategories,
  fetchLoyaltySettings,
  setCategoryLoyaltyExcluded,
  updateLoyaltySettings,
  type LoyaltyCategory,
} from "@/src/lib/loyalty/queries";
import {
  DEFAULT_LOYALTY_SETTINGS,
  formFromSettings,
  validateLoyaltyForm,
  type LoyaltyField,
  type LoyaltyForm,
} from "@/src/lib/loyalty/settings";
import { localizeCategoryName } from "@/src/lib/products/categoryCatalog";
import { inTreeOrder } from "@/src/lib/products/categories";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

// Owner only. The program's switch and rates, and which categories earn nothing.
export function LoyaltySection() {
  const { t, i18n } = useTranslation();
  const language = i18n?.language ?? "fr";
  const [form, setForm] = useState<LoyaltyForm>(() => formFromSettings(DEFAULT_LOYALTY_SETTINGS));
  const [categories, setCategories] = useState<LoyaltyCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LoyaltyField, string>>>({});
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    Promise.all([fetchLoyaltySettings(), fetchLoyaltyCategories()])
      .then(([settings, rows]) => {
        setForm(formFromSettings(settings));
        setCategories(rows);
        setLoaded(true);
      })
      .catch(() => setLoadFailed(true));
  }, []);
  useEffect(load, [load]);

  const set = <K extends keyof LoyaltyForm>(key: K, value: LoyaltyForm[K]) => {
    setMessage(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setMessage(null);
    const result = validateLoyaltyForm(form);
    if (!result.ok) {
      setFieldErrors(result.errors);
      setError(null);
      return;
    }
    setFieldErrors({});
    setError(null);
    setSaving(true);
    try {
      await updateLoyaltySettings(result.settings);
      setForm(formFromSettings(result.settings));
      setMessage(t("loyalty.settingsSaved"));
    } catch (failure) {
      setError(loyaltyErrorKey(failure, "loyalty.settingsSaveError"));
    } finally {
      setSaving(false);
    }
  };

  // Each toggle is saved at once; a failure puts the old value back.
  const toggleCategory = async (category: LoyaltyCategory, excluded: boolean) => {
    setCategoryError(null);
    setCategories((rows) =>
      rows.map((row) => (row.id === category.id ? { ...row, loyalty_excluded: excluded } : row))
    );
    try {
      await setCategoryLoyaltyExcluded(category.id, excluded);
    } catch (failure) {
      setCategories((rows) =>
        rows.map((row) =>
          row.id === category.id ? { ...row, loyalty_excluded: category.loyalty_excluded } : row
        )
      );
      setCategoryError(loyaltyErrorKey(failure, "loyalty.settingsSaveError"));
    }
  };

  const tree = useMemo(() => inTreeOrder(categories), [categories]);
  const excludedMain = useMemo(
    () => new Set(categories.filter((c) => !c.parent_id && c.loyalty_excluded).map((c) => c.id)),
    [categories]
  );

  // What the rates mean in plain words: the share of a purchase given back.
  const preview = useMemo(() => {
    const result = validateLoyaltyForm(form);
    if (!result.ok) return null;
    const percent = (result.settings.pointValueCents / result.settings.centsPerPoint) * 100;
    return String(Math.round(percent * 100) / 100);
  }, [form]);

  if (loadFailed) {
    return (
      <Banner
        tone="warn"
        text={t("loyalty.settingsLoadError")}
        action={{ label: t("common.retry"), onPress: load }}
      />
    );
  }
  if (!loaded) return <Text style={styles.hint}>{t("common.loading")}</Text>;

  const fieldError = (field: LoyaltyField) => {
    const key = fieldErrors[field];
    return key ? t(key) : undefined;
  };

  return (
    <View style={styles.box}>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t("loyalty.settingsEnable")}</Text>
        <Switch
          value={form.enabled}
          onValueChange={(value) => set("enabled", value)}
          accessibilityLabel={t("loyalty.settingsEnable")}
        />
      </View>
      <Text style={styles.hint}>{t("loyalty.settingsEnableHint")}</Text>

      <Field
        label={t("loyalty.settingsEarnLabel")}
        unit="DH"
        numeric
        value={form.dhPerPoint}
        onChangeText={(value) => set("dhPerPoint", value)}
        placeholder="10.00"
        error={fieldError("dhPerPoint")}
      />
      <Field
        label={t("loyalty.settingsValueLabel")}
        unit="DH"
        numeric
        value={form.dhFor100Points}
        onChangeText={(value) => set("dhFor100Points", value)}
        placeholder="10.00"
        error={fieldError("dhFor100Points")}
        helper={
          preview !== null
            ? t("loyalty.settingsBackPercent", { percent: isolateLtr(preview) })
            : undefined
        }
      />
      <Field
        label={t("loyalty.settingsMinPoints")}
        keyboardType="number-pad"
        value={form.minPoints}
        onChangeText={(value) => set("minPoints", value)}
        placeholder="100"
        error={fieldError("minPoints")}
      />
      <Field
        label={t("loyalty.settingsDailyPoints")}
        keyboardType="number-pad"
        value={form.dailyPoints}
        onChangeText={(value) => set("dailyPoints", value)}
        placeholder="100"
        error={fieldError("dailyPoints")}
        helper={t("loyalty.settingsDailyHint")}
      />
      <Field
        label={t("loyalty.settingsWelcomePoints")}
        keyboardType="number-pad"
        value={form.welcomePoints}
        onChangeText={(value) => set("welcomePoints", value)}
        placeholder="0"
        error={fieldError("welcomePoints")}
      />

      {error ? <InlineError reasonKey={error} /> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}
      <BigButton label={t("loyalty.settingsSave")} onPress={save} disabled={saving} />

      <Text style={styles.subTitle}>{t("loyalty.settingsCategoriesTitle")}</Text>
      <Text style={styles.hint}>{t("loyalty.settingsCategoriesHint")}</Text>
      {tree.length === 0 ? (
        <Text style={styles.hint}>{t("loyalty.settingsNoCategories")}</Text>
      ) : (
        tree.map((category) => {
          const isSub = !!category.parent_id;
          const inherited = isSub && excludedMain.has(category.parent_id as string);
          const name = isolateBidi(localizeCategoryName(category.name, language));
          return (
            <View key={category.id} style={[styles.categoryRow, isSub && styles.categorySub]}>
              <View style={styles.categoryMain}>
                <Text style={[styles.categoryName, isSub && styles.categorySubName]}>{name}</Text>
                {inherited ? (
                  <Text style={styles.hint}>{t("loyalty.settingsInherited")}</Text>
                ) : null}
              </View>
              <Text style={styles.excludedLabel}>{t("loyalty.excluded")}</Text>
              <Switch
                value={category.loyalty_excluded || inherited}
                disabled={inherited}
                onValueChange={(value) => toggleCategory(category, value)}
                accessibilityLabel={`${t("loyalty.excluded")} ${name}`}
              />
            </View>
          );
        })
      )}
      {categoryError ? <InlineError reasonKey={categoryError} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  success: { color: colors.success700 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  switchLabel: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.ink900 },
  subTitle: { fontSize: 15, fontWeight: "700", color: colors.ink700, marginTop: 8 },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: radius.control,
    backgroundColor: colors.sunken,
  },
  categorySub: {
    marginStart: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  categoryMain: { flex: 1, gap: 2 },
  categoryName: { fontSize: 15, fontWeight: "700", color: colors.ink900 },
  categorySubName: { fontWeight: "500" },
  excludedLabel: { fontSize: 14, color: colors.ink600 },
});
