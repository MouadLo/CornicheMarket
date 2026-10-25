import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { BigButton } from "@/src/components/BigButton";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { supabase } from "@/src/lib/supabase/client";

// Reached via the link in the invite email. On web, Supabase sets a
// session from the URL before this screen mounts (see detectSessionInUrl
// in src/lib/supabase/client.ts); the cashier just has to pick a password.
export default function AcceptInvite() {
  const { session } = useAuth();
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

  if (!session) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>
          This invite link has expired or was already used. Ask the owner to send a new one.
        </Text>
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Password set. You can now sign in.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Corniche Market</Text>
      <Text style={styles.subtitle}>Choose a password for {session.user.email}</Text>

      <TextInput
        style={styles.input}
        placeholder="New password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.buttonWrap}>
        <BigButton
          label={submitting ? "Saving..." : "Set password"}
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
