import { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { useSignOut } from "@/src/lib/auth/useSignOut";
import { supabase } from "@/src/lib/supabase/client";
import { changeLanguage, type SupportedLang } from "@/src/i18n";
import {
  exportEverything,
  exportProducts,
  exportPurchases,
  exportSales,
  getLastBackupTime,
} from "@/src/lib/backup/export";
import { fetchStoreTimezone, updateStoreTimezone } from "@/src/lib/reports/queries";
import { DEFAULT_STORE_TIMEZONE } from "@/src/lib/reports/ranges";

const LANGUAGES: { code: SupportedLang; labelKey: "languageFr" | "languageEn" | "languageAr" }[] = [
  { code: "fr", labelKey: "languageFr" },
  { code: "en", labelKey: "languageEn" },
  { code: "ar", labelKey: "languageAr" },
];

// A short, curated list rather than free text: an invalid IANA name would
// silently break every report's day/hour boundaries with no clear error.
const STORE_TIMEZONES = ["Africa/Casablanca", "Europe/Paris", "UTC"];

export default function Settings() {
  const { profile, session } = useAuth();
  const signOut = useSignOut();
  const { t, i18n } = useTranslation();
  const isOwner = profile?.role === "owner";
  const [showBackupReminder, setShowBackupReminder] = useState(false);

  useEffect(() => {
    getLastBackupTime().then((last) => {
      if (!last || Date.now() - last.getTime() > 24 * 60 * 60 * 1000) {
        setShowBackupReminder(true);
      }
    });
  }, []);

  const handleLanguageChange = async (lang: SupportedLang) => {
    const needsRestart = await changeLanguage(lang);
    if (needsRestart && Platform.OS !== "web") {
      Alert.alert(t("settings.language"), t("settings.restartRequired"));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("settings.title")}</Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("settings.account")}</Text>
        <Text style={styles.value}>{session?.user.email}</Text>
        <Text style={styles.value}>
          {profile?.full_name} · {profile?.role}
        </Text>
        <BigButton label={t("settings.signOut")} variant="danger" onPress={signOut} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("settings.language")}</Text>
        <View style={styles.langRow}>
          {LANGUAGES.map(({ code, labelKey }) => (
            <Pressable
              key={code}
              style={[styles.langButton, i18n.language === code && styles.langButtonActive]}
              onPress={() => handleLanguageChange(code)}
            >
              <Text style={[styles.langText, i18n.language === code && styles.langTextActive]}>
                {t(`settings.${labelKey}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {isOwner && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t("settings.backupExport")}</Text>
          {showBackupReminder && (
            <View style={styles.reminderBanner}>
              <Text style={styles.reminderText}>{t("settings.backupReminder")}</Text>
            </View>
          )}
          <ExportButtons onDone={() => setShowBackupReminder(false)} />
        </View>
      )}

      {isOwner && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t("settings.storeTimezone")}</Text>
          <Text style={styles.hint}>{t("settings.storeTimezoneHint")}</Text>
          <StoreTimezonePicker />
        </View>
      )}

      {isOwner && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t("settings.inviteCashier")}</Text>
          <InviteCashierForm />
        </View>
      )}
    </ScrollView>
  );
}

function StoreTimezonePicker() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStoreTimezone()
      .then(setCurrent)
      .catch(() => setCurrent(DEFAULT_STORE_TIMEZONE));
  }, []);

  const handleSelect = async (tz: string) => {
    const previous = current;
    setCurrent(tz);
    setSaving(true);
    setError(null);
    try {
      await updateStoreTimezone(tz);
    } catch (e) {
      setCurrent(previous);
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  if (current === null) return <Text style={styles.hint}>{t("common.loading")}</Text>;

  return (
    <View style={styles.langRow}>
      {STORE_TIMEZONES.map((tz) => (
        <Pressable
          key={tz}
          style={[styles.langButton, current === tz && styles.langButtonActive]}
          disabled={saving}
          onPress={() => handleSelect(tz)}
        >
          <Text style={[styles.langText, current === tz && styles.langTextActive]}>{tz}</Text>
        </Pressable>
      ))}
      {error && <Text style={styles.exportError}>{error}</Text>}
    </View>
  );
}

function ExportButtons({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(t("settings.exporting"));
    setError(null);
    try {
      await fn();
      setMessage(t("settings.exportDone"));
      onDone();
    } catch (e) {
      setMessage(null);
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.exportButtons}>
      {message ? <Text style={styles.exportMessage}>{message}</Text> : null}
      {error ? <Text style={styles.exportError}>{error}</Text> : null}
      <BigButton
        label={t("settings.exportAll")}
        onPress={() => run(exportEverything)}
        disabled={busy}
      />
      <SmallExportButton
        label={t("settings.exportProducts")}
        onPress={() => run(exportProducts)}
        disabled={busy}
      />
      <SmallExportButton
        label={t("settings.exportSales")}
        onPress={() => run(exportSales)}
        disabled={busy}
      />
      <SmallExportButton
        label={t("settings.exportPurchases")}
        onPress={() => run(exportPurchases)}
        disabled={busy}
      />
    </View>
  );
}

function SmallExportButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      style={[styles.smallButton, disabled && styles.smallButtonDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.smallButtonText}>{label}</Text>
    </Pressable>
  );
}

function InviteCashierForm() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInvite = async () => {
    setError(null);
    setMessage(null);
    setSubmitting(true);

    const { data, error: invokeError } = await supabase.functions.invoke("invite-cashier", {
      body: { email: email.trim(), full_name: fullName.trim() },
    });

    setSubmitting(false);

    if (invokeError) {
      setError(invokeError.message);
      return;
    }
    if (data?.error) {
      setError(data.error);
      return;
    }

    setMessage(t("settings.inviteSent", { email: email.trim() }));
    setEmail("");
    setFullName("");
  };

  return (
    <View style={styles.inviteForm}>
      <TextInput
        style={styles.input}
        placeholder={t("settings.fullName")}
        value={fullName}
        onChangeText={setFullName}
      />
      <TextInput
        style={styles.input}
        placeholder={t("settings.email")}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}
      <BigButton
        label={submitting ? t("settings.sending") : t("settings.sendInvite")}
        onPress={handleInvite}
        disabled={submitting || !email || !fullName}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 24 },
  title: { fontSize: 24, fontWeight: "700" },
  section: { gap: 10 },
  sectionLabel: { fontSize: 14, fontWeight: "600", color: "#555", textTransform: "uppercase" },
  value: { fontSize: 16 },
  hint: { fontSize: 13, color: "#777", lineHeight: 18 },
  langRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  langButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ccc",
    backgroundColor: "#f5f5f5",
  },
  langButtonActive: { backgroundColor: "#1d7a46", borderColor: "#1d7a46" },
  langText: { fontSize: 14, color: "#333" },
  langTextActive: { color: "#fff", fontWeight: "700" },
  reminderBanner: {
    backgroundColor: "#fff8e1",
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#f9a825",
  },
  reminderText: { color: "#7a5c00", fontSize: 14 },
  exportButtons: { gap: 10 },
  exportMessage: { color: "#1d7a46", fontSize: 14 },
  exportError: { color: "#b3261e", fontSize: 14 },
  smallButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: "#eee",
    alignItems: "center",
  },
  smallButtonDisabled: { opacity: 0.5 },
  smallButtonText: { fontSize: 15, color: "#333", fontWeight: "600" },
  inviteForm: { gap: 10 },
  input: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 16,
    fontSize: 16,
  },
  error: { color: "#b3261e" },
  success: { color: "#1d7a46" },
});
