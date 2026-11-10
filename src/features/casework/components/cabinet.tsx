"use client";

import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { SCENARIOS, type Scenario } from "../domain/case-file";
import { kindLabel } from "../domain/document-kinds";
import type { DocView, FolderView } from "../view";
import { FileGlyph, SCENARIO_LABELS, ScenarioGlyph } from "./glyphs";
import { filesFromDrop, hasFiles } from "./upload";

export const DRAG_TYPE = "application/x-casework-documents";

export type DraggedDocs = { ids: string[]; names: string[] };

export function setDragDocs(event: DragEvent, docs: DocView[]) {
  const payload: DraggedDocs = {
    ids: docs.map((doc) => doc.id),
    names: docs.map((doc) => doc.name),
  };
  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "copy";
}

export function readDragDocs(event: DragEvent): DraggedDocs | null {
  const raw = event.dataTransfer.getData(DRAG_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DraggedDocs;
  } catch {
    return null;
  }
}

/** One colour per scenario, carried from the Cabinet to the pipeline view. */
export const SCENARIO_TONE: Record<
  Scenario,
  { bar: string; soft: string; text: string }
> = {
  pension_withdrawal: {
    bar: "bg-federal-blue",
    soft: "bg-morning-haze",
    text: "text-federal-blue",
  },
  employer_onboarding: {
    bar: "bg-ivy",
    soft: "bg-ivy/10",
    text: "text-ivy",
  },
  structure_review: {
    bar: "bg-oak",
    soft: "bg-oak/10",
    text: "text-oak",
  },
  screening_review: {
    bar: "bg-seal-red",
    soft: "bg-seal-red/10",
    text: "text-seal-red",
  },
};

const SPLIT_LABEL = {
  train: "Train",
  validation: "Val",
  test: "Test",
} as const;

export type GroupBy = "scenario" | "name";

type CabinetProps = {
  folders: FolderView[];
  uploads: DocView[];
  /** Ids already in the composer's tray. */
  picked: Set<string>;
  onPick: (docs: DocView[]) => void;
  onOpen: (doc: DocView) => void;
  onUpload: (files: File[]) => void;
  /** "Uploading 2 of 5", or null when idle. */
  uploading: string | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onCollapse?: () => void;
  /** Documents a Run is asking for: opened to, scrolled to and ringed. */
  highlight?: Set<string>;
};

type Group = {
  key: string;
  title: string;
  /** Under the title: what the case is about, or which reviews name this party. */
  note: string;
  scenarios: Scenario[];
  split?: FolderView["split"];
  documents: DocView[];
};

function matches(words: string[], ...haystack: string[]) {
  const text = haystack.join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * The Cabinet: every Document as a thumbnail. Grouped by scenario and then by
 * case, or by the person or company each Document is about, to preview, drag
 * or add to the message.
 */
export function Cabinet(props: CabinetProps) {
  const { folders, uploads } = props;
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("scenario");
  const [closed, setClosed] = useState<Set<string>>(
    () => new Set(SCENARIOS.slice(1)),
  );
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // A Run asked for Documents that are on file: open their case and bring them into view.
  const wanted = props.highlight;
  useEffect(() => {
    const first = wanted ? [...wanted][0] : undefined;
    if (!first) return;
    const folder = folders.find((item) =>
      item.documents.some((doc) => doc.id === first),
    );
    setQuery("");
    setGroupBy("scenario");
    if (folder)
      setClosed((current) => {
        const next = new Set(current);
        next.delete(folder.scenario);
        return next;
      });
    const timer = setTimeout(() => {
      document
        .querySelector(`[data-doc="${first}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 350);
    return () => clearTimeout(timer);
  }, [wanted, folders]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const total = folders.reduce(
    (sum, folder) => sum + folder.documents.length,
    0,
  );

  /** Scenario, then the cases inside it. */
  const byScenario = useMemo(
    () =>
      SCENARIOS.map((scenario) => ({
        scenario,
        groups: folders
          .filter((folder) => folder.scenario === scenario)
          .map(
            (folder): Group => ({
              key: folder.slug,
              title: folder.title,
              note: folder.summary,
              scenarios: [scenario],
              split: folder.split,
              documents: folder.documents,
            }),
          ),
      })),
    [folders],
  );

  /** Every person and company, with each Document that is about them. */
  const byName = useMemo(() => {
    const groups = new Map<string, Group>();
    const add = (name: string, folder: FolderView, doc: DocView) => {
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const group = groups.get(key) ?? {
        key,
        title: name,
        note: "",
        scenarios: [],
        documents: [],
      };
      group.documents.push(doc);
      if (!group.scenarios.includes(folder.scenario))
        group.scenarios.push(folder.scenario);
      groups.set(key, group);
    };
    for (const folder of folders)
      for (const doc of folder.documents)
        for (const name of doc.entities.length
          ? doc.entities
          : ["No named party"])
          add(name, folder, doc);
    return [...groups.values()]
      .map((group) => ({
        ...group,
        note: group.scenarios
          .map((scenario) => SCENARIO_LABELS[scenario])
          .join(" · "),
      }))
      .sort(
        (a, b) =>
          Number(a.title === "No named party") -
            Number(b.title === "No named party") ||
          a.title.localeCompare(b.title),
      );
  }, [folders]);

  const filter = (group: Group): Group | null => {
    if (!searching) return group;
    if (matches(words, group.title, group.note)) return group;
    const documents = group.documents.filter((doc) =>
      matches(words, doc.name, kindLabel(doc.kind ?? ""), ...doc.entities),
    );
    return documents.length > 0 ? { ...group, documents } : null;
  };

  const toggle = (key: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section aria-label="Cabinet" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-ink border-b-2 bg-ink px-3 py-2.5 text-paper">
        <CabinetGlyph />
        <h2 className="font-mono text-sm font-bold tracking-[0.12em] uppercase">
          Cabinet
        </h2>
        <span className="ml-auto font-mono text-[11px] text-paper/70">
          {total + uploads.length} documents
        </span>
        {props.onCollapse ? (
          <button
            type="button"
            onClick={props.onCollapse}
            className="-mr-1 rounded-sm px-1.5 font-mono text-sm text-paper/70 hover:bg-paper/15 hover:text-paper"
            aria-label="Fold the Cabinet away"
            title="Fold the Cabinet away"
          >
            «
          </button>
        ) : null}
      </header>

      <div className="grid gap-2 border-ink/15 border-b bg-paper px-3 py-3">
        <label className="sr-only" htmlFor="cabinet-search">
          Search the Cabinet
        </label>
        <input
          id="cabinet-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people, companies, files"
          className="h-9 w-full rounded-sm border-2 border-ink/25 bg-marble/60 px-2.5 text-sm placeholder:text-stone focus:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
        />
        <div className="flex items-center gap-2">
          <span className="eyebrow text-ink-muted">Group by</span>
          <div className="flex overflow-hidden rounded-sm border-2 border-ink">
            {(
              [
                ["scenario", "Scenario"],
                ["name", "Name"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={groupBy === value}
                onClick={() => setGroupBy(value)}
                className={`px-2.5 py-1 font-mono text-[11px] font-bold tracking-[0.06em] uppercase transition-colors ${groupBy === value ? "bg-ink text-paper" : "bg-paper text-ink-muted hover:bg-marble"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="cw-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* Uploads: drop real files or whole folders here. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the buttons are the keyboard path */}
        <div
          className="cw-droppable mb-4 rounded-sm border-2 border-dashed border-ink/35 bg-paper/70 p-2.5"
          data-over={over}
          onDragOver={(event) => {
            if (hasFiles(event.dataTransfer)) {
              event.preventDefault();
              setOver(true);
            }
          }}
          onDragLeave={() => setOver(false)}
          onDrop={async (event) => {
            if (!hasFiles(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            setOver(false);
            const files = await filesFromDrop(event.dataTransfer);
            if (files.length) props.onUpload(files);
          }}
        >
          <div className="flex items-center gap-2">
            <p className="eyebrow font-bold">Your uploads</p>
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="eyebrow text-federal-blue underline disabled:opacity-50"
                disabled={Boolean(props.uploading)}
              >
                Files
              </button>
              <button
                type="button"
                onClick={() => folderInput.current?.click()}
                className="eyebrow text-federal-blue underline disabled:opacity-50"
                disabled={Boolean(props.uploading)}
              >
                Folder
              </button>
            </span>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.csv"
              className="hidden"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                if (files.length) props.onUpload(files);
                event.target.value = "";
              }}
            />
            <input
              ref={(element) => {
                folderInput.current = element;
                element?.setAttribute("webkitdirectory", "");
              }}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                if (files.length) props.onUpload(files);
                event.target.value = "";
              }}
            />
          </div>
          {props.uploading ? (
            <p className="mt-1 font-mono text-[11px] text-federal-blue">
              {props.uploading}
            </p>
          ) : uploads.length === 0 ? (
            <p className="mt-1 text-xs text-ink-muted">
              Drop files or whole folders anywhere on the desk. PDF, JPEG, PNG
              or CSV.
            </p>
          ) : null}
          {uploads.length > 0 ? (
            <Thumbs documents={uploads} {...props} />
          ) : null}
        </div>

        {groupBy === "scenario"
          ? byScenario.map(({ scenario, groups }) => {
              const shown = groups.flatMap((group) => filter(group) ?? []);
              if (searching && shown.length === 0) return null;
              const open = searching || !closed.has(scenario);
              const tone = SCENARIO_TONE[scenario];
              return (
                <div key={scenario} className="mb-3">
                  <button
                    type="button"
                    onClick={() => toggle(scenario)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 rounded-sm border-2 border-ink bg-paper py-2 pr-2.5 pl-0 text-left transition-colors hover:bg-marble"
                  >
                    <span className={`-my-2 w-1.5 self-stretch ${tone.bar}`} />
                    <span className={tone.text}>
                      <ScenarioGlyph scenario={scenario} />
                    </span>
                    <span className="font-mono text-xs font-bold tracking-[0.08em] uppercase">
                      {SCENARIO_LABELS[scenario]}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-ink-muted">
                      {shown.length} cases
                    </span>
                    <span
                      className={`font-mono text-xs text-ink-muted transition-transform ${open ? "rotate-90" : ""}`}
                      aria-hidden="true"
                    >
                      ›
                    </span>
                  </button>
                  {open ? (
                    <ul className="cw-reveal mt-2 grid grid-cols-[minmax(0,1fr)] gap-3">
                      {shown.map((group) => (
                        <GroupBlock key={group.key} group={group} {...props} />
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })
          : null}

        {groupBy === "name" ? (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {byName
              .flatMap((group) => filter(group) ?? [])
              .map((group) => (
                <GroupBlock key={group.key} group={group} {...props} />
              ))}
          </ul>
        ) : null}
      </div>
      <p className="border-ink/15 border-t bg-paper px-3 py-2 text-[11px] leading-snug text-ink-muted">
        Synthetic documents. Click to inspect, drag into the chat, or press +.
      </p>
    </section>
  );
}

/** One case or one named party: a header to drag or add whole, and its thumbnails. */
function GroupBlock({ group, ...props }: CabinetProps & { group: Group }) {
  const all = group.documents.every((doc) => props.picked.has(doc.id));
  return (
    <li>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drag source; its button carries keyboard access */}
      <div
        draggable
        onDragStart={(event) => {
          setDragDocs(event, group.documents);
          props.onDragStart();
        }}
        onDragEnd={props.onDragEnd}
        className="group/row flex cursor-grab items-start gap-2 active:cursor-grabbing"
        title={group.note}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-tight font-semibold">
            {group.title}
          </p>
          <p className="truncate text-[11px] text-ink-muted">
            {group.documents.length} document
            {group.documents.length === 1 ? "" : "s"}
            {group.split ? ` · ${SPLIT_LABEL[group.split]}` : ""}
            {!group.split && group.note ? ` · ${group.note}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => props.onPick(group.documents)}
          className={`shrink-0 rounded-sm border-2 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.06em] uppercase transition-colors ${all ? "border-federal-blue bg-federal-blue text-paper" : "border-ink/30 text-ink-muted hover:border-ink hover:bg-paper hover:text-ink"}`}
          aria-label={`Add all of ${group.title} to the message`}
        >
          {all ? "Added" : "+ All"}
        </button>
      </div>
      <Thumbs documents={group.documents} {...props} />
    </li>
  );
}

function Thumbs({
  documents,
  ...props
}: CabinetProps & { documents: DocView[] }) {
  return (
    <ul className="mt-1.5 grid grid-cols-3 gap-2">
      {documents.map((doc) => (
        <DocTile key={doc.id} doc={doc} {...props} />
      ))}
    </ul>
  );
}

const FORMAT_LABEL: Record<DocView["sourceFormat"], string> = {
  pdf_digital: "PDF",
  pdf_scanned: "Scan",
  image: "Photo",
  csv: "CSV",
};

function DocTile({ doc, ...props }: CabinetProps & { doc: DocView }) {
  const picked = props.picked.has(doc.id);
  const wanted = props.highlight?.has(doc.id) ?? false;
  const label = doc.kind ? kindLabel(doc.kind) : doc.name;
  return (
    <li data-doc={doc.id} className="relative">
      {wanted ? (
        <span className="cw-wanted pointer-events-none absolute -inset-1 z-10 rounded-sm border-2 border-brass" />
      ) : null}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drag source; its buttons carry keyboard access */}
      <div
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          setDragDocs(event, [doc]);
          props.onDragStart();
        }}
        onDragEnd={props.onDragEnd}
        className={`group relative cursor-grab overflow-hidden rounded-sm border-2 bg-paper transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-hard-sm active:cursor-grabbing ${picked ? "border-federal-blue" : "border-ink/70 hover:border-ink"}`}
      >
        <button
          type="button"
          onClick={() => props.onOpen(doc)}
          className="block w-full text-left"
          title={`Inspect ${doc.name}`}
        >
          <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-limestone/40">
            {doc.thumbUrl ? (
              // biome-ignore lint/performance/noImgElement: signed Storage URLs, not optimisable
              <img
                src={doc.thumbUrl}
                alt=""
                loading="lazy"
                draggable={false}
                className="h-full w-full object-cover object-top"
              />
            ) : (
              <SheetPreview />
            )}
            <span className="absolute bottom-1 left-1 rounded-[2px] bg-ink/85 px-1 font-mono text-[8.5px] leading-[1.5] font-bold tracking-[0.06em] text-paper uppercase">
              {FORMAT_LABEL[doc.sourceFormat]}
              {doc.pageCount > 1 ? ` · ${doc.pageCount}p` : ""}
            </span>
          </div>
          <p className="mx-1.5 my-1 line-clamp-2 min-h-[2.4em] text-[10.5px] leading-[1.2] font-medium break-words">
            {label}
          </p>
        </button>
        <button
          type="button"
          onClick={() => props.onPick([doc])}
          className={`absolute top-1 right-1 flex size-5 items-center justify-center rounded-sm border-2 border-ink font-mono text-[11px] font-bold transition-opacity ${picked ? "bg-federal-blue text-paper" : "bg-paper opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
          aria-label={
            picked
              ? `${doc.name} is in the message`
              : `Add ${doc.name} to the message`
          }
        >
          {picked ? "✓" : "+"}
        </button>
      </div>
    </li>
  );
}

/** A spreadsheet has no page image: draw the idea of one. */
function SheetPreview() {
  return (
    <div className="grid h-full w-full grid-rows-6 bg-paper" aria-hidden="true">
      {["a", "b", "c", "d", "e", "f"].map((row, index) => (
        <div
          key={row}
          className={`grid grid-cols-3 border-ink/15 border-b ${index === 0 ? "bg-ivy/15" : ""}`}
        >
          <span className="border-ink/15 border-r" />
          <span className="border-ink/15 border-r" />
          <span />
        </div>
      ))}
      <span className="absolute inset-0 flex items-center justify-center text-ivy">
        <FileGlyph format="csv" size={22} />
      </span>
    </div>
  );
}

function CabinetGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <rect x="4" y="3" width="16" height="18" />
      <path d="M4 9h16M4 15h16M10 6h4M10 12h4M10 18h4" />
    </svg>
  );
}
