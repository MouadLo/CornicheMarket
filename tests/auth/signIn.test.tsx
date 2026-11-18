/**
 * Enter did nothing on web (no onSubmitEditing wired), and a failed sign-in
 * showed Supabase's raw English message regardless of app language. These
 * pin both fixes.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SignIn from "../../app/sign-in";
import { allTexts, hardcodedTexts } from "../sales/sellTestUtils";

const mockSignIn = jest.fn(async (..._args: unknown[]) => ({ error: null as string | null }));

const mockT = (key: string) => key;
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: "fr" } }),
}));
const mockChangeLanguage = jest.fn(async (..._args: unknown[]) => false);
jest.mock("../../src/i18n", () => ({
  changeLanguage: (...args: unknown[]) => mockChangeLanguage(...args),
}));
jest.mock("../../src/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ signIn: (...args: unknown[]) => mockSignIn(...args) }),
}));

let tree: ReactTestRenderer;
beforeEach(async () => {
  mockSignIn.mockClear();
  mockSignIn.mockResolvedValue({ error: null });
  await act(async () => {
    tree = create(<SignIn />);
  });
});
afterEach(() => act(() => tree.unmount()));

function fillCredentials(email: string, password: string) {
  const inputs = tree.root.findAllByProps({ accessibilityLabel: "auth.email" });
  const passwordInputs = tree.root.findAllByProps({ accessibilityLabel: "auth.password" });
  act(() => inputs[0].props.onChangeText(email));
  act(() => passwordInputs[0].props.onChangeText(password));
}

describe("sign-in", () => {
  it("submits on Enter in the password field, not just the button", async () => {
    fillCredentials("owner@corniche.local", "owner123");
    const passwordInput = tree.root.findAllByProps({ accessibilityLabel: "auth.password" })[0];

    await act(async () => {
      passwordInput.props.onSubmitEditing();
    });

    expect(mockSignIn).toHaveBeenCalledWith("owner@corniche.local", "owner123");
  });

  it("translates 'Invalid login credentials' instead of showing it raw", async () => {
    mockSignIn.mockResolvedValue({ error: "Invalid login credentials" });
    fillCredentials("owner@corniche.local", "wrong");

    await act(async () => {
      tree.root.findAllByProps({ accessibilityLabel: "auth.password" })[0].props.onSubmitEditing();
    });

    const { Text } = jest.requireActual("react-native");
    const texts = tree.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts).toContain("auth.invalidCredentials");
    expect(texts).not.toContain("Invalid login credentials");
  });

  it("says the account was deactivated, not 'invalid credentials' and not raw text", async () => {
    for (const raw of ["Account deactivated", "User is banned"]) {
      mockSignIn.mockResolvedValue({ error: raw });
      fillCredentials("amina@corniche.local", "pw");
      await act(async () => {
        tree.root
          .findAllByProps({ accessibilityLabel: "auth.password" })[0]
          .props.onSubmitEditing();
      });
      const { Text } = jest.requireActual("react-native");
      const texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts).toContain("auth.accountDeactivated");
      expect(texts).not.toContain("auth.invalidCredentials");
      expect(texts).not.toContain(raw);
    }
  });

  it("falls back to a generic translated message for any other failure", async () => {
    mockSignIn.mockResolvedValue({ error: "TypeError: Failed to fetch" });
    fillCredentials("owner@corniche.local", "owner123");

    await act(async () => {
      tree.root.findAllByProps({ accessibilityLabel: "auth.password" })[0].props.onSubmitEditing();
    });

    const { Text } = jest.requireActual("react-native");
    const texts = tree.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts).toContain("auth.signInError");
  });

  it("does not submit with an empty field", async () => {
    fillCredentials("owner@corniche.local", "");
    await act(async () => {
      tree.root.findAllByProps({ accessibilityLabel: "auth.password" })[0].props.onSubmitEditing();
    });

    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("shows real labels and accessible, autofill-friendly inputs", () => {
    const { TextInput } = jest.requireActual("react-native");
    const [emailInput, passwordInput] = tree.root.findAllByType(TextInput);
    expect(emailInput.props.accessibilityLabel).toBe("auth.email");
    expect(emailInput.props.autoComplete).toBe("email");
    expect(emailInput.props.textContentType).toBe("emailAddress");
    expect(passwordInput.props.accessibilityLabel).toBe("auth.password");
    expect(passwordInput.props.autoComplete).toBe("current-password");
    expect(passwordInput.props.textContentType).toBe("password");
    // the label is visible text, not just a placeholder
    expect(allTexts(tree.root)).toEqual(expect.arrayContaining(["auth.email", "auth.password"]));
  });

  it("toggles the password between hidden and visible", () => {
    const { TextInput } = jest.requireActual("react-native");
    const secure = () => tree.root.findAllByType(TextInput)[1].props.secureTextEntry;
    expect(secure()).toBe(true);
    act(() => tree.root.findByProps({ accessibilityLabel: "auth.showPassword" }).props.onPress());
    expect(secure()).toBe(false);
    act(() => tree.root.findByProps({ accessibilityLabel: "auth.hidePassword" }).props.onPress());
    expect(secure()).toBe(true);
  });

  it("switches language before signing in", async () => {
    const { Pressable } = jest.requireActual("react-native");
    const english = tree.root
      .findAllByType(Pressable)
      .find((n) => allTexts(n).includes("settings.languageEn"))!;
    await act(async () => {
      await english.props.onPress();
    });
    expect(mockChangeLanguage).toHaveBeenCalledWith("en");
  });

  it("has no hard-coded text besides the language names", () => {
    // t() is mocked to echo the key, so every visible string must be a key.
    expect(hardcodedTexts(tree.root).filter((v) => !/^(auth|settings)\.\w+$/.test(v))).toEqual([]);
  });
});
