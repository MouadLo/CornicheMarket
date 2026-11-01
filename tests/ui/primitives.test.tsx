import React from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { Badge } from "../../src/components/ui/Badge";
import { Card } from "../../src/components/ui/Card";
import { Chip } from "../../src/components/ui/Chip";
import { Field } from "../../src/components/ui/Field";
import { shouldFlip, FLIP_IN_RTL, ICONS } from "../../src/components/ui/Icon";
import { ListRow } from "../../src/components/ui/ListRow";
import { Money, moneyLabel } from "../../src/components/ui/Money";
import { Segmented } from "../../src/components/ui/Segmented";
import { StatusPill } from "../../src/components/ui/StatusPill";
import { Tabs } from "../../src/components/ui/Tabs";

let mockLang = "fr";
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: mockLang } }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  const names = [
    "AlertTriangle",
    "Bell",
    "Ellipsis",
    "RefreshCw",
    "ShoppingCart",
      "Scale",
    "ArrowLeft",
    "Banknote",
    "BarChart3",
    "BookOpen",
    "Calendar",
    "Camera",
    "Check",
    "ChevronDown",
    "ChevronRight",
    "Clock",
    "CreditCard",
    "Download",
    "Lock",
    "LogOut",
    "MessageCircle",
    "Minus",
    "Package",
    "Pencil",
    "Plus",
    "Printer",
    "Receipt",
    "ScanBarcode",
    "Search",
    "SlidersHorizontal",
    "Star",
    "Tag",
    "Trash2",
    "Truck",
    "Undo2",
    "Upload",
    "User",
    "Users",
    "Wifi",
    "WifiOff",
    "X",
  ];
  return Object.fromEntries(
    names.map((n) => [n, (p: object) => React.createElement("Icon", { name: n, ...p })])
  );
});

function render(el: React.ReactElement) {
  let r!: ReturnType<typeof create>;
  act(() => {
    r = create(el);
  });
  return r;
}
const texts = (n: ReactTestInstance): string[] =>
  n
    .findAll((x) => typeof x.type === "string" && (x.type as unknown) === "Text")
    .map((x) => x.children.join(""));
// Outermost node per pressable (Pressable and its inner host share props).
const byRole = (r: ReturnType<typeof create>, role: string) => {
  const match = (n: ReactTestInstance) =>
    n.props.accessibilityRole === role && typeof n.props.onPress === "function";
  return r.root.findAll(match).filter((n) => !n.parent || !match(n.parent));
};

beforeEach(() => {
  mockLang = "fr";
});

describe("Money", () => {
  it("groups thousands and isolates left-to-right", () => {
    const r = render(<Money cents={348250} />);
    const text = texts(r.root.findByType("Text" as never))[0] ?? "";
    expect(text).toBe("\u20663\u00a0482.50 DH\u2069");
  });

  it("flow tone shows the sign and colours by direction (never colour alone)", () => {
    expect(moneyLabel(7423, true)).toBe("+74.23 DH");
    expect(moneyLabel(-240, true)).toBe("−2.40 DH");
    expect(moneyLabel(0, true)).toBe("0.00 DH");
    const up = render(<Money cents={500} tone="flow" />).root.findByType("Text" as never);
    const down = render(<Money cents={-500} tone="flow" />).root.findByType("Text" as never);
    expect(JSON.stringify(up.props.style)).toContain("#16653a");
    expect(JSON.stringify(down.props.style)).toContain("#b3261e");
  });

  it("big sizes are bold, and the text follows the app writing direction", () => {
    const big = render(<Money cents={100} size="total" />).root.findByType("Text" as never);
    expect(JSON.stringify(big.props.style)).toContain('"fontWeight":"700"');
    expect(JSON.stringify(big.props.style)).toContain('"writingDirection":"ltr"');
    mockLang = "ar";
    const ar = render(<Money cents={100} />).root.findByType("Text" as never);
    expect(JSON.stringify(ar.props.style)).toContain('"writingDirection":"rtl"');
  });

  it("uses tabular figures", () => {
    const t = render(<Money cents={100} />).root.findByType("Text" as never);
    expect(JSON.stringify(t.props.style)).toContain("tabular-nums");
  });
});

describe("Icon", () => {
  it("flips only directional icons, and only in Arabic", () => {
    for (const name of Object.keys(ICONS) as (keyof typeof ICONS)[]) {
      expect(shouldFlip(name, "fr")).toBe(false);
      expect(shouldFlip(name, "ar")).toBe(FLIP_IN_RTL.has(name));
    }
    expect([...FLIP_IN_RTL].sort()).toEqual(["back", "chevron", "logout", "message", "undo"]);
    expect(shouldFlip("check", "ar")).toBe(false);
  });
});

describe("Icon rendering", () => {
  it("mirrors a wrapper View in Arabic for directional icons only", () => {
    mockLang = "ar";
    const { Icon } = require("../../src/components/ui/Icon");
    const flipped = render(<Icon name="back" />).root;
    expect(JSON.stringify(flipped.findByType("View" as never).props.style)).toContain("scaleX");
    expect(render(<Icon name="check" />).root.findAllByType("View" as never)).toHaveLength(0);
    mockLang = "fr";
    expect(render(<Icon name="back" />).root.findAllByType("View" as never)).toHaveLength(0);
  });
});

describe("Chip", () => {
  it("is a button that reports selection and presses", () => {
    const onPress = jest.fn();
    const r = render(<Chip label="Boissons" selected count={3} onPress={onPress} />);
    const [btn] = byRole(r, "button");
    expect(btn.props.accessibilityState).toEqual({ selected: true });
    act(() => btn.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(texts(r.root)).toEqual(["Boissons", "3"]);
  });
});

describe("Tabs", () => {
  it("marks the active tab, shows badges, and changes tab", () => {
    const onChange = jest.fn();
    const r = render(
      <Tabs
        items={[
          { key: "recv", label: "Réception" },
          { key: "buy", label: "Achats", badge: 5 },
        ]}
        value="recv"
        onChange={onChange}
      />
    );
    const tabs = byRole(r, "tab");
    expect(tabs.map((t) => t.props.accessibilityState.selected)).toEqual([true, false]);
    expect(texts(r.root)).toContain("5");
    act(() => tabs[1].props.onPress());
    expect(onChange).toHaveBeenCalledWith("buy");
  });
});

describe("Segmented", () => {
  it("selects one option", () => {
    const onChange = jest.fn();
    const r = render(
      <Segmented
        options={[
          { key: "w", label: "Poids" },
          { key: "m", label: "Montant" },
        ]}
        value="w"
        onChange={onChange}
      />
    );
    const radios = byRole(r, "radio");
    expect(radios.map((x) => x.props.accessibilityState.selected)).toEqual([true, false]);
    act(() => radios[1].props.onPress());
    expect(onChange).toHaveBeenCalledWith("m");
  });
});

describe("Badge, StatusPill, Card, ListRow", () => {
  it("renders values, labels and children", () => {
    expect(texts(render(<Badge value={8} tone="warn" />).root)).toEqual(["8"]);
    expect(texts(render(<StatusPill label="Payée" tone="ok" icon="check" />).root)).toEqual([
      "Payée",
    ]);
    expect(
      texts(
        render(
          <Card title="Titre">
            <Badge value={1} />
          </Card>
        ).root
      )
    ).toEqual(["Titre", "1"]);
  });

  it("ListRow is a button only when it has onPress, and exposes selection", () => {
    const onPress = jest.fn();
    const pressable = render(<ListRow title="Hassan" subtitle="0661" selected onPress={onPress} />);
    const [btn] = byRole(pressable, "button");
    expect(btn.props.accessibilityState).toEqual({ selected: true });
    act(() => btn.props.onPress());
    expect(onPress).toHaveBeenCalled();
    expect(byRole(render(<ListRow title="Static" />), "button")).toHaveLength(0);
  });
});

describe("Field", () => {
  it("labels the input, shows the error instead of the helper, and opens a decimal pad when numeric", () => {
    const r = render(
      <Field
        label="Prix"
        helper="aide"
        error="Trop élevé"
        numeric
        unit="DH"
        value="6.5"
        onChangeText={() => {}}
      />
    );
    const input = r.root.findByType("TextInput" as never);
    expect(input.props.accessibilityLabel).toBe("Prix");
    expect(input.props.keyboardType).toBe("decimal-pad");
    expect(texts(r.root)).toContain("Trop élevé");
    expect(texts(r.root)).not.toContain("aide");
    expect(texts(r.root)).toContain("DH");
  });

  it("shows the helper when there is no error", () => {
    const r = render(<Field label="Nom" helper="aide" value="" onChangeText={() => {}} />);
    expect(texts(r.root)).toContain("aide");
  });
});
