import { useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { BrandMark } from "@/src/components/shell/BrandMark";
import { Icon } from "@/src/components/ui/Icon";
import { Field } from "@/src/components/ui/Field";
import { changeLanguage, type SupportedLang } from "@/src/i18n";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { Text } from "@/src/theme/Text";
import { colors, radius, touch } from "@/src/theme/tokens";

const LANGUAGES: { code: SupportedLang; labelKey: "languageFr" | "languageEn" | "languageAr" }[] = [
  { code: "fr", labelKey: "languageFr" },
  { code: "en", labelKey: "languageEn" },
  { code: "ar", labelKey: "languageAr" },
];

export default function SignIn() {
  const { signIn } = useAuth();
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const canSubmit = !submitting && !!email && !!password;

  const handleLanguage = async (lang: SupportedLang) => {
    const needsRestart = await changeLanguage(lang);
    if (needsRestart) Alert.alert(t("auth.language"), t("settings.restartRequired"));
  };

  const handleSignIn = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await signIn(email.trim(), password);
    setSubmitting(false);
    // Supabase's own message ("Invalid login credentials", a network
    // TypeError, ...) is in English regardless of the app's language.
    // Known cases get a translated message; anything else falls back to a
    // generic one rather than showing raw English/technical text.
    if (signInError) {
      setError(
        /invalid login credentials/i.test(signInError)
          ? t("auth.invalidCredentials")
          : t("auth.signInError")
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.brand}>
            <BrandMark size={56} />
            <Text style={styles.title} accessibilityRole="header">
              {t("auth.title")}
            </Text>
          </View>

          <Field
            label={t("auth.email")}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Field
            label={t("auth.password")}
            inputRef={passwordRef}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={handleSignIn}
            accessory={
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                hitSlop={8}
                style={styles.eye}
              >
                <Icon name={showPassword ? "eyeOff" : "eye"} size={22} color={colors.ink700} />
              </Pressable>
            }
          />

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <BigButton
            label={submitting ? t("auth.signingIn") : t("auth.signIn")}
            onPress={handleSignIn}
            disabled={!canSubmit}
          />

          <Text style={styles.help}>{t("auth.forgotPasswordHelp")}</Text>

          <View style={styles.langRow} accessibilityRole="radiogroup">
            {LANGUAGES.map(({ code, labelKey }) => {
              const active = i18n?.language === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => handleLanguage(code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[styles.lang, active && styles.langActive]}
                >
                  <Text style={[styles.langText, active && styles.langTextActive]}>
                    {t(`settings.${labelKey}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 16 },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    gap: 16,
  },
  brand: { alignItems: "center", gap: 12, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center", color: colors.ink900 },
  eye: {
    minWidth: touch.min - 8,
    minHeight: touch.min - 8,
    alignItems: "center",
    justifyContent: "center",
  },
  error: { color: colors.danger600, textAlign: "center", fontSize: 15 },
  help: { fontSize: 14, color: colors.ink600, textAlign: "center" },
  langRow: { flexDirection: "row", gap: 8, justifyContent: "center", flexWrap: "wrap" },
  lang: {
    minHeight: touch.min,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: radius.control,
    borderWidth: 1.5,
    borderColor: colors.ink400,
    backgroundColor: colors.surface,
  },
  langActive: { backgroundColor: colors.brand700, borderColor: colors.brand700 },
  langText: { fontSize: 15, color: colors.ink900 },
  langTextActive: { color: colors.white, fontWeight: "700" },
});
