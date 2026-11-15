import { useNetInfo } from "@react-native-community/netinfo";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Image, Platform, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { useAuth } from "@/src/lib/auth/AuthProvider";
import { createInvoiceDraft, extractInvoice, uploadInvoicePage } from "@/src/lib/stock/invoices";
import { Text } from "@/src/theme/Text";

export default function InvoiceCapture() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const network = useNetInfo();
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const [pages, setPages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const draftId = useRef<string>();
  const uploaded = useRef(new Set<number>());

  if (profile?.role !== "owner") return <Text>{t("stockIn.blockedText")}</Text>;

  async function pick(camera: boolean) {
    if (offline || locked || inFlight.current || pages.length >= 3) return;
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
    if (offline || inFlight.current || !pages.length) return;
    inFlight.current = true;
    setBusy(true);
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
        const bytes = Uint8Array.from(atob(jpeg.base64), (char) => char.charCodeAt(0));
        await uploadInvoicePage(id, i + 1, bytes.buffer);
        uploaded.current.add(i);
      }
      void extractInvoice(id).catch(() => undefined);
      router.replace({ pathname: "/(app)/stock-in/invoice/[id]", params: { id } });
    } catch {
      setError("invoices.uploadError");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text>{t("invoices.captureHelp")}</Text>
      {offline && <Text accessibilityRole="alert">{t("invoices.offline")}</Text>}
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
        disabled={offline || locked || busy || pages.length >= 3}
        onPress={() => pick(true)}
      />
      <BigButton
        variant="secondary"
        label={t("invoices.pickPhotos")}
        disabled={offline || locked || busy || pages.length >= 3}
        onPress={() => pick(false)}
      />
      {error && <Text accessibilityRole="alert">{t(error)}</Text>}
      <BigButton
        label={t(busy ? "invoices.uploading" : "invoices.extract")}
        disabled={offline || busy || pages.length === 0}
        onPress={scan}
      />
    </ScrollView>
  );
}
