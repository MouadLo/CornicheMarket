import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { ProductSearchPicker } from "@/src/components/stock/ProductSearchPicker";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { formatMAD, lineTotalCents } from "@/src/lib/money";
import type { ProductUnit } from "@/src/lib/products/queries";
import { unitLabel } from "@/src/lib/products/unitLabel";
import {
  approveInvoiceDraft,
  approvalErrorKey,
  buildReviewedInvoiceLine,
  fetchInvoiceDraft,
  InvoiceApprovalError,
  type InvoiceDraft,
  type InvoiceReviewLine,
} from "@/src/lib/stock/invoices";
import { sampleInvoiceEnabled, sampleInvoiceId } from "@/src/lib/stock/sampleInvoice";
import { isolateBidi } from "@/src/lib/text/bidi";
import { Text } from "@/src/theme/Text";
import { colors, radius, touch } from "@/src/theme/tokens";

const units: ProductUnit[] = ["piece", "kg", "pack"];

export default function InvoiceScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  if (!sampleInvoiceEnabled || profile?.role !== "owner") {
    return <Text style={styles.container}>{t("invoices.unavailable")}</Text>;
  }
  return <SampleInvoice />;
}

function SampleInvoice() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetchInvoiceDraft(sampleInvoiceId).then(
      (next) => {
        if (active) setDraft(next);
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  if (!draft) {
    return (
      <View style={styles.container}>
        {failed ? (
          <>
            <Text accessibilityRole="alert">{t("invoices.loadError")}</Text>
            <BigButton
              label={t("invoices.retry")}
              onPress={() => {
                setFailed(false);
                setAttempt((value) => value + 1);
              }}
            />
          </>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }
  return <InvoiceReview draft={draft} />;
}

function InvoiceReview({ draft }: { draft: InvoiceDraft }) {
  const { t, i18n } = useTranslation();
  const [lines, setLines] = useState<InvoiceReviewLine[]>(() =>
    draft.source_lines.map((source) => ({
      product: null,
      quantity: source.quantity,
      unitCost: source.unit_cost,
    }))
  );
  const [purchaseId, setPurchaseId] = useState(draft.purchase_id);
  const [foundPostedPurchase, setFoundPostedPurchase] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingNow = useRef(false);

  const reviewed = lines.map(buildReviewedInvoiceLine);
  const validLines = reviewed.filter((line): line is NonNullable<typeof line> => line !== null);
  const ready = validLines.length > 0 && validLines.length === lines.length;
  const total = reviewed.reduce(
    (sum, line) => sum + (line ? lineTotalCents(line.quantity, line.unit_cost_cents) : 0),
    0
  );

  function updateLine(index: number, changes: Partial<InvoiceReviewLine>) {
    if (savingNow.current) return;
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...changes } : line))
    );
    setConfirmed(false);
    setError(null);
  }

  function chooseProduct(index: number, product: NonNullable<InvoiceReviewLine["product"]>) {
    const previousUnit = lines[index].product?.unit ?? draft.source_lines[index].unit;
    updateLine(
      index,
      product.unit === previousUnit
        ? { product }
        : {
            product,
            quantity: "",
            unitCost: "",
          }
    );
  }

  async function approve() {
    if (savingNow.current || !ready || !confirmed || purchaseId) return;
    savingNow.current = true;
    setSaving(true);
    setError(null);
    try {
      setPurchaseId(await approveInvoiceDraft(draft, validLines));
    } catch (caught) {
      // An interrupted response can hide a completed transaction.
      const latest = await fetchInvoiceDraft(draft.id).catch(() => null);
      if (latest?.purchase_id) {
        setFoundPostedPurchase(true);
        setPurchaseId(latest.purchase_id);
      } else {
        const code = caught instanceof InvoiceApprovalError ? caught.code : null;
        setError(t(approvalErrorKey(code, latest !== null && latest.revision !== draft.revision)));
      }
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={[styles.card, styles.source]}>
        <Text style={styles.heading}>{t("invoices.title")}</Text>
        <Text>
          {isolateBidi(draft.invoice_number)} · {isolateBidi(draft.suppliers?.name ?? "")}
        </Text>
        {draft.source_lines.map((line, index) => (
          <Text key={index}>
            {isolateBidi(line.description)} · {isolateBidi(line.billed)}
          </Text>
        ))}
      </View>
      {purchaseId ? (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.heading}>
            {t(foundPostedPurchase ? "invoices.alreadyApproved" : "invoices.approved")}
          </Text>
          <BigButton
            label={t("invoices.viewPurchase")}
            onPress={() =>
              router.push({
                pathname: "/(app)/stock-in/delivery/[id]",
                params: { id: purchaseId },
              })
            }
          />
        </>
      ) : (
        <>
          {lines.map((line, index) => {
            const product = line.product;
            const result = reviewed[index];
            const source = draft.source_lines[index];
            const name = product?.name ?? "";
            return (
              <View key={index} style={styles.card}>
                <Text style={styles.heading}>{isolateBidi(source.description)}</Text>
                {product ? (
                  <>
                    <Text>
                      {t(product.kind === "new" ? "invoices.newProduct" : "invoices.matched", {
                        name: isolateBidi(name),
                      })}
                    </Text>
                    <BigButton
                      variant="secondary"
                      label={t("invoices.changeProduct")}
                      disabled={saving}
                      onPress={() =>
                        updateLine(
                          index,
                          product.unit === source.unit
                            ? { product: null }
                            : {
                                product: null,
                                quantity: "",
                                unitCost: "",
                              }
                        )
                      }
                    />
                  </>
                ) : (
                  <>
                    <ProductSearchPicker
                      excludeIds={[]}
                      onPick={(picked) =>
                        chooseProduct(index, {
                          kind: "existing",
                          id: picked.id,
                          name: picked.name,
                          unit: picked.unit,
                        })
                      }
                    />
                    <BigButton
                      variant="secondary"
                      label={t("invoices.createProduct")}
                      disabled={saving}
                      onPress={() =>
                        chooseProduct(index, {
                          kind: "new",
                          name: source.description,
                          unit: source.unit,
                          sellingPrice: "",
                        })
                      }
                    />
                  </>
                )}
                {product?.kind === "new" && (
                  <>
                    <InvoiceInput
                      label={t("invoices.productName")}
                      value={product.name}
                      disabled={saving}
                      onChange={(name) => updateLine(index, { product: { ...product, name } })}
                    />
                    <Text>{t("invoices.stockUnit")}</Text>
                    <View style={styles.units}>
                      {units.map((unit) => (
                        <Pressable
                          key={unit}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: unit === product.unit, disabled: saving }}
                          disabled={saving}
                          style={[styles.unit, unit === product.unit && styles.selected]}
                          onPress={() => chooseProduct(index, { ...product, unit })}
                        >
                          <Text>{unitLabel(unit, 1, t)}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <InvoiceInput
                      decimal
                      label={t("invoices.sellingPrice")}
                      value={product.sellingPrice}
                      disabled={saving}
                      onChange={(sellingPrice) =>
                        updateLine(index, { product: { ...product, sellingPrice } })
                      }
                    />
                  </>
                )}
                <InvoiceInput
                  decimal
                  label={t("invoices.quantity", {
                    unit: product ? ` (${unitLabel(product.unit, 2, t)})` : "",
                  })}
                  value={line.quantity}
                  disabled={saving}
                  onChange={(quantity) => updateLine(index, { quantity })}
                />
                <InvoiceInput
                  decimal
                  label={t("invoices.unitCost")}
                  value={line.unitCost}
                  disabled={saving}
                  onChange={(unitCost) => updateLine(index, { unitCost })}
                />
                {result && (
                  <Text style={styles.delta}>
                    {t("invoices.delta", {
                      quantity: new Intl.NumberFormat(i18n.language).format(result.quantity),
                      unit: unitLabel(result.unit, result.quantity, t),
                      total: isolateBidi(
                        formatMAD(lineTotalCents(result.quantity, result.unit_cost_cents))
                      ),
                    })}
                  </Text>
                )}
              </View>
            );
          })}
          {ready ? (
            <>
              <Text style={styles.heading}>
                {t("invoices.total", { total: isolateBidi(formatMAD(total)) })}
              </Text>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: confirmed, disabled: saving }}
                disabled={saving}
                onPress={() => setConfirmed((value) => !value)}
                style={styles.check}
              >
                <Text style={styles.checkMark}>{confirmed ? "✓" : "○"}</Text>
                <Text style={styles.checkLabel}>{t("invoices.confirmReceived")}</Text>
              </Pressable>
            </>
          ) : (
            <Text>{t("invoices.incomplete")}</Text>
          )}
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <BigButton
            label={t(saving ? "invoices.saving" : "invoices.approve")}
            onPress={approve}
            disabled={!ready || !confirmed || saving}
          />
        </>
      )}
    </ScrollView>
  );
}

function InvoiceInput({
  label,
  value,
  onChange,
  disabled,
  decimal,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  decimal?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        keyboardType={decimal ? "decimal-pad" : "default"}
        maxLength={decimal ? 12 : 150}
        style={[styles.input, decimal && styles.number]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 48 },
  card: { padding: 16, gap: 12, backgroundColor: colors.surface, borderRadius: radius.panel },
  source: { backgroundColor: colors.brand100 },
  heading: { color: colors.ink900, fontSize: 18, fontWeight: "700" },
  field: { gap: 5 },
  input: {
    minHeight: touch.min,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.ink400,
    borderRadius: radius.control,
    color: colors.ink900,
    fontSize: 16,
  },
  number: { writingDirection: "ltr", textAlign: "left" },
  units: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  unit: {
    minHeight: touch.min,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.ink400,
    borderRadius: radius.control,
  },
  selected: { backgroundColor: colors.brand100, borderColor: colors.brand700 },
  delta: { color: colors.success700, fontWeight: "700" },
  check: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: touch.min },
  checkMark: { color: colors.brand700, fontSize: 22 },
  checkLabel: { flex: 1 },
  error: { color: colors.danger700 },
});
