import fs from "fs";
import path from "path";

// UX X5: nothing below 13 pt in the screens or the components. A literal
// `fontSize: 12` is the only thing this can see; sizes computed at run time
// are clamped where they are computed (ProductGrid's price).
const MIN = 13;
const ROOT = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("minimum font size", () => {
  it("has no fontSize below 13 in app/ or src/components/", () => {
    const small: string[] = [];
    for (const file of [
      ...files(path.join(ROOT, "app")),
      ...files(path.join(ROOT, "src/components")),
    ]) {
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const match of line.matchAll(/fontSize\s*:\s*(\d+(?:\.\d+)?)/g)) {
            if (Number(match[1]) < MIN) {
              small.push(`${path.relative(ROOT, file)}:${index + 1}: fontSize ${match[1]}`);
            }
          }
        });
    }
    expect(small).toEqual([]);
  });
});
