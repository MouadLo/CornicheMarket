import { useTranslation } from "react-i18next";

import { BigButton } from "../BigButton";
import { EmptyState } from "./EmptyState";

// "Impossible de charger les clients" + a plain sentence + Réessayer: the same
// pattern as the root auth guard, for any screen whose query failed. Never show
// error.message to the person (UI-REVIEW #4); pass `what` already translated.
export function LoadQueryError({ what, onRetry }: { what: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="alert"
      tone="bad"
      title={t("states.loadErrorTitle", { what })}
      message={t("states.loadErrorHint")}
      action={<BigButton label={t("common.retry")} onPress={onRetry} />}
    />
  );
}
