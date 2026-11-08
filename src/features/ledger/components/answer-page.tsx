"use client";

import { motion } from "motion/react";
import type { Layout } from "../domain/build-plan";
import { BlockView } from "./block-view";
import type { PlacedBlock } from "./placed-block";

type AnswerPageProps = {
  question: string;
  title: string;
  layout: Layout;
  blocks: PlacedBlock[];
  /** Plays the gold sweep under the title, once, as Reform finishes. */
  sweep: boolean;
};

/** The page Reform makes: the placed blocks, laid out to read as one answer. */
export function AnswerPage({
  question,
  title,
  layout,
  blocks,
  sweep,
}: AnswerPageProps) {
  const contact = blocks.filter((item) => item.block.kind === "contact");
  const body = blocks.filter((item) => item.block.kind !== "contact");
  const figures = body.filter((item) => item.block.kind === "figure");
  const rest = body.filter((item) => item.block.kind !== "figure");

  return (
    <article
      data-testid="answer-page"
      data-layout={layout}
      aria-labelledby="answer-title"
      className="mx-auto max-w-6xl px-4 py-12 sm:px-6"
    >
      <p className="eyebrow text-ink-muted">
        Ledger rebuilt this for: {question}
      </p>
      <h1
        id="answer-title"
        className="mt-3 font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-5xl"
      >
        <span className={sweep ? "ldg-sweep" : undefined}>{title}</span>
      </h1>

      <div className="mt-10">
        {layout === "timeline" ? (
          <ol className="relative space-y-6 border-ink border-l-2 pl-6">
            {body.map((item) => (
              <Item key={item.id} item={item} dot />
            ))}
          </ol>
        ) : layout === "steps" ? (
          <ol className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {body.map((item, index) => (
              <Item key={item.id} item={item} step={index + 1} />
            ))}
          </ol>
        ) : layout === "cards" ? (
          <Grid items={body} columns="md:grid-cols-2 lg:grid-cols-3" />
        ) : (
          // figures and mixed: the headline numbers first, then what backs them up.
          <div className="space-y-6">
            <Grid items={figures} columns="sm:grid-cols-2 lg:grid-cols-3" />
            <Grid
              items={rest}
              columns={
                layout === "figures"
                  ? "md:grid-cols-2"
                  : "md:grid-cols-2 lg:grid-cols-3"
              }
            />
          </div>
        )}
        {contact.length > 0 ? (
          <div className="mt-6">
            <Grid items={contact} columns="" />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Grid({ items, columns }: { items: PlacedBlock[]; columns: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={`grid gap-6 ${columns}`}>
      {items.map((item) => (
        <Item key={item.id} item={item} />
      ))}
    </ul>
  );
}

function Item({
  item,
  dot,
  step,
}: {
  item: PlacedBlock;
  dot?: boolean;
  step?: number;
}) {
  return (
    <motion.li
      layoutId={item.id}
      data-testid="answer-block"
      data-source={item.source}
      data-excerpt={item.excerpt ?? undefined}
      data-kind={item.block.kind}
      className="relative"
      transition={{ type: "spring", stiffness: 140, damping: 20 }}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="absolute top-6 -left-[1.95rem] size-3 border-2 border-ink bg-brass"
        />
      ) : null}
      {step ? (
        <p className="mb-2 font-mono text-4xl font-bold text-federal-blue">
          {String(step).padStart(2, "0")}
        </p>
      ) : null}
      <BlockView block={item.block} size="full" />
    </motion.li>
  );
}
