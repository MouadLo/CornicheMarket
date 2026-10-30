import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { formatMAD } from "@/src/lib/money";
import { lineSubtotal } from "@/src/lib/sales/totals";
import {
  entryToQuantity,
  isScannerBurst,
  keyFromKeyboardEvent,
  pressKey,
  type WeightKey,
} from "@/src/lib/sales/weightEntry";
import { isolateBidi } from "@/src/lib/text/bidi";

type Props = {
  productName: string;
  unitPriceCents: number;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
};

const ROWS: WeightKey[][] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  [".", "0", "back"],
];

// Opens whenever a weighed (kg) product is added, so the cashier enters the
// weight instead of the line silently defaulting to 1 kg. Mount it only while
// a product is waiting for a weight: each opening then starts empty.
export function WeightPad({ productName, unitPriceCents, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const [entry, setEntry] = useState("");
  const quantity = entryToQuantity(entry);

  // The listener is registered once; it reads the latest values through refs.
  const latest = useRef({ quantity, onConfirm, onCancel });
  latest.current = { quantity, onConfirm, onCancel };

  // Physical keyboard on web: digits, decimal point, Backspace, Enter, Escape.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    let previousAt: number | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = keyFromKeyboardEvent(event.key);
      if (key === null) return;

      const at = event.timeStamp;
      // Backspace is never part of a scan, and holding it should repeat fast.
      const scanned = key !== "back" && (event.repeat || isScannerBurst(previousAt, at));
      previousAt = at;
      // Claimed in the capture phase: a focused keypad button would otherwise
      // handle Enter itself first and press its own key.
      event.preventDefault();
      event.stopPropagation();
      if (scanned) return;

      if (key === "escape") latest.current.onCancel();
      else if (key === "enter") {
        if (latest.current.quantity !== null) latest.current.onConfirm(latest.current.quantity);
      } else setEntry((current) => pressKey(current, key));
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title} numberOfLines={1}>
            {isolateBidi(productName)}
          </Text>
          <Text style={styles.price}>{`${formatMAD(unitPriceCents)} / kg`}</Text>

          <View style={styles.display}>
            <Text style={styles.entry} testID="weight-entry">
              {entry === "" ? "0" : entry}
            </Text>
            <Text style={styles.unit}>kg</Text>
          </View>
          <Text style={styles.total} testID="weight-total">
            {quantity === null ? " " : formatMAD(lineSubtotal(quantity, unitPriceCents))}
          </Text>

          {ROWS.map((row) => (
            <View key={row.join("")} style={styles.row}>
              {row.map((key) => (
                <Pressable
                  key={key}
                  testID={`weight-key-${key}`}
                  accessibilityRole="button"
                  accessibilityLabel={key === "back" ? t("common.back") : key}
                  style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
                  onPress={() => setEntry((current) => pressKey(current, key))}
                >
                  <Text style={styles.keyText}>{key === "back" ? "⌫" : key}</Text>
                </Pressable>
              ))}
            </View>
          ))}

          <View style={styles.actions}>
            <View style={styles.flex}>
              <BigButton label={t("common.cancel")} variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.flex}>
              <BigButton
                label={t("common.add")}
                disabled={quantity === null}
                onPress={() => quantity !== null && onConfirm(quantity)}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 10,
    // Keeps the keypad a reasonable size on tablets/web instead of full width.
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  title: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  price: { fontSize: 14, color: "#666", textAlign: "center" },
  display: { flexDirection: "row", justifyContent: "center", alignItems: "baseline", gap: 8 },
  entry: { fontSize: 44, fontWeight: "800" },
  unit: { fontSize: 20, fontWeight: "600", color: "#666" },
  total: { fontSize: 20, fontWeight: "700", color: "#1d7a46", textAlign: "center", minHeight: 26 },
  row: { flexDirection: "row", gap: 10 },
  key: {
    flex: 1,
    minHeight: 64,
    borderRadius: 12,
    backgroundColor: "#eef3ef",
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: { backgroundColor: "#d9e6dd" },
  keyText: { fontSize: 26, fontWeight: "700", color: "#222" },
  actions: { flexDirection: "row", gap: 10, marginTop: 6 },
  flex: { flex: 1 },
});
