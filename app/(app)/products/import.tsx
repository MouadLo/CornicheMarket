import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { InlineError } from "@/src/components/ui/InlineError";
import { errorKeyOr } from "@/src/lib/errors/userMessage";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { pickTextFile } from "@/src/lib/files";
import { centsToDisplay, formatMAD } from "@/src/lib/money";
import {
  guessMapping,
  IMPORT_FIELDS,
  parseCsv,
  validateRows,
  type ColumnMapping,
  type RowError,
  type ValidationResult,
} from "@/src/lib/products/csv";
import {
  fetchExistingBarcodes,
  importProducts,
  type ImportResult,
} from "@/src/lib/products/import";
import { fetchCategories, type Category } from "@/src/lib/products/queries";
import { unitLabel } from "@/src/lib/products/unitLabel";

type Step = "pick" | "map" | "preview" | "done";

export default function ImportProducts() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isOwner = profile?.role === "owner";

  const [step, setStep] = useState<Step>("pick");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  // A translation key (see errorKeyOr): the server's own text never shows.
  const [error, setError] = useState<string | null>(null);
  const issueText = (rowError: RowError) =>
    rowError.issues.map((issue) => t(issue.key, issue.params)).join("; ");

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  if (profile && !isOwner) {
    return <Redirect href="/(app)/products" />;
  }

  const handlePick = async () => {
    setError(null);
    try {
      const file = await pickTextFile();
      if (!file) return;

      const { headers: parsedHeaders, rows } = parseCsv(file.text);
      if (parsedHeaders.length === 0 || rows.length === 0) {
        setError("products.importNoRows");
        return;
      }

      setFileName(file.name);
      setHeaders(parsedHeaders);
      setRawRows(rows);
      setMapping(guessMapping(parsedHeaders));
      setStep("map");
    } catch {
      setError("products.importReadError");
    }
  };

  const handleValidate = async () => {
    setBusy(true);
    setError(null);
    try {
      const existingBarcodes = await fetchExistingBarcodes();
      setValidation(validateRows(rawRows, mapping, { categories, existingBarcodes }));
      setStep("preview");
    } catch (validateError) {
      setError(errorKeyOr(validateError, "products.importValidationFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!validation || !profile) return;

    setBusy(true);
    setError(null);
    try {
      setResult(await importProducts(validation.rows, profile.id));
      setStep("done");
    } catch (importError) {
      setError(errorKeyOr(importError, "products.importFailed"));
    } finally {
      setBusy(false);
    }
  };

  const requiredMapped = IMPORT_FIELDS.filter((field) => field.required).every(
    (field) => mapping[field.key]
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {step === "pick" && (
        <>
          <Text style={styles.title}>{t("products.importTitle")}</Text>
          <Text style={styles.body}>{t("products.importPickBody")}</Text>
          {error ? <InlineError reasonKey={error} /> : null}
          <BigButton label={t("products.importChooseFile")} onPress={handlePick} />
        </>
      )}

      {step === "map" && (
        <>
          <Text style={styles.title}>{t("products.importMapTitle")}</Text>
          <Text style={styles.body}>
            {fileName} · {t("importCsv.rows", { count: rawRows.length })}
          </Text>

          {IMPORT_FIELDS.map((field) => (
            <View key={field.key} style={styles.field}>
              <Text style={styles.label}>
                {t(`importCsv.fields.${field.key}`)}
                {field.required ? " *" : ""}
              </Text>
              {field.hint && <Text style={styles.hint}>{t(`importCsv.hints.${field.key}`)}</Text>}
              <View style={styles.chips}>
                <Chip
                  label={t("products.importIgnore")}
                  selected={!mapping[field.key]}
                  onPress={() => setMapping((current) => ({ ...current, [field.key]: undefined }))}
                />
                {headers.map((header) => (
                  <Chip
                    key={header}
                    label={header}
                    selected={mapping[field.key] === header}
                    onPress={() => setMapping((current) => ({ ...current, [field.key]: header }))}
                  />
                ))}
              </View>
            </View>
          ))}

          {error ? <InlineError reasonKey={error} /> : null}
          <BigButton
            label={busy ? t("products.importChecking") : t("products.importPreview")}
            onPress={handleValidate}
            disabled={!requiredMapped || busy}
          />
          {!requiredMapped && <Text style={styles.hint}>{t("products.importRequiredHint")}</Text>}
        </>
      )}

      {step === "preview" && validation && (
        <>
          <Text style={styles.title}>{t("products.importPreviewTitle")}</Text>
          <Text style={styles.summary}>
            {t("products.importPreviewSummary", {
              ready: validation.rows.length,
              problems: validation.errors.length,
            })}
          </Text>

          {validation.rows.slice(0, 10).map((row) => (
            <View key={row.rowNumber} style={styles.previewRow}>
              <Text style={styles.previewName}>{row.product.name}</Text>
              <Text style={styles.previewMeta}>
                {centsToDisplay(row.product.selling_price_cents)} DH ·{" "}
                {row.product.barcode ?? t("products.importNoBarcode")} ·{" "}
                {unitLabel(row.product.unit, 1, t)}
                {row.opening
                  ? ` · ${t("importCsv.opening", {
                      quantity: row.opening.quantity,
                      cost: formatMAD(row.opening.unit_cost_cents),
                    })}`
                  : ""}
              </Text>
            </View>
          ))}
          {validation.rows.length > 10 && (
            <Text style={styles.hint}>
              {t("products.importAndMore", { count: validation.rows.length - 10 })}
            </Text>
          )}

          {validation.errors.length > 0 && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>{t("products.importSkippedTitle")}</Text>
              {validation.errors.slice(0, 20).map((rowError) => (
                <Text key={rowError.rowNumber} style={styles.errorLine}>
                  {t("products.importRowError", {
                    row: rowError.rowNumber,
                    messages: issueText(rowError),
                  })}
                </Text>
              ))}
              {validation.errors.length > 20 && (
                <Text style={styles.errorLine}>
                  {t("products.importAndMoreRows", { count: validation.errors.length - 20 })}
                </Text>
              )}
            </View>
          )}

          {error ? <InlineError reasonKey={error} /> : null}
          <BigButton
            label={
              busy
                ? t("products.importImporting")
                : t("products.importStart", { count: validation.rows.length })
            }
            onPress={handleImport}
            disabled={busy || validation.rows.length === 0}
          />
          <BigButton
            label={t("products.importBackToMapping")}
            variant="secondary"
            onPress={() => setStep("map")}
          />
        </>
      )}

      {step === "done" && result && (
        <>
          <Text style={styles.title}>{t("products.importFinishedTitle")}</Text>
          <Text style={styles.summary}>
            {result.openingLines > 0
              ? t("products.importFinishedOpening", {
                  count: result.inserted,
                  opening: result.openingLines,
                })
              : t("products.importFinishedSummary", { count: result.inserted })}
          </Text>

          {result.errors.length > 0 && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>{t("products.importProblemsTitle")}</Text>
              {result.errors.slice(0, 20).map((rowError, index) => (
                <Text key={`${rowError.rowNumber}-${index}`} style={styles.errorLine}>
                  {rowError.rowNumber > 0
                    ? t("products.importRowError", {
                        row: rowError.rowNumber,
                        messages: issueText(rowError),
                      })
                    : issueText(rowError)}
                </Text>
              ))}
            </View>
          )}

          <BigButton
            label={t("products.importBackToProducts")}
            onPress={() => router.replace("/(app)/products")}
          />
        </>
      )}
    </ScrollView>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selected }}
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: "700" },
  body: { fontSize: 15, color: "#555", lineHeight: 21 },
  summary: { fontSize: 16, fontWeight: "600" },
  field: { gap: 6 },
  label: { fontSize: 15, fontWeight: "600" },
  hint: { fontSize: 13, color: "#777" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, backgroundColor: "#eee" },
  chipSelected: { backgroundColor: "#1d7a46" },
  chipText: { fontSize: 14, color: "#333" },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  previewRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  previewName: { fontSize: 15, fontWeight: "600" },
  previewMeta: { fontSize: 13, color: "#666" },
  errorBox: { backgroundColor: "#fdecea", borderRadius: 10, padding: 12, gap: 4 },
  errorTitle: { fontWeight: "700", color: "#b3261e" },
  errorLine: { fontSize: 13, color: "#8c1d18" },
});
