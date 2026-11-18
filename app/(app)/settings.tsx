import { useCallback, useEffect, useState } from "react";
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
import { Banner } from "@/src/components/ui/Banner";
import { InlineError } from "@/src/components/ui/InlineError";
import { inviteCashier } from "@/src/lib/auth/inviteCashier";
import { errorKeyOr } from "@/src/lib/errors/userMessage";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { useSignOut } from "@/src/lib/auth/useSignOut";
import { confirm } from "@/src/lib/dialog/store";
import { changeLanguage, type SupportedLang } from "@/src/i18n";
import {
  exportEverything,
  exportProducts,
  exportPurchases,
  exportSales,
  getLastBackupTime,
} from "@/src/lib/backup/export";
import { fetchStoreTimezone, updateStoreTimezone } from "@/src/lib/reports/queries";

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
          {profile?.full_name} ·{" "}
          {profile?.role === "owner"
            ? t("shell.roleOwner")
            : profile?.role === "cashier"
              ? t("shell.roleCashier")
              : profile?.role}
        </Text>
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

      <View style={styles.section}>
        <BigButton label={t("settings.signOut")} variant="secondary" onPress={signOut} />
      </View>
    </ScrollView>
  );
}

function StoreTimezonePicker() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Translation keys (see errorKey), never the server's text.
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // A failed read must not pretend the default zone is the saved one: it would
  // show a time zone nobody chose, next to buttons that move every report.
  const load = useCallback(() => {
    setLoadFailed(false);
    fetchStoreTimezone()
      .then(setCurrent)
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(load, [load]);

  const handleSelect = async (tz: string) => {
    const previous = current;
    if (tz === previous) return;
    // It moves the day boundaries of every report and of day close: ask first.
    const ok = await confirm({
      title: t("settings.timezoneConfirmTitle"),
      message: t("settings.timezoneConfirmMessage", { tz }),
      confirmLabel: t("settings.timezoneConfirmAction"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setCurrent(tz);
    setSaving(true);
    setError(null);
    try {
      await updateStoreTimezone(tz);
    } catch (e) {
      setCurrent(previous);
      setError(errorKeyOr(e, "errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <Banner
        tone="warn"
        text={t("settings.timezoneLoadError")}
        action={{ label: t("common.retry"), onPress: load }}
      />
    );
  }
  if (current === null) return <Text style={styles.hint}>{t("common.loading")}</Text>;

  return (
    <View style={styles.tzBox}>
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
      </View>
      {error ? <InlineError reasonKey={error} /> : null}
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
      setError(errorKeyOr(e, "errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.exportButtons}>
      {message ? <Text style={styles.exportMessage}>{message}</Text> : null}
      {error ? <InlineError reasonKey={error} /> : null}
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

    try {
      await inviteCashier(email.trim(), fullName.trim());
    } catch (failure) {
      setError(errorKeyOr(failure, "errors.generic"));
      return;
    } finally {
      setSubmitting(false);
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
      {error ? <InlineError reasonKey={error} /> : null}
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
  tzBox: { gap: 10 },
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
  success: { color: "#1d7a46" },
});
