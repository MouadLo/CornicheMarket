import { Platform } from "react-native";

// The address customers' phones open: this app's own web origin. On the web it
// is the page's own; on a phone app there is none, so the build can name it
// (EXPO_PUBLIC_APP_URL). null = unknown: callers hide what needs a link.
export function appOrigin(): string | null {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  const configured = process.env.EXPO_PUBLIC_APP_URL;
  return configured ? configured.replace(/\/+$/, "") : null;
}
