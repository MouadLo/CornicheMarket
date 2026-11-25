import { useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { ProductPhoto } from "@/src/components/products/ProductPhoto";
import { Card } from "@/src/components/ui/Card";
import { Segmented } from "@/src/components/ui/Segmented";
import { WebImage } from "@/src/components/webstore/WebImage";
import { confirmDestructive } from "@/src/lib/confirmDestructive";
import { showToast } from "@/src/lib/dialog/store";
import { pickProductPhoto } from "@/src/lib/products/photoPicker";
import {
  copyAppPhotoToWeb,
  removeWebImageFile,
  setImageSource,
  uploadWebImage,
} from "@/src/lib/webstore/imageQueries";
import {
  canUseSource,
  effectiveImage,
  fileImage,
  linkImage,
  webImageBase,
} from "@/src/lib/webstore/images";
import type { ImageSource, WebProduct } from "@/src/lib/webstore/types";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

const BIG = 160;
const SMALL = 64;

type Props = {
  product: WebProduct;
  // The linked app product's own photo path (null: not linked or no photo).
  appPhotoPath: string | null;
  // The product row changed (the screen keeps its copy in sync).
  onChange: (patch: Partial<Pick<WebProduct, "image_path" | "image_source">>) => void;
};

// One small picture of the available choices, tappable.
function Thumb({
  label,
  active,
  onPress,
  disabled,
  testID,
  children,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled: boolean;
  testID: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[styles.thumb, active && styles.thumbOn]}
      testID={testID}
    >
      {children}
      <Text style={[styles.thumbLabel, active && styles.thumbLabelOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// The photo block of a web product: what the site shows, which picture it
// shows (link / uploaded file), and the other pictures kept for later. Choosing
// never deletes; only "delete the uploaded photo" and uploading a new one touch
// the uploaded file. The app's own photo and the link are never changed.
export function WebPhotoSection({ product, appPhotoPath, onChange }: Props) {
  const { t } = useTranslation();
  const base = webImageBase();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [failedUri, setFailedUri] = useState<string | null>(null);

  const shown = effectiveImage(product, base);
  const link = linkImage(product);
  const file = fileImage(product, base);
  const source = product.image_source;
  const hasFile = canUseSource(product, "file");

  // One change at a time.
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const choose = (next: ImageSource) => {
    if (next === source || !canUseSource(product, next)) return;
    void run(async () => {
      onChange({ image_source: next });
      try {
        await setImageSource(product.id, next);
      } catch {
        onChange({ image_source: source });
        showToast({ text: t("webstore.photoSourceError"), tone: "info" });
      }
    });
  };

  const pick = (from: "camera" | "library") =>
    run(async () => {
      try {
        const picked = await pickProductPhoto(from);
        if (picked === "denied") {
          showToast({ text: t("webstore.photoCameraDenied"), tone: "info" });
          return;
        }
        if (!picked) return;
        const path = await uploadWebImage(product.id, picked.prepared);
        onChange({ image_path: path, image_source: "file" });
        showToast({ text: t("webstore.photoSaved"), tone: "success" });
      } catch {
        showToast({ text: t("webstore.photoError"), tone: "info" });
      }
    });

  const applyAppPhoto = async () => {
    if (!appPhotoPath || inFlight.current) return;
    if (product.image_path) {
      const ok = await confirmDestructive(
        t("webstore.photoReplaceTitle"),
        t("webstore.photoReplaceMessage"),
        t("webstore.photoReplace"),
        t("common.cancel")
      );
      if (!ok) return;
    }
    await run(async () => {
      try {
        const path = await copyAppPhotoToWeb(product.id, appPhotoPath);
        onChange({ image_path: path, image_source: "file" });
        showToast({ text: t("webstore.photoSaved"), tone: "success" });
      } catch {
        showToast({ text: t("webstore.photoError"), tone: "info" });
      }
    });
  };

  const remove = async () => {
    if (inFlight.current) return;
    const ok = await confirmDestructive(
      t("webstore.photoRemoveTitle"),
      t("webstore.photoRemoveMessage"),
      t("webstore.photoRemove"),
      t("common.cancel")
    );
    if (!ok) return;
    await run(async () => {
      try {
        await removeWebImageFile(product.id);
        onChange({ image_path: null, image_source: "url" });
        showToast({ text: t("webstore.photoRemoved"), tone: "success" });
      } catch {
        showToast({ text: t("webstore.photoError"), tone: "info" });
      }
    });
  };

  const thumbLabel = (key: string, active: boolean) =>
    active ? `${t(key)} · ${t("webstore.photoActive")}` : t(key);

  return (
    <Card title={t("webstore.photoTitle")} style={styles.card}>
      <View style={styles.center}>
        <WebImage uri={shown} size={BIG} onFail={() => setFailedUri(shown)} />
        {!shown ? (
          <Text style={styles.hint}>
            {source === "url" && !link ? t("webstore.photoNoLink") : t("webstore.photoNone")}
          </Text>
        ) : null}
        {shown && failedUri === shown ? (
          <Text style={styles.error}>{t("webstore.imageFail")}</Text>
        ) : null}
      </View>

      <Text style={styles.label}>{t("webstore.photoAddTitle")}</Text>
      <BigButton
        variant="secondary"
        label={t("webstore.photoTake")}
        onPress={() => void pick("camera")}
        disabled={busy}
      />
      <BigButton
        variant="secondary"
        label={t("webstore.photoChoose")}
        onPress={() => void pick("library")}
        disabled={busy}
      />
      {appPhotoPath ? (
        <View style={styles.appCard} testID="web-app-photo-card">
          <ProductPhoto path={appPhotoPath} size={SMALL} radius={radius.control} />
          <View style={styles.appText}>
            <Text style={styles.label}>{t("webstore.photoAppTitle")}</Text>
            <Text style={styles.hint}>{t("webstore.photoAppHint")}</Text>
            <BigButton
              variant="secondary"
              label={t("webstore.photoUseApp")}
              onPress={() => void applyAppPhoto()}
              disabled={busy}
            />
          </View>
        </View>
      ) : null}

      {hasFile ? (
        <>
          <Text style={styles.label}>{t("webstore.photoShownTitle")}</Text>
          <Segmented<ImageSource>
            value={source}
            onChange={choose}
            options={[
              { key: "url", label: t("webstore.photoSourceLink") },
              { key: "file", label: t("webstore.photoSourceFile") },
            ]}
          />
          <Text style={styles.hint}>{t("webstore.photoSourceHint")}</Text>
        </>
      ) : (
        <Text style={styles.hint}>{t("webstore.photoNoFileYet")}</Text>
      )}

      <View style={styles.thumbs}>
        {link ? (
          <Thumb
            label={thumbLabel("webstore.photoThumbLink", source === "url")}
            active={source === "url"}
            disabled={busy}
            onPress={() => choose("url")}
            testID="web-thumb-link"
          >
            <WebImage uri={link} size={SMALL} />
          </Thumb>
        ) : null}
        {file ? (
          <Thumb
            label={thumbLabel("webstore.photoThumbFile", source === "file")}
            active={source === "file"}
            disabled={busy}
            onPress={() => choose("file")}
            testID="web-thumb-file"
          >
            <WebImage uri={file} size={SMALL} />
          </Thumb>
        ) : null}
      </View>

      {hasFile ? (
        <BigButton
          variant="danger"
          label={t("webstore.photoRemove")}
          onPress={() => void remove()}
          disabled={busy}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  center: { alignItems: "center", gap: 6 },
  label: { fontSize: 14, fontWeight: "700", color: colors.ink700 },
  hint: { fontSize: 14, color: colors.ink600, lineHeight: 20 },
  error: { fontSize: 14, color: colors.danger700 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  thumb: {
    alignItems: "center",
    gap: 4,
    padding: 6,
    borderRadius: radius.control,
    borderWidth: 2,
    borderColor: "transparent",
  },
  thumbOn: { borderColor: colors.brand700 },
  thumbLabel: { fontSize: 13, color: colors.ink600, maxWidth: 96 },
  thumbLabelOn: { color: colors.brand700, fontWeight: "700" },
  appCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  appText: { flex: 1, gap: 2 },
});
