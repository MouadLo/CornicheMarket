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
const mockUpdate = jest.fn(async () => {});
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
  exportEverything: jest.fn(),
  exportProducts: jest.fn(),
  exportPurchases: jest.fn(),
  exportSales: jest.fn(),
  getLastBackupTime: jest.fn(async () => new Date()),
}));
jest.mock("../src/lib/reports/queries", () => ({
  fetchStoreTimezone: jest.fn(async () => "Africa/Casablanca"),
  updateStoreTimezone: (...a: unknown[]) => mockUpdate(...(a as [])),
}));
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

beforeEach(() => jest.clearAllMocks());
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
