import { confirm } from "@/src/lib/dialog/store";

// Void sale, void delivery and stock-adjustment all move stock or money
// backward in one tap, so each asks first. This is the one gate they share:
// a message that states what is about to change, and a real yes/no the
// caller must await before writing.
//
// It used to be window.confirm on web and Alert.alert on native. Both are
// replaced by the same in-app dialog (src/components/ui/DialogHost), so web
// and native look and behave alike, read correctly in RTL, and use the
// caller's translated button labels. Resolves false when dismissed, and when
// no host is mounted, so nothing is ever written without an explicit yes.
export function confirmDestructive(
  title: string,
  message: string,
  confirmLabel: string,
  cancelLabel: string
): Promise<boolean> {
  return confirm({ tone: "danger", title, message, confirmLabel, cancelLabel });
}
