"use client";

import { useState } from "react";
import { SAMPLE_FILES } from "../domain/sample-files";
import { formatBytes } from "./upload";

/** The drag type a sample chip carries: its public path. */
export const SAMPLE_DRAG_TYPE = "application/x-client-manager-sample";

const MEDIA_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  sheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

type Sample = (typeof SAMPLE_FILES)[number];

/** Fetches a sample from the site as a File, as if it came off the desktop. */
export async function sampleFile(sample: Pick<Sample, "path" | "kind">) {
  const response = await fetch(sample.path);
  if (!response.ok) throw new Error(`Could not load ${sample.path}`);
  const blob = await response.blob();
  const name = sample.path.split("/").pop() ?? "sample";
  return new File([blob], name, {
    type: MEDIA_TYPES[sample.kind] ?? blob.type,
  });
}

/** Files from a drop: real files, or sample chips dragged from the page. */
export async function filesFromDrop(data: DataTransfer): Promise<File[]> {
  const sample = data.getData(SAMPLE_DRAG_TYPE);
  if (sample) {
    const paths = sample.split("\n").filter(Boolean);
    return Promise.all(
      paths.map((path) => {
        const known = SAMPLE_FILES.find((item) => item.path === path);
        return sampleFile({ path, kind: known?.kind ?? "pdf" });
      }),
    );
  }
  return Array.from(data.files);
}

export const clientsWithSamples = [
  ...new Set(SAMPLE_FILES.map((sample) => sample.client)),
];

/**
 * Sample documents for the Intake: drag one onto the drop zone (or the
 * desktop, to keep it), or add a whole client's pack in one click.
 */
export function SampleFiles({
  onAdd,
  onFill,
}: {
  onAdd: (files: File[]) => void;
  /** Fills the Intake with that client's name and note too. */
  onFill?: (client: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const addClient = async (client: string) => {
    setLoading(client);
    try {
      const files = await Promise.all(
        SAMPLE_FILES.filter((sample) => sample.client === client).map(
          sampleFile,
        ),
      );
      onFill?.(client);
      onAdd(files);
    } finally {
      setLoading(null);
    }
  };

  if (SAMPLE_FILES.length === 0) return null;
  return (
    <div className="outline-box rounded-sm bg-paper">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="eyebrow font-bold">
          No files to hand? Use sample documents · {SAMPLE_FILES.length}
        </span>
        <span className="font-mono text-xs">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="cm-reveal space-y-3 border-ink/15 border-t px-3 py-3">
          <p className="text-xs text-ink-muted">
            Synthetic statements, registers and letters (SPECIMEN, fictional
            Meridia). Drag one into the box above, drag it to your desktop to
            keep it, or add a client's whole pack.
          </p>
          {clientsWithSamples.map((client) => (
            <div key={client}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-xs font-bold uppercase">
                  {client}
                </p>
                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={() => void addClient(client)}
                  className="eyebrow rounded-sm px-1.5 py-0.5 text-[0.6rem] font-bold text-federal-blue hover:bg-morning-haze disabled:opacity-50"
                >
                  {loading === client
                    ? "Adding…"
                    : `Use ${client.split(" ")[0]}'s note and files`}
                </button>
              </div>
              <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {SAMPLE_FILES.filter((sample) => sample.client === client).map(
                  (sample) => {
                    const name = sample.path.split("/").pop() ?? sample.name;
                    return (
                      <li key={sample.path}>
                        {/* biome-ignore lint/a11y/noStaticElementInteractions: drag is a shortcut; the download link and "Use … files" button are the keyboard route */}
                        <div
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "copy";
                            event.dataTransfer.setData(
                              SAMPLE_DRAG_TYPE,
                              sample.path,
                            );
                            // Chrome: dragging onto the desktop saves the file.
                            event.dataTransfer.setData(
                              "DownloadURL",
                              `${MEDIA_TYPES[sample.kind]}:${name}:${new URL(sample.path, window.location.href).href}`,
                            );
                            event.dataTransfer.setData(
                              "text/uri-list",
                              new URL(sample.path, window.location.href).href,
                            );
                          }}
                          className="group flex cursor-grab items-center gap-2 rounded-sm border border-ink/40 bg-marble px-2 py-1.5 text-xs hover:border-ink active:cursor-grabbing"
                          title={sample.description}
                        >
                          <span className="outline-box shrink-0 rounded-sm bg-paper px-1 font-mono text-[0.55rem] font-bold uppercase">
                            {sample.kind === "sheet" ? "XLS" : "PDF"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">
                              {sample.name}
                            </span>
                            <span className="block truncate text-[0.65rem] text-ink-muted">
                              {sample.description}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[0.6rem] text-stone">
                            {formatBytes(sample.size)}
                          </span>
                          <a
                            href={sample.path}
                            download={name}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Download ${sample.name}`}
                            className="shrink-0 font-mono text-sm font-bold text-federal-blue opacity-60 group-hover:opacity-100"
                          >
                            ⤓
                          </a>
                        </div>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
