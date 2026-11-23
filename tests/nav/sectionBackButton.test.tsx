import React from "react";
import { act, create } from "react-test-renderer";

import { SectionBackButton } from "../../src/components/nav/SectionBackButton";
import { resetOrigin, trackLocation } from "../../src/lib/nav/origin";

let mockIndex = 0;
let mockRoute = "new";
let mockPathname = "/products/new";
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockRouterBack = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  router: {
    navigate: (to: unknown) => mockNavigate(to),
    back: () => mockRouterBack(),
    replace: (to: unknown) => mockReplace(to),
  },
  useNavigation: () => ({ getState: () => ({ index: mockIndex }), goBack: () => mockGoBack() }),
  usePathname: () => mockPathname,
}));
jest.mock("@react-navigation/native", () => ({ useRoute: () => ({ name: mockRoute }) }));
jest.mock("@react-navigation/elements", () => ({
  HeaderBackButton: (p: object) => require("react").createElement("HeaderBackButton", p),
}));

const render = () => {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<SectionBackButton tintColor="#123" />);
  });
  return tree;
};
const button = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType("HeaderBackButton" as never)[0];

beforeEach(() => {
  jest.clearAllMocks();
  resetOrigin();
  mockIndex = 0;
  mockRoute = "new";
  mockPathname = "/products/new";
});

it("in its own stack: goBack, like today", () => {
  mockIndex = 1;
  trackLocation("/competitors?tab=sourcing");
  trackLocation("/products/abc");
  const b = button(render());
  expect(b.props.tintColor).toBe("#123");
  act(() => b.props.onPress());
  expect(mockGoBack).toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it("alone in its stack with an origin: opens the exact place it came from, in one step", () => {
  trackLocation("/competitors?tab=sourcing");
  trackLocation("/products/new");
  const b = button(render());
  act(() => b.props.onPress());
  // `r` makes the screen reload its list.
  expect(mockReplace).toHaveBeenCalledWith(
    expect.stringMatching(/^\/competitors\?tab=sourcing&r=\d+$/)
  );
  expect(mockRouterBack).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockGoBack).not.toHaveBeenCalled();
});

it("alone in its stack without an origin: goes to the section root", () => {
  mockPathname = "/stock-in/negative-stock";
  const b = button(render());
  act(() => b.props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith({ pathname: "/(app)/stock-in", params: {} });
});

it("the root screen shows nothing", () => {
  mockRoute = "index";
  mockPathname = "/competitors";
  expect(button(render())).toBeUndefined();
});

it("appears when the origin is recorded after the first render", () => {
  mockPathname = "/competitors/p1";
  const tree = render();
  act(() => {
    trackLocation("/products/p1");
    trackLocation("/competitors/p1");
  });
  expect(button(tree)).toBeDefined();
});
