import { useTranslation } from "react-i18next";

import { isNetworkKey } from "@/src/lib/errors/userMessage";
import { Banner } from "./Banner";

// The result of a failed action, rendered next to the button that failed (not
// at the top of a scrolling page). `reasonKey` comes from errorKey().
export function InlineError({ reasonKey }: { reasonKey: string }) {
  const { t } = useTranslation();
  const text = isNetworkKey(reasonKey)
    ? `${t(reasonKey)} ${t("errors.tryAgainOnline")}`
    : t(reasonKey);
  return <Banner tone="bad" text={text} />;
}
