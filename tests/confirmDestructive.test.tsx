/**
 * Void sale, void delivery and stock-adjustment all gate on confirmDestructive
 * before writing anything. It used to be window.confirm (web) and Alert.alert
 * (native); both are now replaced by one in-app dialog. These pin the same
 * guarantees as before, on every platform, through the real dialog host:
 * the caller's translated labels, cancel before confirm, destructive style,
 * a real yes/no, and never a browser or OS dialog.
 */
import React from "react";
import { Alert, Platform } from "react-native";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { DialogHost } from "../src/components/ui/DialogHost";
import { confirmDestructive } from "../src/lib/confirmDestructive";
import { __resetForTests } from "../src/lib/dialog/store";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "fr" } }),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});

const originalOS = Platform.OS;
let renderer: ReturnType<typeof create>;

const texts = (n: ReactTestInstance) =>
  n.findAll((x) => (x.type as unknown) === "Text").map((x) => x.children.join(""));
function button(label: string): ReactTestInstance {
  const hits = renderer.root.findAll(
    (n) => typeof n.props.onPress === "function" && texts(n).includes(label)
  );
  if (!hits.length)
    throw new Error(`no button "${label}" in ${JSON.stringify(texts(renderer.root))}`);
  // The smallest node holding the label is the button; wrappers contain the same text.
  return hits.reduce((a, b) =>
    a.findAll(() => true).length <= b.findAll(() => true).length ? a : b
  );
}
const press = (label: string) => act(() => button(label).props.onPress());
// confirm() updates the host, so ask inside act().
function ask(...args: Parameters<typeof confirmDestructive>): Promise<boolean> {
  let p!: Promise<boolean>;
  act(() => {
    p = confirmDestructive(...args);
  });
  return p;
}

beforeEach(() => {
  __resetForTests();
  act(() => {
    renderer = create(<DialogHost />);
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  Platform.OS = originalOS;
  delete (window as unknown as { confirm?: unknown }).confirm;
  jest.restoreAllMocks();
});

describe.each(["web", "ios", "android"] as const)("confirmDestructive on %s", (os) => {
  beforeEach(() => {
    Platform.OS = os;
  });

  it("shows the title, message and the caller's translated labels", async () => {
    let result: boolean | undefined;
    act(() => {
      void confirmDestructive(
        "Annuler cette vente ?",
        "14.50 DH seront annulés.",
        "Annuler la vente",
        "Garder la vente"
      ).then((v) => (result = v));
    });
    const all = texts(renderer.root);
    expect(all).toContain("Annuler cette vente ?");
    expect(all).toContain("14.50 DH seront annulés.");
    expect(all).toContain("Annuler la vente");
    expect(all).toContain("Garder la vente");
    press("Garder la vente");
    await Promise.resolve();
    expect(result).toBe(false);
  });

  it("resolves true on the confirm button", async () => {
    const promise = ask("Titre", "Message", "Confirmer", "Annuler");
    press("Confirmer");
    await expect(promise).resolves.toBe(true);
  });

  it("resolves false on cancel, so the caller never writes", async () => {
    const promise = ask("Titre", "Message", "Confirmer", "Annuler");
    press("Annuler");
    await expect(promise).resolves.toBe(false);
  });

  it("puts Cancel before Confirm, and styles Confirm as destructive (red)", () => {
    act(() => {
      void confirmDestructive("Titre", "Message", "Confirmer", "Annuler");
    });
    const order = texts(renderer.root).filter((t) => t === "Annuler" || t === "Confirmer");
    expect(order).toEqual(["Annuler", "Confirmer"]);
    const style = JSON.stringify(
      button("Confirmer")
        .findAll(() => true)
        .map((n) => n.props.style)
    );
    expect(style).toContain("#b3261e");
  });

  it("never opens a browser or OS dialog", async () => {
    const confirmSpy = jest.fn();
    (window as unknown as { confirm: typeof confirmSpy }).confirm = confirmSpy;
    const alertSpy = jest.spyOn(Alert, "alert");
    const promise = ask("Titre", "Message", "Confirmer", "Annuler");
    press("Confirmer");
    await promise;
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("the Android back button / Escape counts as no, so the promise always resolves", async () => {
    const promise = ask("Titre", "Message", "Confirmer", "Annuler");
    const modal = renderer.root.findByType(require("react-native").Modal);
    act(() => modal.props.onRequestClose());
    await expect(promise).resolves.toBe(false);
  });

  it("a tap outside does not dismiss a destructive dialog", async () => {
    let settled = false;
    act(() => {
      void confirmDestructive("Titre", "Message", "Confirmer", "Annuler").then(
        () => (settled = true)
      );
    });
    const scrim = renderer.root.findAllByProps({ testID: "dialog-scrim" })[0];
    expect(scrim.props.onPress).toBeUndefined();
    await Promise.resolve();
    expect(settled).toBe(false);
    press("Annuler");
  });
});

describe("confirmDestructive without a host", () => {
  it("answers no instead of hanging or writing", async () => {
    act(() => renderer.unmount());
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(confirmDestructive("Titre", "Message", "Confirmer", "Annuler")).resolves.toBe(
      false
    );
    expect(warn).toHaveBeenCalled();
    act(() => {
      renderer = create(<DialogHost />);
    });
  });
});
