import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect } from "react";
import { Dimensions, Platform } from "react-native";

// Android's own definition of a tablet: shortest side of at least 600 dp.
// Measured on the shortest side so it doesn't depend on how it's held.
const TABLET_MIN_SHORT_SIDE_DP = 600;

export function isTabletSize(width: number, height: number): boolean {
  return Math.min(width, height) >= TABLET_MIN_SHORT_SIDE_DP;
}

// The counter tablet is used in landscape (grid and cart side by side, see
// docs/SELL-GRID-DESIGN.md 2.7); the phone layouts are designed for
// portrait only, so a phone stays in portrait rather than rotating into a
// layout nobody designed.
export function orientationFor(width: number, height: number): "landscape" | "portrait" {
  return isTabletSize(width, height) ? "landscape" : "portrait";
}

// app.json no longer pins portrait (that locked the tablet out of landscape
// at the OS level), so the lock is applied here once the screen size is
// known. Native only: browsers can't lock orientation outside fullscreen.
export function useOrientationLock(): void {
  useEffect(() => {
    if (Platform.OS === "web") return;
    const { width, height } = Dimensions.get("window");
    const lock =
      orientationFor(width, height) === "landscape"
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT_UP;
    ScreenOrientation.lockAsync(lock).catch(() => {});
  }, []);
}
