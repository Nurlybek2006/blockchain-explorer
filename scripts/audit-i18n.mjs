import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(resolve(root, "apps/web/package.json"))("typescript");
const directory = resolve(root, "apps/web/src");
const permitted = new Set([
  "Blockchain Explorer",
  "BLOCKCHAIN EXPLORER / V1",
  "Blockchain",
  "Explorer",
  "Ethereum",
  "Ethereum Sepolia",
  "Sepolia",
  "ERC-20",
  "ABI",
  "JSON",
  "JSON-RPC",
  "ETH",
  "USD",
  "Gas",
  "Gwei",
  "wei",
  "UTC",
  "CALL",
  "DELEGATECALL",
  "STATICCALL",
  "CREATE",
  "CREATE2",
  "24H",
  "7D",
  "30D",
  "90D",
  "P&L",
]);
const attributes = new Set([
  "title",
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "placeholder",
  "alt",
  "label",
  "description",
  "eyebrow",
  "note",
]);
const findings = [];

async function files(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory())
      result.push(...(await files(resolve(path, entry.name))));
    else if (
      /\.tsx$/.test(entry.name) &&
      !/\.(spec|test)\.tsx$/.test(entry.name)
    )
      result.push(resolve(path, entry.name));
  }
  return result;
}
function untranslated(text) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!/[A-Za-z]{2,}/.test(normalized) || permitted.has(normalized))
    return false;
  if (/^0x[\da-f]*$/i.test(normalized) || /^[^\s]+@[^\s]+$/.test(normalized))
    return false;
  return true;
}
for (const file of await files(directory)) {
  const source = ts.createSourceFile(
    file,
    await readFile(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const report = (node, text) => {
    if (!untranslated(text)) return;
    const position = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    findings.push(
      `${file.slice(root.length + 1).replaceAll("\\", "/")}:${position.line + 1}: ${text.trim()}`,
    );
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) report(node, node.text);
    if (
      ts.isJsxAttribute(node) &&
      attributes.has(node.name.getText(source)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    )
      report(node, node.initializer.text);
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isStringLiteral(node.expression)
    )
      report(node, node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Localization UI literal audit passed; no untranslated JSX text or presentation attributes. Technical names and raw data are preserved.",
  );
