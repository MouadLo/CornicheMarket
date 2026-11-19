import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import {
  CAMERA_CONSTRAINTS,
  classifyCameraError,
  createCameraController,
  type CameraErrorKind,
} from "@/src/lib/scanner/cameraSession";
import { readScanEnv } from "@/src/lib/scanner/scanMode";
import { createFrameDecoder } from "@/src/lib/scanner/webDecoder";
import { createScanFilter } from "@/src/lib/scanner/webScanRules";
import { Text } from "@/src/theme/Text";
import { colors, radius } from "@/src/theme/tokens";

import type { CameraBarcodeViewProps } from "./CameraBarcodeView";

// Decode a few times a second, not every frame: the phone stays responsive.
const DECODE_INTERVAL_MS = 150;

const ERROR_KEYS: Record<CameraErrorKind, string> = {
  denied: "barcodeScanner.webDenied",
  notFound: "barcodeScanner.webNotFound",
  inUse: "barcodeScanner.webInUse",
  insecure: "barcodeScanner.webInsecure",
  generic: "barcodeScanner.webGeneric",
};

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden"
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

// Browser camera: a real <video> fed by getUserMedia, decoded with the
// browser's BarcodeDetector or, failing that, zxing (loaded on demand).
export function CameraBarcodeView({ onBarcode, onClose, children }: CameraBarcodeViewProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handler = useRef(onBarcode);
  const [error, setError] = useState<CameraErrorKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pageVisible = usePageVisible();

  useEffect(() => {
    handler.current = onBarcode;
  }, [onBarcode]);

  useEffect(() => {
    // Hidden page: the camera is released and restarts when it is visible.
    if (!pageVisible) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const video = videoRef.current;
    const filter = createScanFilter();
    const controller = createCameraController(() =>
      navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
    );
    setError(null);

    const run = async () => {
      const env = readScanEnv();
      try {
        if (!env.secureContext || !env.hasGetUserMedia) throw new Error("unavailable");
        const [stream, decoder] = await Promise.all([controller.start(), createFrameDecoder()]);
        if (dead || !stream || !video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});

        const tick = async () => {
          if (dead) return;
          try {
            if (video.readyState >= 2) {
              const accepted = filter.push(await decoder.decode(video), Date.now());
              if (accepted && !dead) handler.current(accepted);
            }
          } catch {
            // one bad frame is not an error
          }
          if (!dead) timer = setTimeout(tick, DECODE_INTERVAL_MS);
        };
        tick();
      } catch (e) {
        // The stream may already be live if only the decoder failed to load.
        controller.stop();
        if (!dead) setError(classifyCameraError(e, env));
      }
    };
    run();

    return () => {
      dead = true;
      if (timer !== null) clearTimeout(timer);
      controller.stop();
      if (video) video.srcObject = null;
    };
  }, [pageVisible, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <View style={StyleSheet.absoluteFill}>
      {createElement("video", {
        ref: videoRef,
        playsInline: true,
        muted: true,
        autoPlay: true,
        style: { width: "100%", height: "100%", objectFit: "cover", backgroundColor: colors.black },
      })}
      {error ? (
        <View style={styles.errorPanel}>
          <Text style={styles.message}>{t(ERROR_KEYS[error])}</Text>
          {error !== "insecure" && (
            <BigButton label={t("barcodeScanner.tryAgain")} onPress={retry} />
          )}
          <BigButton label={t("barcodeScanner.close")} variant="secondary" onPress={onClose} />
        </View>
      ) : (
        <View style={styles.aimWrap} pointerEvents="none">
          <View style={styles.aim} />
        </View>
      )}
      {!error && children}
    </View>
  );
}

const styles = StyleSheet.create({
  aimWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  aim: {
    width: "78%",
    maxWidth: 420,
    aspectRatio: 1.7,
    borderWidth: 3,
    borderColor: colors.white,
    borderRadius: radius.control,
    backgroundColor: "transparent",
  },
  errorPanel: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.black,
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  message: { color: colors.white, fontSize: 16, textAlign: "center", marginBottom: 12 },
});
