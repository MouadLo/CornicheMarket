import { Platform } from "react-native";

// Which scan method a device gets. A phone or tablet scans with its camera; a
// desktop or laptop relies on a USB scanner, even if it has a webcam. USB
// (keyboard wedge) scanning stays active on every device regardless.
export type ScanEnv = {
  platform: string;
  // The primary pointer is a finger: (pointer: coarse).
  coarsePointer: boolean;
  hasGetUserMedia: boolean;
  // window.isSecureContext. Without it a browser hides getUserMedia entirely,
  // so on a phone the button is still shown and the scanner explains why.
  secureContext: boolean;
};

export function cameraScanAvailable(env: ScanEnv): boolean {
  if (env.platform !== "web") return true;
  return env.coarsePointer && (env.hasGetUserMedia || !env.secureContext);
}

export function readScanEnv(): ScanEnv {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return {
      platform: Platform.OS,
      coarsePointer: false,
      hasGetUserMedia: false,
      secureContext: true,
    };
  }
  return {
    platform: "web",
    coarsePointer: !!window.matchMedia?.("(pointer: coarse)").matches,
    hasGetUserMedia: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    secureContext: window.isSecureContext !== false,
  };
}

// Evaluated on the client; during static web rendering there is no window, so
// the button is simply absent until the first client render.
export function useCameraScanAvailable(): boolean {
  return cameraScanAvailable(readScanEnv());
}
