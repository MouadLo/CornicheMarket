import React from "react";
import { Dimensions, Modal } from "react-native";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { Banner } from "../../src/components/ui/Banner";
import { ConfirmDialog, DialogHost, ToastView } from "../../src/components/ui/DialogHost";
import { EmptyState } from "../../src/components/ui/EmptyState";
import { LoadQueryError } from "../../src/components/ui/LoadQueryError";
import { OfflineBanner, OfflineRequired } from "../../src/components/ui/OfflineState";
import { DOCK_BREAKPOINT, Panel, panelMode } from "../../src/components/ui/Panel";
import { Popover } from "../../src/components/ui/Popover";
import {
  __resetForTests,
  confirm,
  dismissToast,
  getState,
  registerHost,
  showToast,
} from "../../src/lib/dialog/store";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: object) => (o ? `${k}${JSON.stringify(o)}` : k),
    i18n: { language: "fr" },
  }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});

const texts = (n: ReactTestInstance) =>
  n.findAll((x) => (x.type as unknown) === "Text").map((x) => x.children.join(""));
// The smallest node holding the label is the button itself; outer wrappers
// (dialog card, scrim) contain the same text.
const smallest = (hits: ReactTestInstance[]) =>
  hits.reduce((a, b) => (a.findAll(() => true).length <= b.findAll(() => true).length ? a : b));
const press = (r: ReturnType<typeof create>, label: string) => {
  const hits = r.root.findAll(
    (n) => typeof n.props.onPress === "function" && texts(n).includes(label)
  );
  act(() => smallest(hits).props.onPress());
};
function render(el: React.ReactElement) {
  let r!: ReturnType<typeof create>;
  act(() => {
    r = create(el);
  });
  return r;
}

beforeEach(() => {
  jest.useFakeTimers();
  __resetForTests();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("dialog store", () => {
  it("queues confirms and shows them one at a time, in order", async () => {
    const off = registerHost();
    const first = confirm({ title: "one" });
    const second = confirm({ title: "two" });
    expect(getState().confirm?.title).toBe("one");
    const { resolveConfirm } = require("../../src/lib/dialog/store");
    resolveConfirm(getState().confirm!.id, true);
    await expect(first).resolves.toBe(true);
    expect(getState().confirm?.title).toBe("two");
    resolveConfirm(getState().confirm!.id, false);
    await expect(second).resolves.toBe(false);
    expect(getState().confirm).toBeNull();
    off();
  });

  it("answers no to everything pending when the host goes away", async () => {
    const off = registerHost();
    const a = confirm({ title: "a" });
    const b = confirm({ title: "b" });
    off();
    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(false);
  });

  it("shows one toast at a time, replaces it, and auto-dismisses after 5 s", () => {
    showToast({ text: "first" });
    showToast({ text: "second" });
    expect(getState().toast?.text).toBe("second");
    act(() => jest.advanceTimersByTime(4999));
    expect(getState().toast).not.toBeNull();
    act(() => jest.advanceTimersByTime(2));
    expect(getState().toast).toBeNull();
  });

  it("a stale dismiss does not close a newer toast", () => {
    showToast({ text: "old" });
    const oldId = getState().toast!.id;
    showToast({ text: "new" });
    dismissToast(oldId);
    expect(getState().toast?.text).toBe("new");
  });
});

describe("ConfirmDialog", () => {
  it("uses translated default labels, and a tap outside cancels a non-destructive dialog", async () => {
    const off = registerHost();
    const promise = confirm({ title: "Continuer ?" });
    const r = render(<ConfirmDialog request={getState().confirm!} />);
    expect(texts(r.root)).toEqual(expect.arrayContaining(["common.cancel", "common.confirm"]));
    const scrim = r.root.findAllByProps({ testID: "dialog-scrim" })[0];
    act(() => scrim.props.onPress());
    await expect(promise).resolves.toBe(false);
    off();
  });

  it("lists what will change, before and after", () => {
    const off = registerHost();
    void confirm({
      tone: "danger",
      title: "Annuler la livraison ?",
      summary: "Boissons Atlantique · 2 460.00 DH",
      consequences: [{ label: "Reste dû", before: "960.00 DH", after: "0.00 DH" }],
    });
    const r = render(<ConfirmDialog request={getState().confirm!} />);
    expect(texts(r.root)).toEqual(
      expect.arrayContaining([
        "Boissons Atlantique · 2 460.00 DH",
        "Reste dû",
        "\u{2066}960.00 DH\u{2069}",
        "\u{2066}0.00 DH\u{2069}",
      ])
    );
    off();
  });

  it("DialogHost registers itself and renders requests and toasts", async () => {
    const r = render(<DialogHost />);
    const promise = confirm({ title: "Titre", confirmLabel: "Oui", cancelLabel: "Non" });
    expect(texts(r.root)).toContain("Titre");
    press(r, "Oui");
    await expect(promise).resolves.toBe(true);
    act(() => showToast({ text: "Vente enregistrée" }));
    expect(texts(r.root)).toContain("Vente enregistrée");
    act(() => r.unmount());
  });
});

describe("Toast", () => {
  it("runs the action once and closes", () => {
    const onPress = jest.fn();
    showToast({ text: "Retiré : Pain rond", action: { label: "Annuler", onPress } });
    const r = render(<ToastView toast={getState().toast!} />);
    press(r, "Annuler");
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(getState().toast).toBeNull();
  });
});

describe("Banner", () => {
  it("shows text and an optional action", () => {
    const onPress = jest.fn();
    const r = render(
      <Banner tone="warn" text="Hors ligne" action={{ label: "Détails", onPress }} />
    );
    expect(texts(r.root)).toEqual(["Hors ligne", "Détails"]);
    press(r, "Détails");
    expect(onPress).toHaveBeenCalled();
  });
});

describe("Panel", () => {
  it("docks from 900 dp, fills the screen below", () => {
    expect(DOCK_BREAKPOINT).toBe(900);
    expect(panelMode(1366)).toBe("docked");
    expect(panelMode(900)).toBe("docked");
    expect(panelMode(899)).toBe("fullscreen");
    expect(panelMode(412)).toBe("fullscreen");
  });

  it("renders nothing when closed, and title/body/footer when open", () => {
    expect(
      render(
        <Panel visible={false} title="x" onClose={() => {}}>
          {null}
        </Panel>
      ).toJSON()
    ).toBeNull();
    const r = render(
      <Panel visible title="Hassan" onClose={() => {}} footer={<></>}>
        <></>
      </Panel>
    );
    expect(texts(r.root)).toContain("Hassan");
  });

  const setWidth = (width: number) =>
    jest.spyOn(Dimensions, "get").mockReturnValue({ width, height: 768, scale: 1, fontScale: 1 });
  const byLabel = (r: ReturnType<typeof create>, l: string) =>
    r.root.findAll(
      (n) => n.props.accessibilityLabel === l && typeof n.props.onPress === "function"
    )[0];

  it("docked: closes with the X, and drills back with onBack", () => {
    setWidth(1366);
    const onClose = jest.fn();
    const onBack = jest.fn();
    const r = render(
      <Panel visible title="Ticket" onClose={onClose} onBack={onBack}>
        <></>
      </Panel>
    );
    expect(r.root.findAllByType(Modal)).toHaveLength(0);
    act(() => byLabel(r, "common.close").props.onPress());
    act(() => byLabel(r, "common.back").props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("fullscreen (phone): a modal with a back arrow and no X", () => {
    setWidth(412);
    const onClose = jest.fn();
    const r = render(
      <Panel visible title="Ticket" onClose={onClose}>
        <></>
      </Panel>
    );
    expect(r.root.findAllByType(Modal)).toHaveLength(1);
    expect(byLabel(r, "common.close")).toBeUndefined();
    act(() => byLabel(r, "common.back").props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Popover", () => {
  it("is a modal that closes on back and on a tap outside", () => {
    const onClose = jest.fn();
    const r = render(
      <Popover visible onClose={onClose}>
        <></>
      </Popover>
    );
    const modal = r.root.findByType(Modal);
    act(() => modal.props.onRequestClose());
    const backdrop = r.root.findAll(
      (n) => n.props.accessibilityLabel === "close" && n.props.onPress
    )[0];
    act(() => backdrop.props.onPress());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("empty, error and offline states", () => {
  it("LoadQueryError never shows a raw error, and retry works", () => {
    const onRetry = jest.fn();
    const r = render(<LoadQueryError what="les clients" onRetry={onRetry} />);
    expect(texts(r.root)).toEqual([
      'states.loadErrorTitle{"what":"les clients"}',
      "states.loadErrorHint",
      "common.retry",
    ]);
    press(r, "common.retry");
    expect(onRetry).toHaveBeenCalled();
  });

  it("OfflineBanner shows the price age; OfflineRequired says what needs a connection", () => {
    expect(texts(render(<OfflineBanner priceTime="14:20" />).root)).toEqual([
      'states.offlinePrices{"time":"14:20"}',
    ]);
    expect(texts(render(<OfflineBanner />).root)).toEqual(["states.offlineTitle"]);
    expect(texts(render(<OfflineRequired action="enregistrer la livraison" />).root)).toEqual([
      "states.offlineTitle",
      'states.offlineNeeded{"action":"enregistrer la livraison"}',
    ]);
  });

  it("EmptyState shows title, message and action", () => {
    const r = render(
      <EmptyState
        icon="users"
        title="Personne ne doit d'argent"
        message="Les ventes à crédit apparaîtront ici."
      />
    );
    expect(texts(r.root)).toEqual([
      "Personne ne doit d'argent",
      "Les ventes à crédit apparaîtront ici.",
    ]);
  });
});
