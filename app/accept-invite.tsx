import { useState } from "react";
import { router } from "expo-router";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { supabase } from "@/src/lib/supabase/client";

// Reached via the link in the invite email. On web, Supabase sets a
// session from the URL before this screen mounts (see detectSessionInUrl
// in src/lib/supabase/client.ts); the cashier just has to pick a password.
export default function AcceptInvite() {
  const { t } = useTranslation();
  const { session, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSetPassword = async () => {
    setError(null);
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
    } else {
      setDone(true);
    }
  };

  // The invited user was signed in by the link only to set a password. Sign
  // them out first so the sign-in page does not bounce them straight into the
  // app on the invite session.
  const goToSignIn = async () => {
    try {
      await signOut();
    } catch {}
    router.replace("/sign-in");
  };

  if (done) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>{t("invite.done")}</Text>
        <View style={styles.buttonWrap}>
          <BigButton label={t("invite.goSignIn")} onPress={goToSignIn} />
        </View>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>{t("invite.expired")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("invite.welcome")}</Text>
      <Text style={styles.subtitle}>{t("invite.choose", { email: session.user.email })}</Text>

      <TextInput
        style={styles.input}
        placeholder={t("invite.newPassword")}
        accessibilityLabel={t("invite.newPassword")}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.buttonWrap}>
        <BigButton
          label={submitting ? t("invite.saving") : t("invite.setPassword")}
          onPress={handleSetPassword}
          disabled={submitting || password.length < 6}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 14, textAlign: "center", color: "#555", marginBottom: 12 },
  message: { fontSize: 16, textAlign: "center" },
  input: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 16,
    fontSize: 16,
  },
  error: { color: "#b3261e", textAlign: "center" },
  buttonWrap: { marginTop: 12 },
});
