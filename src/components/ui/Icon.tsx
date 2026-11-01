import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Bell,
  BarChart3,
  BookOpen,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Info,
  CreditCard,
  Download,
  Ellipsis,
  Lock,
  LogOut,
  MessageCircle,
  Minus,
  Package,
  Pencil,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  ScanBarcode,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  Truck,
  Undo2,
  Upload,
  User,
  Users,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { colors } from "@/src/theme/tokens";

// A curated set, not all of Lucide: add a name here when a screen needs it.
export const ICONS = {
  alert: AlertTriangle,
  bell: Bell,
  cart: ShoppingCart,
  more: Ellipsis,
  refresh: RefreshCw,
  back: ArrowLeft,
  cash: Banknote,
  chart: BarChart3,
  book: BookOpen,
  calendar: Calendar,
  camera: Camera,
  check: Check,
  down: ChevronDown,
  chevron: ChevronRight,
  clock: Clock,
  info: Info,
  card: CreditCard,
  download: Download,
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
  tag: Tag,
  trash: Trash2,
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
  "undo",
  "logout",
  "message",
]);

export function shouldFlip(name: IconName, lang: string): boolean {
  return lang === "ar" && FLIP_IN_RTL.has(name);
}

type Props = { name: IconName; size?: number; color?: string };

// Decorative by default: the label next to it carries the meaning. Icon-only
// buttons must give their button an accessibilityLabel.
export function Icon({ name, size = 24, color = colors.ink900 }: Props) {
  const { i18n } = useTranslation();
  const Glyph = ICONS[name];
  const glyph = (
    <Glyph
      size={size}
      color={color}
      strokeWidth={2}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
  // Mirror a wrapper, not the SVG: a transform on the SVG itself renders nothing on web.
  return shouldFlip(name, i18n?.language ?? "fr") ? (
    <View style={{ transform: [{ scaleX: -1 }] }}>{glyph}</View>
  ) : (
    glyph
  );
}
