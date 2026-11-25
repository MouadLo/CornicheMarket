import { Icon, type IconName } from "@/src/components/ui/Icon";
import { shownIcon, type CategoryIcon as Known } from "@/src/lib/webstore/categories";
import { colors } from "@/src/theme/tokens";

const NAME: Record<Known, IconName> = {
  drinks: "catDrinks",
  snacks: "catSnacks",
  phone: "catPhone",
  home: "catHome",
  bag: "catBag",
  cup: "catCup",
  gift: "catGift",
  bread: "catBread",
  fresh: "catFresh",
  dairy: "catDairy",
  frozen: "catFrozen",
  clean: "catClean",
  care: "catCare",
  baby: "catBaby",
  pet: "catPet",
};

// What the page draws for a category's icon (an unknown one shows as a bag).
export function CategoryIcon({ icon, size = 24 }: { icon: string; size?: number }) {
  return <Icon name={NAME[shownIcon(icon)]} size={size} color={colors.brand700} />;
}
