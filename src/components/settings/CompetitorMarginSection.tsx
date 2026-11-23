import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { Banner } from "@/src/components/ui/Banner";
import { Field } from "@/src/components/ui/Field";
import { InlineError } from "@/src/components/ui/InlineError";
import { fetchStoreMinMargin, updateStoreMinMargin } from "@/src/lib/competitors/queries";
import { parseMarginPercent } from "@/src/lib/sellGrid/diversSettings";
import { Text } from "@/src/theme/Text";
import { colors } from "@/src/theme/tokens";

// Owner only. The store-wide minimum margin the Competitor prices page keeps
// (15 % unless changed); a product can override it on its own page.
export function CompetitorMarginSection() {
  const { t } = useTranslation();
  const [text, setText] = useState("15");
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  const load = useCallback(() => {
    setLoadFailed(false);
    fetchStoreMinMargin()
      .then((percent) => {
        setText(String(percent));
        setLoaded(true);
      })
      .catch(() => setLoadFailed(true));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    setMessage(null);
    setError(null);
    const percent = parseMarginPercent(text);
    if (percent === null) {
      setFieldError(t("settings.competitorMarginErr"));
      return;
    }
    setFieldError(undefined);
    setSaving(true);
    try {
      await updateStoreMinMargin(percent);
      setText(String(percent));
      setMessage(t("settings.competitorMarginSaved"));
    } catch {
      setError("settings.competitorMarginSaveError");
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <Banner
        tone="warn"
        text={t("settings.competitorMarginLoadError")}
        action={{ label: t("common.retry"), onPress: load }}
      />
    );
  }
  if (!loaded) return <Text style={styles.hint}>{t("common.loading")}</Text>;

  return (
    <View style={styles.box}>
      <Field
        label={t("settings.competitorMarginLabel")}
        unit="%"
        numeric
        value={text}
        onChangeText={(value) => {
          setMessage(null);
          setText(value);
        }}
        placeholder="15"
        error={fieldError}
      />
      {error ? <InlineError reasonKey={error} /> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}
      <BigButton label={t("settings.competitorMarginSave")} onPress={save} disabled={saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  hint: { fontSize: 13, color: colors.ink600, lineHeight: 18 },
  success: { color: colors.success700 },
});
