"use client";

import { useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { Pack } from "../packs";
import { DOCUMENT_ORDER } from "../scan-events";
import { startPrescreen } from "../server/actions";
import { DOCUMENT_LABELS, DOCUMENT_SHORT_LABELS } from "./labels";
import { PageFrame } from "./page-frame";
import { pageImageUrl } from "./page-image";
import { PageImage } from "./page-image-loader";

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
  const [packSlug, setPackSlug] = useState(packs[0]?.slug ?? "");
  const [pageIndex, setPageIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const pack = packs.find((item) => item.slug === packSlug) ?? packs[0];
  const pages = pack ? pagesOf(pack) : [];
  const current = pages[Math.min(pageIndex, pages.length - 1)];
  // Pending only while the run page is loading: once the navigation settles
  // (or the router cache restores this page on back), the button is usable again.
  const [navigating, startNavigation] = useTransition();

  const start = useMutation({
    mutationFn: startPrescreen,
    onMutate: () => setNotice(null),
    onSuccess: (result) => {
      const base = "/demos/document-compliance/runs";
      if (result.status === "started") {
        startNavigation(() => router.push(`${base}/${result.runId}`));
      } else if (result.runId) {
        const href = `${base}/${result.runId}?replay=limited`;
        startNavigation(() => router.push(href));
      } else setNotice(result.message);
    },
    onError: (error) => setNotice(error.message),
  });
  const starting = start.isPending || navigating;

  // Warm the neighbouring pages so paging through the preview doesn't wait on
  // a signed redirect each time.
  const neighbours = [pages[pageIndex - 1], pages[pageIndex + 1]]
    .filter((page) => page !== undefined)
    .map((page) => (pack ? pageImageUrl(pack.slug, page.file) : ""))
    .join(" ");
  useEffect(() => {
    for (const src of neighbours.split(" ").filter(Boolean)) {
      new Image().src = src;
    }
  }, [neighbours]);

  function choose(slug: string) {
    setPackSlug(slug);
    setPageIndex(0);
  }

  return (
    <div className="grid gap-8 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-[minmax(0,1fr)]">
      <div className="flex flex-col gap-6 lg:min-h-0">
        <fieldset className="grid content-start gap-4 sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-rows-3 lg:content-stretch">
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
                <span className="relative flex h-24 items-end justify-center lg:h-auto lg:min-h-0 lg:flex-1">
                  {pagesOf(item).map((page, index, all) => {
                    const offset = index - (all.length - 1) / 2;
                    return (
                      <PageImage
                        key={`${page.kind}-${page.page}`}
                        src={pageImageUrl(item.slug, page.file)}
                        alt=""
                        compact
                        style={{
                          transform: `translateX(${offset * 38}%) rotate(${offset * 6}deg)`,
                          zIndex: 10 - Math.abs(Math.round(offset)),
                        }}
                        className="absolute bottom-0 aspect-[3/4] h-full overflow-hidden rounded-[1px] border border-ink bg-paper shadow-hard-sm transition-transform duration-300 group-hover:-translate-y-1"
                        imageClassName="size-full object-cover object-top"
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
        <button
          type="button"
          data-testid="run-prescreen"
          disabled={!pack || starting}
          onClick={() => pack && start.mutate(pack.slug)}
          className="outline-box press group/run flex min-h-14 items-center justify-center gap-3 rounded-sm bg-federal-blue px-6 font-mono text-base font-bold tracking-[0.1em] text-paper uppercase disabled:cursor-wait disabled:opacity-80"
        >
          {starting ? (
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
      </div>

      {pack && current ? (
        <section
          aria-label={`${pack.title} preview`}
          data-testid="pack-preview"
          className="flex flex-col gap-4 lg:min-h-0"
        >
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
          <PageFrame
            src={pageImageUrl(pack.slug, current.file)}
            alt={`${pack.title}: ${DOCUMENT_LABELS[current.kind]}, page ${current.page}`}
            hasPrevious={pageIndex > 0}
            hasNext={pageIndex < pages.length - 1}
            onPrevious={() => setPageIndex((index) => index - 1)}
            onNext={() => setPageIndex((index) => index + 1)}
          />
        </section>
      ) : null}
    </div>
  );
}
