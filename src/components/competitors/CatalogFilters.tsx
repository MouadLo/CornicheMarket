import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Chip } from "@/src/components/ui/Chip";
import type { ListFilters, MissingSort, ShopRow } from "@/src/lib/competitors/catalog";

const SORTS: { key: MissingSort; label: string }[] = [
  { key: "popularity", label: "competitors.catalog.sortPopularity" },
  { key: "price_asc", label: "competitors.catalog.sortPriceAsc" },
  { key: "price_desc", label: "competitors.catalog.sortPriceDesc" },
  { key: "newest", label: "competitors.catalog.sortNewest" },
];

// Filters of "Vous ne l'avez pas": shop, category (their names), in stock only,
// promo only, and the sort. Chips scroll sideways on a phone.
export function CatalogFilters({
  filters,
  shops,
  categories,
  onChange,
}: {
  filters: ListFilters;
  shops: ShopRow[];
  categories: string[];
  onChange: (next: ListFilters) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      {shops.length > 1 ? (
        <Row>
          <Chip
            label={t("competitors.catalog.allShops")}
            selected={filters.shopId === null}
            onPress={() => onChange({ ...filters, shopId: null, category: null })}
          />
          {shops.map((shop) => (
            <Chip
              key={shop.id}
              label={shop.name}
              selected={filters.shopId === shop.id}
              onPress={() => onChange({ ...filters, shopId: shop.id, category: null })}
            />
          ))}
        </Row>
      ) : null}
      {categories.length > 0 ? (
        <Row>
          <Chip
            label={t("competitors.catalog.allCategories")}
            selected={filters.category === null}
            onPress={() => onChange({ ...filters, category: null })}
          />
          {categories.map((category) => (
            <Chip
              key={category}
              label={category}
              selected={filters.category === category}
              onPress={() => onChange({ ...filters, category })}
            />
          ))}
        </Row>
      ) : null}
      <Row>
        <Chip
          label={t("competitors.catalog.filterInStock")}
          selected={filters.inStockOnly}
          onPress={() => onChange({ ...filters, inStockOnly: !filters.inStockOnly })}
        />
        <Chip
          label={t("competitors.catalog.filterPromo")}
          selected={filters.promoOnly}
          onPress={() => onChange({ ...filters, promoOnly: !filters.promoOnly })}
        />
      </Row>
      <Row>
        {SORTS.map((sort) => (
          <Chip
            key={sort.key}
            label={t(sort.label)}
            selected={filters.sort === sort.key}
            onPress={() => onChange({ ...filters, sort: sort.key })}
          />
        ))}
      </Row>
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingVertical: 8 },
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 12 },
});
