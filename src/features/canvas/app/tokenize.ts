/**
 * A tiny tokenizer for Show the work: it marks keywords, strings, comments
 * and `$parameters` in SQL or Python, and nothing else. Pure.
 */

export type TokenKind = "kw" | "st" | "cm" | "pm" | "";
export type Token = { text: string; kind: TokenKind };

const words = (text: string) => new Set(text.split(" "));

const SQL = words(
  "select from where group by order having limit offset join left right inner outer full cross on as and or not in is null case when then else end with union all distinct between like ilike asc desc over partition rows range preceding following unbounded current row using exists cast interval true false qualify filter within lateral values except intersect",
);
const PYTHON = words(
  "def return for in if elif else while import from as and or not is None True False lambda with try except finally raise class pass break continue yield",
);

const PATTERN = {
  sql: /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|(\$[a-z][a-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*)/g,
  python:
    /(#[^\n]*)|("""[\s\S]*?"""|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|(\$[a-z][a-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*)/g,
};

export function tokenize(text: string, language: "sql" | "python"): Token[] {
  const tokens: Token[] = [];
  const push = (part: string, kind: TokenKind) => {
    if (!part) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind && kind === "") last.text += part;
    else tokens.push({ text: part, kind });
  };
  const keywords = language === "sql" ? SQL : PYTHON;
  const pattern = new RegExp(PATTERN[language].source, "g");
  let at = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    push(text.slice(at, match.index), "");
    const [whole, comment, string, param, word] = match;
    if (comment) push(whole, "cm");
    else if (string) push(whole, "st");
    else if (param) push(whole, "pm");
    else if (word)
      push(
        whole,
        keywords.has(language === "sql" ? whole.toLowerCase() : whole)
          ? "kw"
          : "",
      );
    at = match.index + whole.length;
  }
  push(text.slice(at), "");
  return tokens;
}
