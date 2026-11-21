import qrcode from "qrcode-generator";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import Svg, { Path } from "react-native-svg";

import { CardQr, qrMatrix, qrPath } from "../../src/components/loyalty/CardQr";

const URL = "https://shop.example/card/AbCdEfGhIjKlMnOpQrStUv";
let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

it("the matrix has as many modules as the library says, and is square", () => {
  const reference = qrcode(0, "M");
  reference.addData(URL);
  reference.make();
  const matrix = qrMatrix(URL);
  expect(matrix).toHaveLength(reference.getModuleCount());
  expect(matrix.every((row) => row.length === reference.getModuleCount())).toBe(true);
  // Same dark modules as the library.
  expect(matrix[0].map(Boolean)).toEqual(
    Array.from({ length: matrix.length }, (_c, x) => reference.isDark(0, x))
  );
});

it("the three finder squares are dark in their corners", () => {
  const matrix = qrMatrix(URL);
  const last = matrix.length - 1;
  expect(matrix[0][0]).toBe(true);
  expect(matrix[0][last]).toBe(true);
  expect(matrix[last][0]).toBe(true);
});

it("the path draws exactly the dark modules, merged into runs", () => {
  const matrix = [
    [true, true, false],
    [false, true, false],
    [true, false, true],
  ];
  expect(qrPath(matrix, 0)).toBe("M0 0h2v1h-2zM1 1h1v1h-1zM0 2h1v1h-1zM2 2h1v1h-1z");
  expect(qrPath(matrix, 4).startsWith("M4 4h2v1h-2z")).toBe(true);
});

it("renders one Path in a viewBox of the matrix plus its quiet zone", async () => {
  await act(async () => {
    tree = create(<CardQr value={URL} size={200} label="QR" />);
  });
  const size = qrMatrix(URL).length;
  const svg = tree.root.findByType(Svg);
  expect(svg.props.viewBox).toBe(`0 0 ${size + 8} ${size + 8}`);
  expect(svg.props.width).toBe(200);
  expect(tree.root.findAllByType(Path)).toHaveLength(1);
  expect(tree.root.findByType(Path).props.fill).toBe("#000000");
});
