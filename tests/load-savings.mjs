import fs from "node:fs";
import path from "node:path";

export function loadSavings(file) {
  const product = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!product.splitTables) return product;
  const folder = file.replace(/\.json$/, "");
  product.tables = {};
  for (const name of fs.readdirSync(folder)) {
    if (!name.endsWith(".json")) continue;
    const part = JSON.parse(fs.readFileSync(path.join(folder, name), "utf8"));
    for (const [key, value] of Object.entries(part)) {
      product.tables[key] = { ...(product.tables[key] || {}), ...value };
    }
  }
  return product;
}
