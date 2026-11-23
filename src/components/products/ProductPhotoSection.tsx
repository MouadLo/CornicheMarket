import { useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { ProductPhoto } from "@/src/components/products/ProductPhoto";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { showToast } from "@/src/lib/dialog/store";
import { pickProductPhoto } from "@/src/lib/products/photoPicker";
import {
  clearProductPhoto,
  uploadProductPhoto,
  type PreparedPhoto,
} from "@/src/lib/products/photos";
import { colors, radius } from "@/src/theme/tokens";
import { Text } from "@/src/theme/Text";

const SIZE = 160;

type Props = {
  // Null on the new-product screen: the photo is only kept until the product
  // exists (the path needs its id), and the screen uploads it after saving.
  productId: string | null;
  initialPath?: string | null;
  // Only the owner changes photos; anyone else sees no buttons.
  canEdit: boolean;
  // New product: the picked photo (null again when removed).
  onPendingChange?: (photo: PreparedPhoto | null) => void;
  // Edit: the stored photo changed.
  onSaved?: (path: string | null) => void;
};

// The photo block at the top of the product form: the photo (or a placeholder)
// and its three actions.
export function ProductPhotoSection({
  productId,
  initialPath,
  canEdit,
  onPendingChange,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const [path, setPath] = useState<string | null>(initialPath ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const hasPhoto = !!preview || !!path;

  const pick = async (source: "camera" | "library") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const picked = await pickProductPhoto(source);
      if (picked === "denied") {
        showToast({ text: t("products.photo.cameraDenied"), tone: "info" });
        return;
      }
      if (!picked) return;
      if (productId) {
        const saved = await uploadProductPhoto(productId, picked.prepared);
        setPath(saved);
        setPreview(null);
        onSaved?.(saved);
        showToast({ text: t("products.photo.saved"), tone: "success" });
      } else {
        setPreview(picked.previewUri);
        onPendingChange?.(picked.prepared);
      }
    } catch {
      showToast({ text: t("products.photo.error"), tone: "info" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const remove = async () => {
    if (inFlight.current) return;
    const ok = await confirmDestructive(
      t("products.photo.removeTitle"),
      t("products.photo.removeMessage"),
      t("products.photo.remove"),
      t("common.cancel")
    );
    if (!ok) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (productId && path) {
        await clearProductPhoto(productId);
        onSaved?.(null);
        showToast({ text: t("products.photo.removed"), tone: "success" });
      }
      setPath(null);
      setPreview(null);
      onPendingChange?.(null);
    } catch {
      showToast({ text: t("products.photo.error"), tone: "info" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap} testID="product-photo-section">
      {preview ? (
        <Image
          source={{ uri: preview }}
          style={styles.big}
          resizeMode="cover"
          accessibilityLabel={t("products.photo.title")}
          testID="product-photo-preview"
        />
      ) : (
        <ProductPhoto
          path={path}
          size={SIZE}
          radius={radius.control}
          accessibilityLabel={t("products.photo.title")}
        />
      )}
      {!hasPhoto && !canEdit ? <Text style={styles.hint}>{t("products.photo.none")}</Text> : null}
      {canEdit ? (
        <View style={styles.actions}>
          <BigButton
            variant="secondary"
            label={t("products.photo.take")}
            onPress={() => void pick("camera")}
            disabled={busy}
          />
          <BigButton
            variant="secondary"
            label={t("products.photo.choose")}
            onPress={() => void pick("library")}
            disabled={busy}
          />
          {hasPhoto ? (
            <BigButton
              variant="secondary"
              label={t("products.photo.remove")}
              onPress={() => void remove()}
              disabled={busy}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 12, paddingBottom: 4 },
  big: { width: SIZE, height: SIZE, borderRadius: radius.control, backgroundColor: colors.sunken },
  hint: { fontSize: 14, color: colors.ink600 },
  actions: { alignSelf: "stretch", gap: 8 },
});
