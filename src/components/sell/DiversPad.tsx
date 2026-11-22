import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { formatMAD } from "@/src/lib/money";
import {
  DIVERS_NOTE_MAX,
  cleanDiversNote,
  diversAmountProblem,
  diversLimitFor,
  entryToCents,
  pressAmountKey,
} from "@/src/lib/sellGrid/divers";
import { isScannerBurst, keyFromKeyboardEvent, type WeightKey } from "@/src/lib/sales/weightEntry";
import { appDirection, isolateLtr } from "@/src/lib/text/bidi";
import { colors, radius } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

type Props = {
  // The cashier's maximum (store_settings.divers_max_cents).
  maxCents: number;
  // The owner has no maximum.
  isOwner: boolean;
  onConfirm: (amountCents: number, note: string | null) => void;
  onCancel: () => void;
};

const ROWS: WeightKey[][] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  [".", "0", "back"],
];

// The "Montant libre" pad: an amount in DH and an optional short note, quantity
// always 1. Mount it only while it is open, so each opening starts empty.
export function DiversPad({ maxCents, isOwner, onConfirm, onCancel }: Props) {
  const { t, i18n } = useTranslation();
  const rtl = appDirection(i18n?.language ?? "") === "rtl";
  const [entry, setEntry] = useState("");
  const [note, setNote] = useState("");

  const limit = diversLimitFor(isOwner, maxCents);
  const cents = entryToCents(entry);
  const problem = diversAmountProblem(cents, limit);

  // The listener is registered once; it reads the latest values through refs.
  const latest = useRef({ cents, problem, note, onConfirm, onCancel });
  latest.current = { cents, problem, note, onConfirm, onCancel };

  const confirm = () => {
    const { cents: amount, problem: current, note: text } = latest.current;
    if (amount !== null && current === null) {
      latest.current.onConfirm(amount, cleanDiversNote(text));
    }
  };

  // Physical keyboard on web: digits, decimal point, Backspace, Enter, Escape.
  // Keys typed in the note field belong to the note, never to the amount.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    let previousAt: number | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          latest.current.onCancel();
        }
        return;
      }
      const key = keyFromKeyboardEvent(event.key);
      if (key === null) return;

      const at = event.timeStamp;
      const scanned = key !== "back" && (event.repeat || isScannerBurst(previousAt, at));
      previousAt = at;
      event.preventDefault();
      event.stopPropagation();
      if (scanned) return;

      if (key === "escape") latest.current.onCancel();
      else if (key === "enter") confirm();
      else setEntry((current) => pressAmountKey(current, key));
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>{t("sell.diversPadTitle")}</Text>
          {limit !== null ? (
            <Text style={[styles.hint, problem === "over" && styles.hintOver]} testID="divers-max">
              {problem === "over"
                ? t("sell.diversOver", { amount: isolateLtr(formatMAD(limit)) })
                : t("sell.diversMax", { amount: isolateLtr(formatMAD(limit)) })}
            </Text>
          ) : null}

          <View style={[styles.display, rtl && styles.displayRtl]}>
            <Text
              style={styles.entry}
              testID="divers-entry"
              accessibilityLabel={t("sell.diversAmountLabel")}
            >
              {isolateLtr(entry === "" ? "0" : entry)}
            </Text>
            <Text style={styles.unit}>DH</Text>
          </View>

          {ROWS.map((row) => (
            <View key={row.join("")} style={styles.row}>
              {row.map((key) => (
                <Pressable
                  key={key}
                  testID={`divers-key-${key}`}
                  accessibilityRole="button"
                  accessibilityLabel={key === "back" ? t("common.back") : key}
                  style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
                  onPress={() => setEntry((current) => pressAmountKey(current, key))}
                >
                  <Text style={styles.keyText}>{key === "back" ? "⌫" : key}</Text>
                </Pressable>
              ))}
            </View>
          ))}

          <Text style={styles.noteLabel}>{t("sell.diversNoteLabel")}</Text>
          <TextInput
            style={[styles.note, rtl && styles.noteRtl]}
            testID="divers-note"
            value={note}
            onChangeText={(value) => setNote(value.slice(0, DIVERS_NOTE_MAX))}
            maxLength={DIVERS_NOTE_MAX}
            placeholder={t("sell.diversNotePlaceholder")}
            placeholderTextColor={colors.ink600}
            accessibilityLabel={t("sell.diversNoteLabel")}
            returnKeyType="done"
          />

          <View style={styles.actions}>
            <View style={styles.flex}>
              <BigButton label={t("common.cancel")} variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.flex}>
              <BigButton label={t("common.add")} disabled={problem !== null} onPress={confirm} />
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "92%",
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  sheetContent: { padding: 20, gap: 10 },
  title: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  hint: { fontSize: 15, color: colors.ink600, textAlign: "center" },
  hintOver: { color: colors.danger600, fontWeight: "600" },
  display: { flexDirection: "row", justifyContent: "center", alignItems: "baseline", gap: 8 },
  // An amount always reads left to right, even on an Arabic screen.
  displayRtl: { flexDirection: "row-reverse" },
  entry: { fontSize: 44, fontWeight: "800" },
  unit: { fontSize: 20, fontWeight: "600", color: colors.ink600 },
  row: { flexDirection: "row", gap: 10 },
  key: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.control,
    backgroundColor: colors.brand100,
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: { backgroundColor: colors.brand100 },
  keyText: { fontSize: 26, fontWeight: "700", color: colors.ink900 },
  noteLabel: { fontSize: 15, color: colors.ink600, marginTop: 4 },
  note: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.ink400,
    paddingHorizontal: 12,
    fontSize: 17,
  },
  noteRtl: { textAlign: "right" },
  actions: { flexDirection: "row", gap: 10, marginTop: 6 },
  flex: { flex: 1 },
});
