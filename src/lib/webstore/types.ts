// Shapes of the webstore tables as the owner's screen reads them (migration 054).

export type StockMode = "manual" | "auto";

// The app product a web product is linked to. Owner only: it carries the real
// stock quantity.
export type LinkedAppProduct = {
  id: string;
  name: string;
  selling_price_cents: number;
  stock_quantity: number;
  active: boolean;
  kind: string;
  // The app's own photo (private bucket). Never changed from the webstore.
  photo_path?: string | null;
};

// Which picture the site shows: the image link, or the file uploaded for it.
export type ImageSource = "url" | "file";

export type WebProduct = {
  id: string;
  product_id: string | null;
  name: string;
  name_fr: string | null;
  size: string | null;
  category_id: string;
  sub_code: string | null;
  popular: boolean;
  keywords: string | null;
  image_url: string | null;
  // The file uploaded for the site (bucket 'webstore-images', migration 057).
  image_path: string | null;
  image_source: ImageSource;
  // Typed price. Only used while the row is not linked.
  price_cents: number | null;
  stock_mode: StockMode;
  manual_in_stock: boolean;
  published: boolean;
  sort: number;
  // The linked app product (null when not linked, or when it could not be read).
  app: LinkedAppProduct | null;
};

export type WebSubcategory = { code: string; name: string; name_fr: string; sort: number };

export type WebCategory = {
  id: string;
  name: string;
  name_fr: string;
  icon: string;
  sort: number;
  subs: WebSubcategory[];
};

// What the edit screen may write (never id, sort, product_id: those have their
// own functions).
export type WebProductPatch = Partial<
  Pick<
    WebProduct,
    | "name"
    | "name_fr"
    | "size"
    | "category_id"
    | "sub_code"
    | "popular"
    | "keywords"
    | "image_url"
    | "price_cents"
    | "stock_mode"
    | "manual_in_stock"
    | "published"
  >
>;

export type NewWebProduct = {
  name: string;
  name_fr: string | null;
  category_id: string;
  product_id: string | null;
  // Unlinked new rows start with no price ("prix à confirmer").
  price_cents?: number | null;
};

// A candidate for linking: an app product the owner may link to.
export type LinkCandidate = LinkedAppProduct;
