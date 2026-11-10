"use client";

import { AnimatePresence, motion } from "motion/react";
import { type DragEvent, useMemo, useRef, useState } from "react";
import { SCENARIOS, type Scenario } from "../domain/case-file";
import type { DocView, FolderView } from "../view";
import { FileGlyph, SCENARIO_LABELS, ScenarioGlyph } from "./glyphs";

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

const SPLIT_LABEL = { train: "TRN", validation: "VAL", test: "TST" } as const;

type CabinetProps = {
  folders: FolderView[];
  uploads: DocView[];
  /** Ids already in the composer's tray. */
  picked: Set<string>;
  onPick: (docs: DocView[]) => void;
  onOpen: (doc: DocView) => void;
  onUpload: (files: File[]) => void;
  uploading: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  /** A rail of drawer icons while a run has the stage. */
  compact: boolean;
  onExpand: () => void;
};

/** The Cabinet: synthetic case folders and this desk's uploads, to drag into the chat. */
export function Cabinet(props: CabinetProps) {
  const { folders, uploads, compact } = props;
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState<Scenario | null>("pension_withdrawal");
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return folders;
    return folders.filter((folder) => {
      const haystack =
        `${folder.title} ${folder.summary} ${folder.documents.map((doc) => doc.name).join(" ")}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [folders, query]);

  if (compact) {
    return (
      <nav
        aria-label="Cabinet"
        className="flex flex-col items-center gap-2 py-3"
      >
        <button
          type="button"
          onClick={props.onExpand}
          className="outline-box press flex size-11 items-center justify-center rounded-sm bg-paper"
          aria-label="Open the Cabinet"
          title="Open the Cabinet"
        >
          <CabinetGlyph />
        </button>
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario}
            type="button"
            onClick={() => {
              setDrawer(scenario);
              props.onExpand();
            }}
            className="flex size-11 items-center justify-center rounded-sm text-ink-muted hover:bg-paper hover:text-ink"
            title={SCENARIO_LABELS[scenario]}
            aria-label={SCENARIO_LABELS[scenario]}
          >
            <ScenarioGlyph scenario={scenario} />
          </button>
        ))}
      </nav>
    );
  }

  const search = query.trim().length > 0;

  return (
    <section aria-label="Cabinet" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-4 pt-4 pb-3">
        <CabinetGlyph />
        <h2 className="font-mono text-sm font-bold tracking-[0.12em] uppercase">
          Cabinet
        </h2>
        <span className="ml-auto font-mono text-[11px] text-ink-muted">
          {folders.reduce((sum, folder) => sum + folder.documents.length, 0)}{" "}
          docs
        </span>
      </header>
      <div className="px-4 pb-3">
        <label className="sr-only" htmlFor="cabinet-search">
          Search the Cabinet
        </label>
        <input
          id="cabinet-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people, firms, files"
          className="outline-box h-10 w-full rounded-sm bg-paper px-3 text-sm placeholder:text-stone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
        />
      </div>

      <div className="cw-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {/* Uploads: drop real files here. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; "Add files" is the keyboard path */}
        <div
          className="cw-droppable mb-3 rounded-sm border-2 border-dashed border-ink/40 bg-paper/60 p-3"
          data-over={over}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              setOver(true);
            }
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            const files = [...event.dataTransfer.files];
            if (files.length) props.onUpload(files);
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow font-bold">Your uploads</p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="eyebrow text-federal-blue underline"
              disabled={props.uploading}
            >
              {props.uploading ? "Uploading…" : "Add files"}
            </button>
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
          </div>
          {uploads.length === 0 ? (
            <p className="mt-1 text-xs text-ink-muted">
              Drop PDFs, photos or CSVs here.
            </p>
          ) : (
            <ul className="mt-2 grid grid-cols-3 gap-2">
              {uploads.map((doc) => (
                <DocTile key={doc.id} doc={doc} {...props} />
              ))}
            </ul>
          )}
        </div>

        {(search ? [null] : SCENARIOS).map((scenario) => {
          const inDrawer = filtered.filter(
            (folder) => !scenario || folder.scenario === scenario,
          );
          const open = search || drawer === scenario;
          return (
            <div key={scenario ?? "results"} className="mb-2">
              {scenario ? (
                <button
                  type="button"
                  onClick={() => setDrawer(open ? null : scenario)}
                  aria-expanded={open}
                  className={`outline-box flex w-full items-center gap-2 rounded-sm px-3 py-2.5 text-left transition-colors ${open ? "bg-ink text-paper" : "bg-paper hover:bg-morning-haze"}`}
                >
                  <ScenarioGlyph scenario={scenario} />
                  <span className="font-mono text-xs font-bold tracking-[0.08em] uppercase">
                    {SCENARIO_LABELS[scenario]}
                  </span>
                  <span className="ml-auto font-mono text-[11px] opacity-70">
                    {inDrawer.length}
                  </span>
                </button>
              ) : (
                <p className="eyebrow mb-1 text-ink-muted">
                  {inDrawer.length} folders match
                </p>
              )}
              <AnimatePresence initial={false}>
                {open ? (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    className="overflow-hidden"
                  >
                    {inDrawer.map((folder) => (
                      <FolderRow
                        key={folder.slug}
                        folder={folder}
                        open={openFolder === folder.slug}
                        onToggle={() =>
                          setOpenFolder(
                            openFolder === folder.slug ? null : folder.slug,
                          )
                        }
                        {...props}
                      />
                    ))}
                  </motion.ul>
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
      <p className="border-ink/20 border-t px-4 py-2 text-[11px] leading-snug text-ink-muted">
        Synthetic documents. Drag a file or a whole folder into the chat.
      </p>
    </section>
  );
}

function FolderRow({
  folder,
  open,
  onToggle,
  ...props
}: CabinetProps & { folder: FolderView; open: boolean; onToggle: () => void }) {
  return (
    <li className="mt-1">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drag source; its buttons carry keyboard access */}
      <div
        draggable
        onDragStart={(event) => {
          setDragDocs(event, folder.documents);
          props.onDragStart();
        }}
        onDragEnd={props.onDragEnd}
        className="group flex cursor-grab items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-paper active:cursor-grabbing"
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={folder.summary}
        >
          <FolderGlyph open={open} />
          <span className="truncate text-sm font-medium">{folder.title}</span>
        </button>
        <span
          className="font-mono text-[9px] tracking-[0.08em] text-stone"
          title={`Evaluation split: ${folder.split}`}
        >
          {SPLIT_LABEL[folder.split]}
        </span>
        <button
          type="button"
          onClick={() => props.onPick(folder.documents)}
          className="rounded-sm px-1.5 font-mono text-xs font-bold text-federal-blue opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          title="Add the whole folder to the message"
          aria-label={`Add ${folder.title} to the message`}
        >
          +
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-3 gap-2 overflow-hidden px-2 pt-1 pb-2"
          >
            {folder.documents.map((doc) => (
              <DocTile key={doc.id} doc={doc} {...props} />
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

function DocTile({ doc, ...props }: CabinetProps & { doc: DocView }) {
  const picked = props.picked.has(doc.id);
  return (
    <li>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drag source; its buttons carry keyboard access */}
      <div
        draggable
        onDragStart={(event) => {
          setDragDocs(event, [doc]);
          props.onDragStart();
        }}
        onDragEnd={props.onDragEnd}
        className={`group relative cursor-grab overflow-hidden rounded-sm border-2 bg-paper transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-hard-sm active:cursor-grabbing ${picked ? "border-federal-blue" : "border-ink"}`}
      >
        <button
          type="button"
          onClick={() => props.onOpen(doc)}
          className="block w-full text-left"
          title={`Preview ${doc.name}`}
        >
          <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-limestone/50">
            {doc.thumbUrl ? (
              // biome-ignore lint/performance/noImgElement: signed Storage URLs, not optimisable
              <img
                src={doc.thumbUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover object-top"
              />
            ) : (
              <span className="text-ink-muted">
                <FileGlyph format={doc.sourceFormat} size={22} />
              </span>
            )}
          </div>
          <p className="truncate px-1 py-0.5 text-[10px] leading-tight">
            {doc.name}
          </p>
        </button>
        <button
          type="button"
          onClick={() => props.onPick([doc])}
          className={`absolute top-1 right-1 flex size-5 items-center justify-center rounded-sm border-2 border-ink font-mono text-[11px] font-bold ${picked ? "bg-federal-blue text-paper" : "bg-paper opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
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

function CabinetGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
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

function FolderGlyph({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
      className="shrink-0 text-oak"
    >
      {open ? (
        <path d="M3 6h6l2 2h10v3H6l-3 9z M6 11h16l-3 9H3" />
      ) : (
        <path d="M3 6h6l2 2h10v12H3z" />
      )}
    </svg>
  );
}
