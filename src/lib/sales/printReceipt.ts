import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

// Printing and sharing a receipt. Nothing here touches the sale: callers show
// a failure next to the buttons and leave everything else alone.

const LOAD_TIMEOUT_MS = 10000;
const CLEANUP_TIMEOUT_MS = 60000;

// Web: the receipt is printed from a hidden iframe (no popup to be blocked),
// which is removed once printing is done.
function printInIframe(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      frame.remove();
    };
    const loadTimer = setTimeout(() => {
      remove();
      reject(new Error("receipt frame did not load"));
    }, LOAD_TIMEOUT_MS);
    frame.onload = () => {
      clearTimeout(loadTimer);
      const view = frame.contentWindow;
      if (!view) {
        remove();
        reject(new Error("receipt frame unavailable"));
        return;
      }
      try {
        view.addEventListener("afterprint", remove);
        view.focus();
        view.print();
        // Some browsers never fire afterprint.
        setTimeout(remove, CLEANUP_TIMEOUT_MS);
        resolve();
      } catch (error) {
        remove();
        reject(error instanceof Error ? error : new Error("print failed"));
      }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

// iPhone and iPad browsers print the whole page instead of the hidden frame, so
// they offer Share only. iPadOS reports itself as a Mac with a touch screen.
export function canPrintReceipt(): boolean {
  if (Platform.OS !== "web") return true;
  if (typeof navigator === "undefined") return false;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return !ios;
}

export async function printReceipt(html: string): Promise<void> {
  if (Platform.OS === "web") {
    await printInIframe(html);
    return;
  }
  await Print.printAsync({ html });
}

// Web shares plain text through navigator.share when the browser has it;
// native shares a PDF file through the system share sheet.
export async function canShareReceipt(): Promise<boolean> {
  if (Platform.OS === "web") {
    return typeof navigator !== "undefined" && typeof navigator.share === "function";
  }
  try {
    return await Sharing.isAvailableAsync();
  } catch {
    return false;
  }
}

function isCancel(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

// "cancelled" is the person closing the share sheet: not a failure.
export async function shareReceipt(input: {
  html: string;
  text: string;
  title: string;
}): Promise<"shared" | "cancelled"> {
  if (Platform.OS === "web") {
    try {
      await navigator.share({ title: input.title, text: input.text });
      return "shared";
    } catch (error) {
      if (isCancel(error)) return "cancelled";
      throw error;
    }
  }
  const { uri } = await Print.printToFileAsync({ html: input.html });
  try {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: input.title,
    });
    return "shared";
  } catch (error) {
    if (isCancel(error)) return "cancelled";
    throw error;
  }
}
