/**
 * Writes a page's Markdown in a template literal. Backticks are awkward
 * there, so a page writes `§` where it means a backtick: `§code§` and
 * `§§§bash` for a fence. Backslashes stay as written.
 */
export function md(
  strings: TemplateStringsArray,
  ...values: (string | number)[]
): string {
  let text = strings.raw[0] ?? "";
  values.forEach((value, index) => {
    text += String(value) + (strings.raw[index + 1] ?? "");
  });
  return text.replaceAll("§", "`").trim();
}
