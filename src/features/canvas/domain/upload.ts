/**
 * The Table name an Upload gets in its Owner's Catalog: `up_` and a safe
 * form of the file's name, made unique among the Owner's Uploads. The file's
 * own name never reaches SQL or a path.
 */
export function uploadTableName(fileName: string, taken: ReadonlySet<string>) {
  const stem = fileName
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const base = `up_${stem || "file"}`;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const name = `${base.slice(0, 44)}_${n}`;
    if (!taken.has(name)) return name;
  }
  throw new Error("No free Table name for this Upload.");
}
