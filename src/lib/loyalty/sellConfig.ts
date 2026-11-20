// What the counter needs to know about loyalty, kept on the device so it keeps
// working offline: the store's switch and rates, and the categories that earn
// nothing. Read once when the Sell screen opens (and again when the device
// comes back online); the last answer is used until then.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";

import { effectiveExcludedCategoryIds } from "@/src/lib/loyalty/basket";
import { fetchLoyaltyCategories, fetchLoyaltySettings } from "@/src/lib/loyalty/queries";
import type { LoyaltyRates } from "@/src/lib/loyalty/points";
import {
  DEFAULT_LOYALTY_SETTINGS,
  parseLoyaltySettings,
  ratesFromSettings,
  type LoyaltySettings,
} from "@/src/lib/loyalty/settings";

const KEY = "corniche.loyaltyConfig.v1";

export type LoyaltyConfig = {
  settings: LoyaltySettings;
  excludedCategoryIds: string[];
};

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  settings: DEFAULT_LOYALTY_SETTINGS,
  excludedCategoryIds: [],
};

// A usable config, or null (missing, malformed).
export function parseLoyaltyConfig(raw: unknown): LoyaltyConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const saved = raw as { settings?: Partial<LoyaltySettings>; excludedCategoryIds?: unknown };
  if (typeof saved.settings !== "object" || saved.settings === null) return null;
  const s = saved.settings;
  const settings = parseLoyaltySettings({
    loyalty_enabled: s.enabled,
    loyalty_cents_per_point: s.centsPerPoint,
    loyalty_point_value_cents: s.pointValueCents,
    loyalty_min_redeem_points: s.minRedeemPoints,
    loyalty_daily_review_points: s.dailyReviewPoints,
    loyalty_welcome_points: s.welcomePoints,
  });
  const ids = Array.isArray(saved.excludedCategoryIds)
    ? saved.excludedCategoryIds.filter((id): id is string => typeof id === "string")
    : [];
  return { settings, excludedCategoryIds: ids };
}

export async function loadCachedLoyaltyConfig(): Promise<LoyaltyConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? parseLoyaltyConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveCachedLoyaltyConfig(config: LoyaltyConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    /* Still applies this session; the next read tries again. */
  }
}

export type SellLoyaltyConfig = {
  enabled: boolean;
  settings: LoyaltySettings;
  rates: LoyaltyRates;
  excludedCategories: ReadonlySet<string>;
};

export function useLoyaltyConfig(online: boolean): SellLoyaltyConfig {
  const [config, setConfig] = useState<LoyaltyConfig>(DEFAULT_LOYALTY_CONFIG);

  useEffect(() => {
    let cancelled = false;
    void loadCachedLoyaltyConfig().then((cached) => {
      if (!cancelled && cached) setConfig(cached);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    Promise.resolve()
      .then(async () => {
        const settings = await fetchLoyaltySettings();
        // The exclusion list failing must not hide the switch and rates.
        let excluded: string[] | null = null;
        if (settings.enabled) {
          try {
            excluded = effectiveExcludedCategoryIds(await fetchLoyaltyCategories());
          } catch {
            excluded = null;
          }
        }
        return { settings, excluded };
      })
      .then(async ({ settings, excluded }) => {
        const previous = (await loadCachedLoyaltyConfig()) ?? DEFAULT_LOYALTY_CONFIG;
        const next: LoyaltyConfig = {
          settings,
          excludedCategoryIds: excluded ?? previous.excludedCategoryIds,
        };
        await saveCachedLoyaltyConfig(next);
        if (!cancelled) setConfig(next);
      })
      .catch(() => {
        /* Offline or not deployed yet: keep the last known configuration. */
      });
    return () => {
      cancelled = true;
    };
  }, [online]);

  return useMemo(
    () => ({
      enabled: config.settings.enabled,
      settings: config.settings,
      rates: ratesFromSettings(config.settings),
      excludedCategories: new Set(config.excludedCategoryIds),
    }),
    [config]
  );
}
