import {
  AlertTriangle,
  Apple,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Baby,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Coffee,
  Cookie,
  CreditCard,
  Croissant,
  CupSoda,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  Gift,
  House,
  Info,
  Lock,
  LogOut,
  MessageCircle,
  Milk,
  Minus,
  Package,
  PawPrint,
  Pencil,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Scale,
  ScanBarcode,
  Search,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Snowflake,
  Sparkles,
  SprayCan,
  Star,
  Store,
  Tag,
  Trash2,
  TrendingDown,
  Truck,
  type LucideIcon,
  Undo2,
  Upload,
  User,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react-native";
import { Platform, View } from "react-native";
import { useTranslation } from "react-i18next";

import { colors } from "@/src/theme/tokens";

// A curated set, not all of Lucide: add a name here when a screen needs it.
export const ICONS = {
  alert: AlertTriangle,
  bell: Bell,
  cart: ShoppingCart,
  more: Ellipsis,
  refresh: RefreshCw,
  scale: Scale,
  back: ArrowLeft,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  // The icons of the site's categories (the page's own list).
  catDrinks: CupSoda,
  catSnacks: Cookie,
  catPhone: Smartphone,
  catHome: House,
  catBag: ShoppingBag,
  catCup: Coffee,
  catGift: Gift,
  catBread: Croissant,
  catFresh: Apple,
  catDairy: Milk,
  catFrozen: Snowflake,
  catClean: SprayCan,
  catCare: Sparkles,
  catBaby: Baby,
  catPet: PawPrint,
  cash: Banknote,
  chart: BarChart3,
  book: BookOpen,
  calendar: Calendar,
  camera: Camera,
  check: Check,
  clipboard: ClipboardList,
  down: ChevronDown,
  chevron: ChevronRight,
  chevronBack: ChevronLeft,
  clock: Clock,
  info: Info,
  card: CreditCard,
  download: Download,
  eye: Eye,
  eyeOff: EyeOff,
  lock: Lock,
  logout: LogOut,
  message: MessageCircle,
  minus: Minus,
  package: Package,
  pencil: Pencil,
  plus: Plus,
  printer: Printer,
  receipt: Receipt,
  scan: ScanBarcode,
  search: Search,
  sliders: SlidersHorizontal,
  star: Star,
  store: Store,
  tag: Tag,
  trash: Trash2,
  trendingDown: TrendingDown,
  truck: Truck,
  undo: Undo2,
  upload: Upload,
  user: User,
  users: Users,
  wifi: Wifi,
  wifiOff: WifiOff,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

// Directional icons mirror in right-to-left layouts; the rest never do.
export const FLIP_IN_RTL: ReadonlySet<IconName> = new Set<IconName>([
  "back",
  "chevron",
  "chevronBack",
  "undo",
  "logout",
  "message",
]);

export function shouldFlip(name: IconName, lang: string): boolean {
  return lang === "ar" && FLIP_IN_RTL.has(name);
}

type Props = { name: IconName; size?: number; color?: string };

const decorative =
  Platform.OS === "web"
    ? { "aria-hidden": true }
    : { accessibilityElementsHidden: true, importantForAccessibility: "no" as const };

// Decorative by default: the label next to it carries the meaning. Icon-only
// buttons must give their button an accessibilityLabel.
export function Icon({ name, size = 24, color = colors.ink900 }: Props) {
  const { i18n } = useTranslation();
  const Glyph = ICONS[name];
  const glyph = <Glyph size={size} color={color} strokeWidth={2} {...decorative} />;
  // Mirror a wrapper, not the SVG: a transform on the SVG itself renders nothing on web.
  return shouldFlip(name, i18n?.language ?? "fr") ? (
    <View style={{ transform: [{ scaleX: -1 }] }}>{glyph}</View>
  ) : (
    glyph
  );
}
