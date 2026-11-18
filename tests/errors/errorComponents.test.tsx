import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { InlineError } from "../../src/components/ui/InlineError";
import { LoadError } from "../../src/components/ui/LoadError";
import ar from "../../src/i18n/ar";
import en from "../../src/i18n/en";
import fr from "../../src/i18n/fr";
import { ERROR_KEYS } from "../../src/lib/errors/userMessage";
import { allTexts, pressableByText } from "../sales/sellTestUtils";

jest.mock("react-i18next", () => {
  const t = (key: string) => key;
  const value = { t, i18n: { language: "fr" } };
  return { useTranslation: () => value };
});
jest.mock("lucide-react-native", () => {
  const React = require("react");
  return new Proxy(
    {},
    { get: (_t, name) => (p: object) => React.createElement("Icon", { name, ...p }) }
  );
});

let tree: ReactTestRenderer;
afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = undefined as never;
});

const lookup = (dict: unknown, key: string) =>
  key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dict);

describe("every key the mapper can return is translated", () => {
  it.each(Object.values(ERROR_KEYS))("%s", (key) => {
    for (const dict of [fr, en, ar]) {
      expect(typeof lookup(dict, key)).toBe("string");
      expect((lookup(dict, key) as string).length).toBeGreaterThan(5);
    }
  });
  it.each(["errors.tryAgainOnline", "errors.offlineExplain", "errors.countsOffline"])(
    "%s",
    (key) => {
      for (const dict of [fr, en, ar]) expect(typeof lookup(dict, key)).toBe("string");
    }
  );
});

describe("LoadError", () => {
  it("says what failed, why, and offers Retry", () => {
    const onRetry = jest.fn();
    act(() => {
      tree = create(
        <LoadError title="Could not load" reasonKey={ERROR_KEYS.permission} onRetry={onRetry} />
      );
    });
    expect(allTexts(tree.root)).toEqual(
      expect.arrayContaining(["Could not load", ERROR_KEYS.permission, "common.retry"])
    );
    act(() => pressableByText(tree.root, "common.retry").props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("explains the offline case when the failure is the network", () => {
    act(() => {
      tree = create(<LoadError title="x" reasonKey={ERROR_KEYS.network} onRetry={() => {}} />);
    });
    const text = allTexts(tree.root).join(" ");
    expect(text).toContain(ERROR_KEYS.network);
    expect(text).toContain("errors.offlineExplain");
  });

  it("does not claim offline for other failures", () => {
    act(() => {
      tree = create(<LoadError title="x" reasonKey={ERROR_KEYS.generic} onRetry={() => {}} />);
    });
    expect(allTexts(tree.root).join(" ")).not.toContain("errors.offlineExplain");
  });
});

describe("InlineError", () => {
  it("shows the translated reason as an alert", () => {
    act(() => {
      tree = create(<InlineError reasonKey={ERROR_KEYS.duplicateBarcode} />);
    });
    expect(allTexts(tree.root)).toContain(ERROR_KEYS.duplicateBarcode);
    expect(tree.root.findAll((n) => n.props.accessibilityRole === "alert").length).toBeGreaterThan(
      0
    );
  });

  it("tells the person their entry is kept when the network is down", () => {
    act(() => {
      tree = create(<InlineError reasonKey={ERROR_KEYS.network} />);
    });
    expect(allTexts(tree.root).join(" ")).toContain("errors.tryAgainOnline");
  });
});
