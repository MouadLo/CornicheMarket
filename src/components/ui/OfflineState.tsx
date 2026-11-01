import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Banner } from "./Banner";
import { EmptyState } from "./EmptyState";

// Selling keeps working offline: show a banner with the age of the prices.
export function OfflineBanner({ priceTime }: { priceTime?: string }) {
  const { t } = useTranslation();
  return (
    <Banner
      tone="warn"
      icon="wifiOff"
      text={priceTime ? t("states.offlinePrices", { time: priceTime }) : t("states.offlineTitle")}
    />
  );
}

// A job that cannot run offline (saving a delivery): say what is needed and
// that the entry is safe on the device.
export function OfflineRequired({ action, children }: { action: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="wifiOff"
      tone="warn"
      title={t("states.offlineTitle")}
      message={t("states.offlineNeeded", { action })}
      action={children}
    />
  );
}
