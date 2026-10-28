// Audit copy of the existing cloud test, with only obsolete UI locators updated.
// Original test and all product sources remain untouched.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const sourceURL = new URL("./test-cloud.mjs", import.meta.url);
const original = readFileSync(sourceURL, "utf8");
const replacements = [
  ['name: "生活里，值得留住的小片段"', 'name: "生活故事书"'],
  [
    'page.getByRole("heading", { name: story.text, exact: true })',
    "page.getByText(story.text, { exact: true })",
  ],
];
let updated = original;
for (const [from, to] of replacements) {
  if (!updated.includes(from))
    throw Error("Source locator changed; review audit patch");
  updated = updated.replaceAll(from, to);
}
updated = updated.replaceAll("import.meta.url", JSON.stringify(sourceURL.href));
updated = updated.replace(
  "const page = await browser.newPage({",
  "const browserErrors=[];\n    const page = await browser.newPage({",
);
updated = updated.replace(
  'await page.goto(base + "/#stories");',
  'page.on("pageerror",e=>browserErrors.push(e.message));\n    await page.goto(base + "/#stories");',
);
updated = updated.replace(
  'await page.goto(base + "/legacy");',
  'await page.screenshot({path:".runtime/audit-20261029/cloud-story.png",fullPage:true});\n    assert.deepEqual(browserErrors,[]);\n    await page.goto(base + "/legacy");',
);
const folder = new URL("../.runtime/audit-20261029/", import.meta.url);
mkdirSync(folder, { recursive: true });
writeFileSync(
  new URL("cloud-test-adaptation.json", folder),
  JSON.stringify(
    {
      source: "scripts/test-cloud.mjs",
      sha256: createHash("sha256").update(original).digest("hex"),
      replacements,
      additional:
        "Capture public story screenshot and pageerror; original assertions otherwise retained",
      realModelCalls: 0,
    },
    null,
    2,
  ),
);
const generated = new URL("cloud-test.generated.mjs", folder);
writeFileSync(generated, updated);
const result = spawnSync(process.execPath, [fileURLToPath(generated)], {
  stdio: "inherit",
  windowsHide: true,
});
process.exitCode = result.status ?? 1;
