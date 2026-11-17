"use client";

import { type MouseEvent, type ReactNode, useMemo } from "react";
import {
  type Align,
  type Block,
  type Inline,
  inlineText,
  parseMarkdown,
  slugOf,
} from "../domain/markdown";

type LinkHandler = (href: string) => boolean;

const ALIGN: Record<NonNullable<Align>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const HEADING = {
  1: "mt-6 mb-2 font-mono text-lg font-bold tracking-[0.02em] first:mt-0",
  2: "mt-6 mb-2 font-mono text-base font-bold tracking-[0.02em] first:mt-0",
  3: "mt-4 mb-1.5 text-sm font-bold first:mt-0",
  4: "mt-4 mb-1 text-sm font-semibold first:mt-0",
  5: "mt-3 mb-1 text-sm font-semibold text-ink-muted first:mt-0",
  6: "mt-3 mb-1 text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase first:mt-0",
} as const;

/** Draws each item with a key from its place: the tree is parsed fresh from the text, so order is identity. */
function each<T>(
  items: T[],
  draw: (item: T, key: string, index: number) => ReactNode,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (let index = 0; index < items.length; index++) {
    nodes.push(draw(items[index] as T, String(index), index));
  }
  return nodes;
}

function renderInline(inlines: Inline[], onLink?: LinkHandler): ReactNode[] {
  return each(inlines, (inline, key) => {
    switch (inline.type) {
      case "text":
        return inline.text;
      case "break":
        return <br key={key} />;
      case "code":
        return (
          <code
            key={key}
            className="rounded-sm border border-ink/10 bg-marble px-1 py-px font-mono text-[0.85em] [overflow-wrap:anywhere]"
          >
            {inline.text}
          </code>
        );
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            {renderInline(inline.children, onLink)}
          </strong>
        );
      case "em":
        return <em key={key}>{renderInline(inline.children, onLink)}</em>;
      case "link": {
        const outside = /^https?:/i.test(inline.href);
        return (
          <a
            key={key}
            href={inline.href}
            {...(outside
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              if (onLink?.(inline.href)) event.preventDefault();
            }}
            className="text-federal-blue underline decoration-federal-blue/40 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-federal-blue"
          >
            {renderInline(inline.children, onLink)}
          </a>
        );
      }
    }
  });
}

function renderBlocks(
  blocks: Block[],
  options: {
    onLink?: LinkHandler;
    anchors: boolean;
    seen: Map<string, number>;
  },
): ReactNode[] {
  return each(blocks, (block, key) => {
    switch (block.type) {
      case "heading": {
        const Tag = `h${block.level}` as "h1";
        let id: string | undefined;
        if (options.anchors) {
          const base = slugOf(inlineText(block.children)) || "section";
          const count = options.seen.get(base) ?? 0;
          options.seen.set(base, count + 1);
          id = count === 0 ? base : `${base}-${count + 1}`;
        }
        return (
          <Tag
            key={key}
            id={id}
            className={`${HEADING[block.level]} scroll-mt-4`}
          >
            {renderInline(block.children, options.onLink)}
          </Tag>
        );
      }
      case "paragraph":
        return (
          <p key={key} className="my-2 first:mt-0 last:mb-0">
            {renderInline(block.children, options.onLink)}
          </p>
        );
      case "code":
        return (
          <pre
            key={key}
            data-lang={block.lang ?? undefined}
            className="my-3 overflow-x-auto rounded-sm border border-ink/15 bg-ink p-3 font-mono text-xs leading-relaxed text-paper first:mt-0 last:mb-0"
          >
            <code>{block.text}</code>
          </pre>
        );
      case "quote":
        return (
          <blockquote
            key={key}
            className="my-3 border-brass border-l-4 bg-marble/60 py-1.5 pr-3 pl-3 text-ink-muted first:mt-0 last:mb-0"
          >
            {renderBlocks(block.children, options)}
          </blockquote>
        );
      case "rule":
        return <hr key={key} className="my-4 border-ink/15" />;
      case "list": {
        const items = each(block.items, (item, itemKey) => (
          <li key={itemKey} className="my-1 pl-1 marker:text-ink-muted">
            {renderBlocks(item, options)}
          </li>
        ));
        return block.ordered ? (
          <ol
            key={key}
            start={block.start}
            className="my-2 list-decimal pl-6 first:mt-0 last:mb-0"
          >
            {items}
          </ol>
        ) : (
          <ul key={key} className="my-2 list-disc pl-6 first:mt-0 last:mb-0">
            {items}
          </ul>
        );
      }
      case "table":
        return (
          <div key={key} className="hx-table-wrap my-3 first:mt-0 last:mb-0">
            <table className="w-full border-collapse text-left text-[0.92em]">
              <thead className="bg-marble">
                <tr>
                  {each(block.head, (cell, cellKey, index) => (
                    <th
                      key={cellKey}
                      scope="col"
                      className={`border-ink/15 border-b px-2.5 py-1.5 font-semibold ${ALIGN[block.align[index] ?? "left"]}`}
                    >
                      {renderInline(cell, options.onLink)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {each(block.rows, (row, rowKey) => (
                  <tr
                    key={rowKey}
                    className="border-ink/10 border-b last:border-b-0"
                  >
                    {each(row, (cell, cellKey, index) => (
                      <td
                        key={cellKey}
                        className={`px-2.5 py-1.5 align-top ${ALIGN[block.align[index] ?? "left"]}`}
                      >
                        {renderInline(cell, options.onLink)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/**
 * Draws Markdown as React elements: headings, paragraphs, lists, tables,
 * code, quotes, links, bold and italic. Nothing is set as HTML, so text from
 * a model or an uploaded document cannot inject markup. The chat, the Docs
 * tab, Skills and Drafts all use this one.
 */
export function Markdown({
  text,
  className = "",
  anchors = false,
  onLink,
}: {
  text: string;
  className?: string;
  /** Give headings ids (their words, hyphenated) so a table of contents can link to them. */
  anchors?: boolean;
  /** Called with a link's address when it is clicked; return true to handle it yourself (an in-app deep link). */
  onLink?: LinkHandler;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div
      className={`text-sm leading-relaxed [overflow-wrap:anywhere] ${className}`}
    >
      {renderBlocks(blocks, { onLink, anchors, seen: new Map() })}
    </div>
  );
}
