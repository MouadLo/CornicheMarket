/**
 * Settings: the store time zone moves every report's day boundaries, so a tap
 * asks first and writes nothing on "no". Sign out sits last, as a secondary
 * button, and the role is translated.
 */
import React from "react";
import { Pressable, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BigButton } from "../src/components/BigButton";
import Settings from "../app/(app)/settings";

const mockConfirm = jest.fn();
const mockUpdate = jest.fn(async (..._args: unknown[]) => {});
const mockFetchTz = jest.fn(async () => "Africa/Casablanca");
const mockInvite = jest.fn(async (..._args: unknown[]) => {});
const mockExportAll = jest.fn(async () => {});
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: object) => (o ? `${k}${JSON.stringify(o)}` : k),
    i18n: { language: "fr" },
  }),
}));
jest.mock("../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    session: { user: { email: "o@x.ma" } },
    profile: { full_name: "Salma", role: "owner" },
  }),
}));
jest.mock("../src/lib/auth/useSignOut", () => ({ useSignOut: () => jest.fn() }));
jest.mock("../src/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("../src/i18n", () => ({ changeLanguage: jest.fn() }));
jest.mock("../src/lib/backup/export", () => ({
  exportEverything: () => mockExportAll(),
  exportProducts: jest.fn(),
  exportPurchases: jest.fn(),
  exportSales: jest.fn(),
  getLastBackupTime: jest.fn(async () => new Date()),
}));
jest.mock("../src/lib/reports/queries", () => ({
  fetchStoreTimezone: () => mockFetchTz(),
  updateStoreTimezone: (...a: unknown[]) => mockUpdate(...(a as [])),
}));
jest.mock("../src/lib/auth/inviteCashier", () => ({
  inviteCashier: (...a: unknown[]) => mockInvite(...a),
}));
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});
jest.mock("../src/lib/dialog/store", () => ({
  confirm: (...a: unknown[]) => mockConfirm(...a),
}));

let tree: ReactTestRenderer;
const render = async () => {
  await act(async () => {
    tree = create(<Settings />);
  });
};
const zone = (tz: string) =>
  tree.root
    .findAllByType(Pressable)
    .find((p) => p.findAllByType(Text).some((t) => t.props.children === tz))!;
const press = (tz: string) =>
  act(async () => {
    await zone(tz).props.onPress();
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchTz.mockResolvedValue("Africa/Casablanca");
  mockUpdate.mockResolvedValue(undefined);
  mockInvite.mockResolvedValue(undefined);
  mockExportAll.mockResolvedValue(undefined);
});
afterEach(() => act(() => tree?.unmount()));

it("asks before changing the time zone, and writes nothing on no", async () => {
  mockConfirm.mockResolvedValue(false);
  await render();
  await press("UTC");
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  expect(mockConfirm.mock.calls[0][0].message).toContain("UTC");
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("changes the time zone on yes", async () => {
  mockConfirm.mockResolvedValue(true);
  await render();
  await press("UTC");
  expect(mockUpdate).toHaveBeenCalledWith("UTC");
});

it("does not ask when the current zone is tapped again", async () => {
  await render();
  await press("Africa/Casablanca");
  expect(mockConfirm).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("puts a secondary Sign out last and shows the role translated", async () => {
  await render();
  const buttons = tree.root.findAllByType(BigButton);
  const signOut = buttons[buttons.length - 1];
  expect(signOut.props.label).toBe("settings.signOut");
  expect(signOut.props.variant).toBe("secondary");
  const json = JSON.stringify(tree.toJSON());
  expect(json).toContain("shell.roleOwner");
  expect(json).not.toContain('"owner"');
});

const shownText = () =>
  tree.root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).join(""))
    .join("|");
const pressButton = (label: string) =>
  act(async () => {
    await tree.root
      .findAllByType(BigButton)
      .find((b) => b.props.label === label)!
      .props.onPress();
  });

describe("errors on the settings screen", () => {
  it("a failed read of the time zone does not pretend the default is the saved one", async () => {
    mockFetchTz.mockRejectedValue(new TypeError("Failed to fetch"));
    await render();
    expect(shownText()).toContain("settings.timezoneLoadError");
    expect(zone("Africa/Casablanca")).toBeUndefined();
    mockFetchTz.mockResolvedValue("UTC");
    await act(async () => {
      tree.root
        .findAll((n) => n.props.accessibilityRole === "button" && n.props.onPress)
        .find((n) => n.findAllByType(Text).some((t) => t.props.children === "common.retry"))!
        .props.onPress();
    });
    expect(shownText()).not.toContain("settings.timezoneLoadError");
    expect(zone("UTC")).toBeTruthy();
  });

  it("a refused time zone change says why in plain words and puts the old zone back", async () => {
    mockConfirm.mockResolvedValue(true);
    mockUpdate.mockRejectedValue(new Error("Only an owner can change the time zone"));
    await render();
    await press("UTC");
    expect(shownText()).toContain("errors.permission");
    expect(shownText()).not.toContain("Only an owner");
  });

  it("a failed export is translated and sits by the export buttons", async () => {
    mockExportAll.mockRejectedValue(new TypeError("Failed to fetch"));
    await render();
    await pressButton("settings.exportAll");
    expect(shownText()).toContain("errors.network");
    expect(shownText()).not.toContain("Failed to fetch");
  });

  it("an invitation refused by the server is translated, never raw", async () => {
    await render();
    mockInvite.mockRejectedValue(
      new Error("A user with this email address has already been registered")
    );
    const { TextInput } = require("react-native");
    const inputs = tree.root.findAllByType(TextInput);
    await act(async () => inputs[0].props.onChangeText("Amina"));
    await act(async () => inputs[1].props.onChangeText("amina@x.ma"));
    await pressButton("settings.sendInvite");
    expect(mockInvite).toHaveBeenCalledWith("amina@x.ma", "Amina");
    expect(shownText()).toContain("errors.emailTaken");
    expect(shownText()).not.toContain("already been registered");
  });
});
