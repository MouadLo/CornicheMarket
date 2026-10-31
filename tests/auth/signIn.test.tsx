/**
 * Enter did nothing on web (no onSubmitEditing wired), and a failed sign-in
 * showed Supabase's raw English message regardless of app language. These
 * pin both fixes.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SignIn from "../../app/sign-in";

const mockSignIn = jest.fn(async (..._args: unknown[]) => ({ error: null as string | null }));

const mockT = (key: string) => key;
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
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
  const inputs = tree.root.findAllByProps({ placeholder: "auth.email" });
  const passwordInputs = tree.root.findAllByProps({ placeholder: "auth.password" });
  act(() => inputs[0].props.onChangeText(email));
  act(() => passwordInputs[0].props.onChangeText(password));
}

describe("sign-in", () => {
  it("submits on Enter in the password field, not just the button", async () => {
    fillCredentials("owner@corniche.local", "owner123");
    const passwordInput = tree.root.findAllByProps({ placeholder: "auth.password" })[0];

    await act(async () => {
      passwordInput.props.onSubmitEditing();
    });

    expect(mockSignIn).toHaveBeenCalledWith("owner@corniche.local", "owner123");
  });

  it("translates 'Invalid login credentials' instead of showing it raw", async () => {
    mockSignIn.mockResolvedValue({ error: "Invalid login credentials" });
    fillCredentials("owner@corniche.local", "wrong");

    await act(async () => {
      tree.root.findAllByProps({ placeholder: "auth.password" })[0].props.onSubmitEditing();
    });

    const { Text } = jest.requireActual("react-native");
    const texts = tree.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts).toContain("auth.invalidCredentials");
    expect(texts).not.toContain("Invalid login credentials");
  });

  it("falls back to a generic translated message for any other failure", async () => {
    mockSignIn.mockResolvedValue({ error: "TypeError: Failed to fetch" });
    fillCredentials("owner@corniche.local", "owner123");

    await act(async () => {
      tree.root.findAllByProps({ placeholder: "auth.password" })[0].props.onSubmitEditing();
    });

    const { Text } = jest.requireActual("react-native");
    const texts = tree.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts).toContain("auth.signInError");
  });

  it("does not submit with an empty field", async () => {
    fillCredentials("owner@corniche.local", "");
    await act(async () => {
      tree.root.findAllByProps({ placeholder: "auth.password" })[0].props.onSubmitEditing();
    });

    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
