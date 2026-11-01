// The sections of the app, who sees them, and the route guard
// (docs/THEME-STRUCTURE.md 1.2). Pure on purpose: the shell, the guard and the
// tests all read the same table.
import type { IconName } from "@/src/components/ui/Icon";

export type Role = "owner" | "cashier";
export type SectionId = "sell" | "clients" | "products" | "stock" | "reports" | "settings";

export type Section = {
  id: SectionId;
  // Expo Router path of the section root.
  route: string;
  // First path segment, as reported by usePathname() (group names are dropped).
  segment: string;
  labelKey:
    "nav.sell" | "nav.clients" | "nav.products" | "nav.stockIn" | "nav.reports" | "nav.settings";
  icon: IconName;
  ownerOnly: boolean;
};

export const SECTIONS: readonly Section[] = [
  {
    id: "sell",
    route: "/(app)/sell",
    segment: "sell",
    labelKey: "nav.sell",
    icon: "cart",
    ownerOnly: false,
  },
  {
    id: "clients",
    route: "/(app)/clients",
    segment: "clients",
    labelKey: "nav.clients",
    icon: "book",
    ownerOnly: false,
  },
  {
    id: "products",
    route: "/(app)/products",
    segment: "products",
    labelKey: "nav.products",
    icon: "package",
    ownerOnly: true,
  },
  {
    id: "stock",
    route: "/(app)/stock-in",
    segment: "stock-in",
    labelKey: "nav.stockIn",
    icon: "truck",
    ownerOnly: true,
  },
  {
    id: "reports",
    route: "/(app)/reports",
    segment: "reports",
    labelKey: "nav.reports",
    icon: "chart",
    ownerOnly: true,
  },
  {
    id: "settings",
    route: "/(app)/settings",
    segment: "settings",
    labelKey: "nav.settings",
    icon: "sliders",
    ownerOnly: true,
  },
];

// Routes that belong to no section but are still owner-only.
const OWNER_ONLY_SEGMENTS = ["dev-components"];

export const HOME_ROUTE = "/(app)/sell";

// A missing profile is treated as a cashier: the guard fails closed.
export function allowedSections(role: Role | null): Section[] {
  return SECTIONS.filter((s) => !s.ownerOnly || role === "owner");
}

function firstSegment(pathname: string): string {
  return (
    pathname
      .replace(/^\/+/, "")
      .replace(/^\(app\)\/?/, "")
      .split("/")[0] ?? ""
  );
}

export function sectionForPath(pathname: string): SectionId | "dev" | null {
  const segment = firstSegment(pathname);
  if (OWNER_ONLY_SEGMENTS.includes(segment)) return "dev";
  return SECTIONS.find((s) => s.segment === segment)?.id ?? null;
}

export function canAccessPath(role: Role | null, pathname: string): boolean {
  const section = sectionForPath(pathname);
  if (section === null) return true; // not ours: the not-found screen decides
  if (section === "dev") return role === "owner";
  return allowedSections(role).some((s) => s.id === section);
}

// Where to send someone who opened a section they may not see, or null.
export function guardRedirect(role: Role | null, pathname: string): string | null {
  return canAccessPath(role, pathname) ? null : HOME_ROUTE;
}

// Phone: at most five tabs. The owner's last two sections live behind "More".
export function phoneTabs(role: Role | null): { tabs: SectionId[]; more: SectionId[] } {
  const ids = allowedSections(role).map((s) => s.id);
  return ids.length <= 5 ? { tabs: ids, more: [] } : { tabs: ids.slice(0, 4), more: ids.slice(4) };
}
