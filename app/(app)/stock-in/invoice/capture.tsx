import { decode } from "base64-arraybuffer";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Image, Platform, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { useSaleSync } from "@/src/lib/sales/useSaleSync";
import {
  createInvoiceDraft,
  extractInvoice,
  InvoiceApprovalError,
  uploadInvoicePage,
} from "@/src/lib/stock/invoices";
import { Text } from "@/src/theme/Text";

export default function InvoiceCapture() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const { online } = useSaleSync();
  const [pages, setPages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [locked, setLocked] = useState(false);
  const [stage, setStage] = useState<"uploading" | "extracting" | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const draftId = useRef<string>();
  const uploaded = useRef(new Set<number>());
  const busy = stage !== null;

  if (profile?.role !== "owner") return <Text>{t("stockIn.blockedText")}</Text>;

  async function pick(camera: boolean) {
    if (locked || inFlight.current || pages.length >= 3) return;
    inFlight.current = true;
    setError("");
    try {
      if (
        camera &&
        Platform.OS !== "web" &&
        !(await ImagePicker.requestCameraPermissionsAsync()).granted
      ) {
        setError("invoices.cameraDenied");
        return;
      }
      const options = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({
            ...options,
            allowsMultipleSelection: true,
            selectionLimit: 3 - pages.length,
          });
      if (!result.canceled) setPages((current) => [...current, ...result.assets].slice(0, 3));
    } catch {
      setError("invoices.captureError");
    } finally {
      inFlight.current = false;
    }
  }

  async function scan() {
    if (inFlight.current || !pages.length) return;
    inFlight.current = true;
    setStage("uploading");
    setError("");
    try {
      draftId.current ??= await createInvoiceDraft();
      setLocked(true);
      const id = draftId.current;
      // Page 1 is the completion marker; interrupted uploads cannot be scanned early.
      for (let i = pages.length - 1; i >= 0; i--) {
        if (uploaded.current.has(i)) continue;
        const page = pages[i];
        const resize =
          Math.max(page.width, page.height) > 1600
            ? [{ resize: page.width >= page.height ? { width: 1600 } : { height: 1600 } }]
            : [];
        const jpeg = await manipulateAsync(page.uri, resize, {
          compress: 0.7,
          format: SaveFormat.JPEG,
          base64: true,
        });
        if (!jpeg.base64) throw new Error("Missing JPEG");
        await uploadInvoicePage(id, i + 1, decode(jpeg.base64));
        uploaded.current.add(i);
      }
    } catch {
      setError("invoices.uploadError");
      inFlight.current = false;
      setStage(null);
      return;
    }
    // The pages are safe on the server from here: a failed or refused reading
    // says so, and Retry reads the same draft again without re-uploading.
    const id = draftId.current;
    setStage("extracting");
    try {
      await extractInvoice(id);
      router.replace({ pathname: "/(app)/stock-in/invoice/[id]", params: { id } });
    } catch (caught) {
      setError(
        caught instanceof InvoiceApprovalError && caught.code === "429"
          ? "invoices.dailyLimit"
          : "invoices.extractError"
      );
    } finally {
      inFlight.current = false;
      setStage(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text>{t("invoices.captureHelp")}</Text>
      {!online && <Text accessibilityRole="alert">{t("invoices.offline")}</Text>}
      {pages.map((page, index) => (
        <View key={index} style={{ gap: 6 }}>
          <Image
            source={{ uri: page.uri }}
            style={{ width: 120, height: 120 }}
            resizeMode="contain"
            accessibilityLabel={t("invoices.photoPage", { page: index + 1, count: pages.length })}
          />
          {!locked && (
            <BigButton
              variant="secondary"
              label={t("invoices.removePage")}
              disabled={busy}
              onPress={() => setPages((current) => current.filter((_, i) => i !== index))}
            />
          )}
        </View>
      ))}
      <BigButton
        variant="secondary"
        label={t("invoices.takePhoto")}
        disabled={locked || busy || pages.length >= 3}
        onPress={() => pick(true)}
      />
      <BigButton
        variant="secondary"
        label={t("invoices.pickPhotos")}
        disabled={locked || busy || pages.length >= 3}
        onPress={() => pick(false)}
      />
      {error && <Text accessibilityRole="alert">{t(error)}</Text>}
      <BigButton
        label={t(
          stage === "uploading"
            ? "invoices.uploading"
            : stage === "extracting"
              ? "invoices.statusExtracting"
              : error === "invoices.uploadError" || error === "invoices.extractError"
                ? "invoices.retry"
                : "invoices.extract"
        )}
        disabled={busy || pages.length === 0 || error === "invoices.dailyLimit"}
        onPress={scan}
      />
      {!!draftId.current &&
        (error === "invoices.extractError" || error === "invoices.dailyLimit") && (
          <BigButton
            variant="secondary"
            label={t("invoices.openDraft")}
            onPress={() =>
              router.replace({
                pathname: "/(app)/stock-in/invoice/[id]",
                params: { id: draftId.current! },
              })
            }
          />
        )}
    </ScrollView>
  );
}
