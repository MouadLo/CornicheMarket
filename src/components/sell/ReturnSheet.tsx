import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { VoidReasonPicker } from "@/src/components/sell/VoidReasonPicker";
import { Chip } from "@/src/components/ui/Chip";
import { Icon } from "@/src/components/ui/Icon";
import { formatMAD, parseQuantity } from "@/src/lib/money";
import { unitLabel } from "@/src/lib/products/unitLabel";
import { paymentMethodKey } from "@/src/lib/sales/paymentMethod";
import type { SaleLine } from "@/src/lib/sales/queries";
import {
  RETURN_REASONS,
  defaultRefundMethod,
  parseReturnQuantity,
  refundForQuantityCents,
  refundMethodKey,
  refundMethodsFor,
  remainingQuantity,
  returnReasonKey,
  returnReasonValid,
  summarizeReturn,
  type RefundMethod,
  type ReturnableLine,
  type ReturnReason,
  type ReturnSummary,
  type SalePaymentMethod,
} from "@/src/lib/sales/returns";
import { isolateBidi, isolateLtr } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, spacing, touch } from "@/src/theme/tokens";

export type ReturnSubmission = {
  summary: ReturnSummary;
  reason: ReturnReason;
  note: string;
  method: RefundMethod;
};

// The owner hands back some items of a sale: pick the lines and quantities,
// say why, choose how the money goes back. The refund shown is the server's own
// arithmetic (paid share per line, last unit takes the remainder); the database
// recomputes it and is the authority. Weighed products take decimal kilos, up
// to what remains.
export function ReturnSheet({
  visible,
  paymentMethod,
  lines,
  returnable,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  paymentMethod: SalePaymentMethod;
  lines: SaleLine[];
  returnable: ReturnableLine[];
  saving: boolean;
  error: string | null;
  onSubmit: (submission: ReturnSubmission) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // What is typed per line (text, so "0." survives while typing).
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<RefundMethod>(defaultRefundMethod(paymentMethod));

  // Only the lines that still have something to hand back.
  const rows = useMemo(
    () =>
      lines
        .map((line) => ({ line, info: returnable.find((r) => r.saleItemId === line.id) }))
        .filter(
          (row): row is { line: SaleLine; info: ReturnableLine } =>
            !!row.info && remainingQuantity(row.info) > 0
        ),
    [lines, returnable]
  );

  const selection = useMemo(() => {
    const picked: Record<string, number> = {};
    for (const { info } of rows) {
      picked[info.saleItemId] = parseReturnQuantity(
        entries[info.saleItemId] ?? "",
        remainingQuantity(info)
      );
    }
    return picked;
  }, [rows, entries]);

  const summary = useMemo(
    () =>
      summarizeReturn(
        rows.map((row) => row.info),
        selection
      ),
    [rows, selection]
  );

  const methods = refundMethodsFor(paymentMethod);
  const valid = summary.items.length > 0 && returnReasonValid(reason, note);

  const setQuantity = (id: string, remaining: number, raw: string) => {
    // Capped as it is typed: never more than what remains.
    const typed = parseQuantity(raw);
    const text = typed !== null && typed > remaining ? String(remaining) : raw;
    setEntries((prev) => ({ ...prev, [id]: text }));
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        style={styles.scrim}
        onPress={onClose}
        accessibilityLabel={t("common.cancel")}
      />
      <View style={styles.sheet} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t("returns.title")}</Text>
          <Text style={styles.hint}>{t("returns.hint")}</Text>

          {rows.map(({ line, info }) => {
            const remaining = remainingQuantity(info);
            const weighed = line.unit === "kg";
            const quantity = selection[info.saleItemId] ?? 0;
            const refund = quantity > 0 ? refundForQuantityCents(info, quantity) : 0;
            const name = line.product_name ?? t("sell.historyUnknownProduct");
            return (
              <View key={line.id} style={styles.line}>
                <View style={styles.lineMain}>
                  <Text style={styles.lineName}>{isolateBidi(name)}</Text>
                  <Text style={styles.meta}>
                    {t("returns.remaining", {
                      quantity:
                        `${remaining} ${line.unit ? unitLabel(line.unit, remaining, t) : ""}`.trim(),
                    })}
                  </Text>
                  {quantity > 0 ? (
                    <Text style={styles.refundPreview}>
                      {t("returns.lineRefund", { amount: isolateLtr(formatMAD(refund)) })}
                    </Text>
                  ) : null}
                </View>
                {weighed ? (
                  <TextInput
                    style={styles.qtyInput}
                    value={entries[info.saleItemId] ?? ""}
                    onChangeText={(raw) => setQuantity(info.saleItemId, remaining, raw)}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    accessibilityLabel={t("returns.quantityFor", { name })}
                  />
                ) : (
                  <View style={styles.stepper}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("returns.less", { name })}
                      disabled={quantity <= 0}
                      style={[styles.stepButton, quantity <= 0 && styles.stepOff]}
                      onPress={() =>
                        setQuantity(info.saleItemId, remaining, String(Math.max(0, quantity - 1)))
                      }
                    >
                      <Icon name="minus" size={20} color={colors.ink900} />
                    </Pressable>
                    <Text style={styles.qty}>{quantity}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("returns.more", { name })}
                      disabled={quantity >= remaining}
                      style={[styles.stepButton, quantity >= remaining && styles.stepOff]}
                      onPress={() => setQuantity(info.saleItemId, remaining, String(quantity + 1))}
                    >
                      <Icon name="plus" size={20} color={colors.ink900} />
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}

          <Text style={styles.sectionTitle}>{t("returns.reasonTitle")}</Text>
          <VoidReasonPicker<ReturnReason>
            reason={reason}
            note={note}
            onReason={setReason}
            onNote={setNote}
            noteAlways
            reasons={RETURN_REASONS}
            labelKey={returnReasonKey}
          />

          <Text style={styles.sectionTitle}>{t("returns.methodTitle")}</Text>
          {paymentMethod === "credit" ? (
            <Text style={styles.hint}>{t("returns.creditHint")}</Text>
          ) : (
            <Text style={styles.hint}>
              {t("returns.methodHint", { method: t(paymentMethodKey(paymentMethod)) })}
            </Text>
          )}
          <View style={styles.methods}>
            {methods.map((code) => (
              <Chip
                key={code}
                label={t(refundMethodKey(code))}
                selected={method === code}
                onPress={() => setMethod(code)}
              />
            ))}
          </View>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t("returns.total")}</Text>
            <Text style={styles.totalValue}>{isolateLtr(formatMAD(summary.totalCents))}</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <BigButton
            label={saving ? t("returns.saving") : t("returns.confirm")}
            variant="danger"
            disabled={!valid || saving}
            onPress={() => reason && onSubmit({ summary, reason, note, method })}
          />
          <BigButton label={t("common.cancel")} variant="secondary" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    maxHeight: "90%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
  },
  content: { padding: spacing.s4, gap: spacing.s3 },
  title: { fontSize: 20, fontWeight: "700", color: colors.ink900 },
  hint: { fontSize: 15, color: colors.ink600 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.ink700, marginTop: spacing.s2 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s3,
    paddingVertical: spacing.s2,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  lineMain: { flex: 1, gap: 2 },
  lineName: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  meta: { fontSize: 15, color: colors.ink600 },
  refundPreview: { fontSize: 15, fontWeight: "600", color: colors.success700 },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.s2 },
  stepButton: {
    minWidth: touch.min,
    minHeight: touch.min,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepOff: { opacity: 0.35 },
  qty: { minWidth: 32, textAlign: "center", fontSize: 18, fontWeight: "700" },
  qtyInput: {
    minWidth: 96,
    minHeight: touch.min,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.s3,
    fontSize: 16,
    textAlign: "center",
  },
  methods: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s2 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing.s3,
    paddingTop: spacing.s2,
  },
  totalLabel: { fontSize: 16, fontWeight: "700", color: colors.ink900 },
  totalValue: { fontSize: 20, fontWeight: "800", color: colors.ink900 },
  error: { color: colors.danger700, fontSize: 15 },
});
