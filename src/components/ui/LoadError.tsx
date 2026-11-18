import { useTranslation } from "react-i18next";

import { BigButton } from "../BigButton";
import { ERROR_KEYS, isNetworkKey } from "@/src/lib/errors/userMessage";
import { EmptyState } from "./EmptyState";

// A screen whose data could not be read. It replaces the list, so a failed
// request can never look like "no customers" or "0 products". `title` is the
// screen's own sentence ("Could not load products."); `reasonKey` is what
// errorKey() made of the thrown error. The server's text is never shown. A
// network failure also says that selling still works offline.
export function LoadError({
  title,
  reasonKey,
  onRetry,
}: {
  title: string;
  reasonKey: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const offline = isNetworkKey(reasonKey);
  const reason = reasonKey === ERROR_KEYS.generic ? t("states.loadErrorHint") : t(reasonKey);
  return (
    <EmptyState
      icon={offline ? "wifiOff" : "alert"}
      tone={offline ? "warn" : "bad"}
      title={title}
      message={offline ? `${reason} ${t("errors.offlineExplain")}` : reason}
      action={<BigButton label={t("common.retry")} onPress={onRetry} />}
    />
  );
}
