import { StyleSheet, Text } from "react-native";
import type { ReactTestInstance } from "react-test-renderer";

// Text of a node as one string (children can be strings, numbers or arrays).
export function textOf(node: ReactTestInstance): string {
  return node
    .findAllByType(Text)
    .map((text) => [text.props.children].flat(Infinity).join(""))
    .join("");
}

export function allTexts(root: ReactTestInstance): string[] {
  return root
    .findAllByType(Text)
    .map((text) => [text.props.children].flat(Infinity).join(""))
    .filter((value) => value.trim() !== "");
}

export function pressableByText(root: ReactTestInstance, label: string): ReactTestInstance {
  const found = root
    .findAll((node) => typeof node.props.onPress === "function" && node.type !== undefined)
    .find((node) => textOf(node) === label);
  if (!found) throw new Error(`no pressable labelled "${label}"`);
  return found;
}

export function sizeOf(node: ReactTestInstance): { minHeight: number; minWidth: number } {
  // Pressable styles can be a function of the pressed state, and a wrapper
  // component (the shared Chip) carries no style: read its first styled child.
  const holder =
    node.props.style !== undefined ? node : node.find((n) => n.props.style !== undefined);
  const raw = holder.props.style;
  const style = StyleSheet.flatten(typeof raw === "function" ? raw({ pressed: false }) : raw) ?? {};
  return {
    minHeight: (style.minHeight as number) ?? (style.height as number) ?? 0,
    minWidth: (style.minWidth as number) ?? (style.width as number) ?? 0,
  };
}

// With t() mocked as ⟦key⟧, any visible string that is not a ⟦key⟧, a number
// or a money amount is hardcoded text (or data). `allowed` lists the data.
export function hardcodedTexts(root: ReactTestInstance, allowed: string[] = []): string[] {
  return allTexts(root).filter(
    (value) =>
      !value.includes("⟦") &&
      !allowed.includes(value) &&
      !/^[\d\s.,:+\-−×·/%⌫()]*(DH)?$/.test(value)
  );
}

export const keyEcho = (key: string) => `⟦${key}⟧`;
