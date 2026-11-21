import { useTranslation } from "react-i18next";

import { StatusPill } from "@/src/components/ui/StatusPill";

// "Fidélité": this customer is a loyalty member. Not cost data: everyone sees it.
export function MemberBadge() {
  const { t } = useTranslation();
  return <StatusPill label={t("loyalty.memberBadge")} tone="brand" icon="star" />;
}
