import { HeaderBackButton } from "@react-navigation/elements";
import { useRoute } from "@react-navigation/native";
import { router, useNavigation, usePathname } from "expo-router";
import { useSyncExternalStore } from "react";

import { backTarget, getOrigin, hrefToLocation, subscribeOrigin } from "@/src/lib/nav/origin";

// The back arrow of every section stack. Inside a stack it is the usual
// goBack. A screen that is alone in its stack because it was opened from
// another section (only one section is mounted at a time) goes back to the
// exact place the owner came from, with its search params (the Concurrents
// tab, say); without a known origin (page reload) to the section root. The
// root screen of a section shows nothing.
export function SectionBackButton({ tintColor }: { tintColor?: string }) {
  const navigation = useNavigation();
  const route = useRoute();
  const pathname = usePathname();
  const origin = useSyncExternalStore(subscribeOrigin, getOrigin, getOrigin);

  const inStack = navigation.getState().index > 0;
  const target = backTarget({ inStack, isRoot: route.name === "index", pathname, origin });
  if (target.kind === "none") return null;

  return (
    <HeaderBackButton
      tintColor={tintColor}
      labelVisible={false}
      accessibilityLabel="back"
      onPress={() => {
        if (target.kind === "stack") navigation.goBack();
        // The place the owner came from: open its exact address (section and
        // tab) in place of this screen, in one step. (Stepping back first and
        // then navigating raced: the second step was sometimes dropped.)
        // `r` changes on every return: the screen reloads its list, which may
        // have changed while the owner was away, like after Save. Without a
        // known origin, open the section root.
        else if (target.fromOrigin) {
          // The plain address string (not the {pathname, params} object): into a
          // section that is not mounted, only the string carries the tab.
          const joiner = target.href.includes("?") ? "&" : "?";
          router.replace(`${target.href}${joiner}r=${Date.now()}` as never);
        } else router.navigate(hrefToLocation(target.href) as never);
      }}
    />
  );
}

export const sectionStackOptions = {
  headerLeft: (props: { tintColor?: string }) => <SectionBackButton tintColor={props.tintColor} />,
};
