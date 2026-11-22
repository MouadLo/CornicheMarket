import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Banner } from "@/src/components/ui/Banner";
import { Field } from "@/src/components/ui/Field";
import { InlineError } from "@/src/components/ui/InlineError";
import {
  DEFAULT_DIVERS_SETTINGS,
  formFromDiversSettings,
  validateDiversForm,
  type DiversField,
  type DiversForm,
} from "@/src/lib/sellGrid/diversSettings";
import { fetchDiversSettings, updateDiversSettings } from "@/src/lib/sellGrid/queries";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

// Owner only. The cashiers' maximum for one Divers line and the estimated margin.
export function DiversSection() {
  const { t } = useTranslation();
  const [form, setForm] = useState<DiversForm>(() =>
    formFromDiversSettings(DEFAULT_DIVERS_SETTINGS)
  );
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DiversField, string>>>({});

  const load = useCallback(() => {
    setLoadFailed(false);
    fetchDiversSettings()
      .then((settings) => {
        setForm(formFromDiversSettings(settings));
        setLoaded(true);
      })
      .catch(() => setLoadFailed(true));
  }, []);
  useEffect(load, [load]);

  const set = (key: DiversField, value: string) => {
    setMessage(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setMessage(null);
    const result = validateDiversForm(form);
    if (!result.ok) {
      setFieldErrors(result.errors);
      setError(null);
      return;
    }
    setFieldErrors({});
    setError(null);
    setSaving(true);
    try {
      await updateDiversSettings(result.settings);
      setForm(formFromDiversSettings(result.settings));
      setMessage(t("settings.diversSaved"));
    } catch {
      setError("settings.diversSaveError");
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <Banner
        tone="warn"
        text={t("settings.diversLoadError")}
        action={{ label: t("common.retry"), onPress: load }}
      />
    );
  }
  if (!loaded) return <Text style={styles.hint}>{t("common.loading")}</Text>;

  const fieldError = (field: DiversField) => {
    const key = fieldErrors[field];
    return key ? t(key) : undefined;
  };

  return (
    <View style={styles.box}>
      <Field
        label={t("settings.diversMaxLabel")}
        unit="DH"
        numeric
        value={form.maxDh}
        onChangeText={(value) => set("maxDh", value)}
        placeholder="200.00"
        error={fieldError("maxDh")}
      />
      <Field
        label={t("settings.diversMarginLabel")}
        unit="%"
        numeric
        value={form.marginPercent}
        onChangeText={(value) => set("marginPercent", value)}
        placeholder="20"
        error={fieldError("marginPercent")}
      />
      {error ? <InlineError reasonKey={error} /> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}
      <BigButton label={t("settings.diversSave")} onPress={save} disabled={saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  success: { color: colors.success700 },
});
