"use client";

import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Pack } from "../packs";
import { DOCUMENT_ORDER } from "../scan-events";
import { startPrescreen } from "../server/actions";
import { DOCUMENT_LABELS, DOCUMENT_SHORT_LABELS } from "./labels";
import { pageImageUrl } from "./page-image";

export type PackSummary = Pick<Pack, "slug" | "title" | "documents">;

/** Every page of a pack in display order: what the preview pages through. */
function pagesOf(pack: PackSummary) {
  return DOCUMENT_ORDER.flatMap((kind) => {
    const document = pack.documents.find((item) => item.kind === kind);
    return (
      document?.pages.map((file, index) => ({
        kind,
        file,
        page: index + 1,
        pageCount: document.pages.length,
      })) ?? []
    );
  });
}

export function PackPicker({ packs }: { packs: PackSummary[] }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion() ?? false;
  const [packSlug, setPackSlug] = useState(packs[0]?.slug ?? "");
  const [pageIndex, setPageIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const pack = packs.find((item) => item.slug === packSlug) ?? packs[0];
  const pages = pack ? pagesOf(pack) : [];
  const current = pages[Math.min(pageIndex, pages.length - 1)];

  const start = useMutation({
    mutationFn: startPrescreen,
    onMutate: () => setNotice(null),
    onSuccess: (result) => {
      const base = "/demos/document-compliance/runs";
      if (result.status === "started") router.push(`${base}/${result.runId}`);
      else if (result.runId) {
        router.push(`${base}/${result.runId}?replay=limited`);
      } else setNotice(result.message);
    },
    onError: (error) => setNotice(error.message),
  });

  function choose(slug: string) {
    setPackSlug(slug);
    setPageIndex(0);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <fieldset className="grid content-start gap-4 sm:grid-cols-2">
        <legend className="sr-only">Document pack</legend>
        {packs.map((item) => {
          const selected = item.slug === packSlug;
          return (
            <label
              key={item.slug}
              data-testid={`pack-option-${item.slug}`}
              className={`outline-box group flex cursor-pointer flex-col gap-3 rounded-sm p-3 transition-[translate,box-shadow,background-color] duration-150 has-focus-visible:outline-2 has-focus-visible:outline-federal-blue has-focus-visible:outline-offset-3 ${
                selected
                  ? "-translate-x-0.5 -translate-y-0.5 bg-morning-haze shadow-hard-hover"
                  : "bg-paper shadow-hard-sm hover:shadow-hard-md"
              }`}
            >
              <input
                type="radio"
                name="pack"
                value={item.slug}
                checked={selected}
                onChange={() => choose(item.slug)}
                className="sr-only"
              />
              <span className="relative flex h-24 items-end justify-center">
                {pagesOf(item).map((page, index, all) => {
                  const offset = index - (all.length - 1) / 2;
                  return (
                    // biome-ignore lint/performance/noImgElement: signed Storage redirect thumbnail
                    <img
                      key={`${page.kind}-${page.page}`}
                      src={pageImageUrl(item.slug, page.file)}
                      alt=""
                      style={{
                        transform: `translateX(${offset * 38}%) rotate(${offset * 6}deg)`,
                        zIndex: 10 - Math.abs(Math.round(offset)),
                      }}
                      className="absolute bottom-0 aspect-[3/4] h-full rounded-[1px] border border-ink bg-paper object-cover object-top shadow-hard-sm transition-transform duration-300 group-hover:-translate-y-1"
                    />
                  );
                })}
              </span>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`grid size-4 shrink-0 place-items-center rounded-full border-2 border-ink ${
                    selected ? "bg-federal-blue" : "bg-paper"
                  }`}
                >
                  {selected ? (
                    <span className="size-1.5 rounded-full bg-paper" />
                  ) : null}
                </span>
                <span className="font-mono text-sm font-bold uppercase">
                  {item.title}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {pack && current ? (
        <section
          aria-label={`${pack.title} preview`}
          data-testid="pack-preview"
          className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start"
        >
          <div className="outline-box relative overflow-hidden rounded-sm bg-limestone shadow-hard-lg">
            <div className="relative grid aspect-[4/3] place-items-center p-4 sm:p-6">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.img
                  key={`${pack.slug}-${current.file}`}
                  src={pageImageUrl(pack.slug, current.file)}
                  alt={`${pack.title}: ${DOCUMENT_LABELS[current.kind]}, page ${current.page}`}
                  initial={
                    reduceMotion ? false : { opacity: 0, x: 80, rotate: 3 }
                  }
                  animate={{ opacity: 1, x: 0, rotate: 0 }}
                  exit={
                    reduceMotion
                      ? undefined
                      : { opacity: 0, x: -80, rotate: -3 }
                  }
                  transition={{ type: "spring", stiffness: 260, damping: 28 }}
                  className="max-h-full max-w-full rounded-[1px] border-2 border-ink bg-paper object-contain shadow-hard-md"
                />
              </AnimatePresence>
              <PreviewArrow
                side="left"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((index) => index - 1)}
              />
              <PreviewArrow
                side="right"
                disabled={pageIndex >= pages.length - 1}
                onClick={() => setPageIndex((index) => index + 1)}
              />
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Pages"
            className="flex flex-wrap gap-2"
          >
            {pages.map((page, index) => (
              <button
                key={`${page.kind}-${page.page}`}
                type="button"
                role="tab"
                aria-selected={index === pageIndex}
                onClick={() => setPageIndex(index)}
                className={`outline-box eyebrow rounded-sm px-3 py-2 ${
                  index === pageIndex ? "bg-ink text-paper" : "bg-paper"
                }`}
              >
                {DOCUMENT_SHORT_LABELS[page.kind]}
                {page.pageCount > 1 ? ` · ${page.page}` : ""}
              </button>
            ))}
          </div>

          <button
            type="button"
            data-testid="run-prescreen"
            disabled={start.isPending || start.isSuccess}
            onClick={() => start.mutate(pack.slug)}
            className="outline-box press group/run flex min-h-14 items-center justify-center gap-3 rounded-sm bg-federal-blue px-6 font-mono text-base font-bold tracking-[0.1em] text-paper uppercase disabled:cursor-wait disabled:opacity-80"
          >
            {start.isPending || start.isSuccess ? (
              <>
                <motion.span
                  aria-hidden
                  className="size-4 rounded-full border-2 border-paper border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 0.8,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "linear",
                  }}
                />
                Starting
              </>
            ) : (
              <>
                Run Pre-screen
                <span
                  aria-hidden
                  className="transition-transform group-hover/run:translate-x-1"
                >
                  ▸
                </span>
              </>
            )}
          </button>

          {notice ? (
            <p
              role="alert"
              data-testid="run-notice"
              className="outline-box rounded-sm bg-limestone px-4 py-3"
            >
              {notice}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function PreviewArrow({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous page" : "Next page"}
      disabled={disabled}
      onClick={onClick}
      className={`outline-box absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-paper font-mono font-bold shadow-hard-sm transition-colors hover:bg-morning-haze focus-visible:outline-2 focus-visible:outline-federal-blue disabled:pointer-events-none disabled:opacity-0 ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      {side === "left" ? "◂" : "▸"}
    </button>
  );
}
