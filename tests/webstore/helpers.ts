import type { ReactTestInstance } from "react-test-renderer";

import type { LinkCandidate, WebCategory, WebProduct } from "../../src/lib/webstore/types";

export const appProduct = (over: Partial<LinkCandidate> = {}): LinkCandidate => ({
  id: "a1",
  name: "Coca Cola 33cl",
  selling_price_cents: 600,
  stock_quantity: 5,
  active: true,
  kind: "regular",
  ...over,
});

export const webProduct = (over: Partial<WebProduct> = {}): WebProduct => ({
  id: "p001",
  product_id: null,
  name: "Coca",
  name_fr: "Coca Cola",
  size: "33cl",
  category_id: "drinks",
  sub_code: null,
  popular: false,
  keywords: null,
  image_url: null,
  image_path: null,
  image_source: "url",
  price_cents: 550,
  stock_mode: "manual",
  manual_in_stock: true,
  published: true,
  sort: 0,
  app: null,
  ...over,
});

export const linkedProduct = (
  over: Partial<WebProduct> = {},
  app: Partial<LinkCandidate> = {}
): WebProduct => {
  const a = appProduct(app);
  return webProduct({ product_id: a.id, app: a, ...over });
};

export const manyProducts = (n: number, over: Partial<WebProduct> = {}): WebProduct[] =>
  Array.from({ length: n }, (_, i) =>
    webProduct({ id: `p${String(i + 1).padStart(3, "0")}`, name_fr: `Produit ${i + 1}`, ...over })
  );

export const categories: WebCategory[] = [
  {
    id: "drinks",
    name: "Drinks",
    name_fr: "Boissons",
    icon: "bag",
    sort: 0,
    subs: [{ code: "soda", name: "Soda", name_fr: "Sodas", sort: 0 }],
  },
  { id: "snacks", name: "Snacks", name_fr: "Snacks", icon: "bag", sort: 1, subs: [] },
];

// All the text of a subtree, in order.
export function textOf(node: ReactTestInstance): string {
  return node
    .findAll((n) => (n.type as unknown) === "Text" || typeof n.type === "string")
    .flatMap((n) => n.children.filter((c): c is string => typeof c === "string"))
    .join(" ");
}

const labelOf = (n: ReactTestInstance) => n.props.accessibilityLabel as string | undefined;

// The pressable (host or composite) that carries `label` as a label or as the
// text inside it.
export function findPressable(root: ReactTestInstance, label: string): ReactTestInstance {
  const matches = root.findAll(
    (n) =>
      typeof n.props.onPress === "function" && (labelOf(n) === label || textOf(n).includes(label))
  );
  if (matches.length === 0) throw new Error(`no pressable "${label}"`);
  // the innermost one
  return matches[matches.length - 1];
}

export const hasText = (root: ReactTestInstance, text: string) => textOf(root).includes(text);
