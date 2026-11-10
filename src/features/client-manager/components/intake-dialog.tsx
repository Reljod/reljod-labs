"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { EXAMPLE_INTAKES } from "../domain/examples";
import { filesFromDrop, SampleFiles } from "./sample-files";
import { ACCEPT, formatBytes, metaOf, postJson, putFile } from "./upload";

type Created = {
  clientId: string;
  buildId: string;
  uploads: { sourceId: string; name: string; url: string }[];
  portraitUpload: { url: string } | null;
};

const KIND: [RegExp, string][] = [
  [/\.pdf$/i, "PDF"],
  [/\.(png|jpe?g|webp|gif)$/i, "IMG"],
  [/\.(xlsx|csv)$/i, "XLS"],
  [/\.docx$/i, "DOC"],
  [/\.(txt|md)$/i, "TXT"],
];
const kindOf = (name: string) =>
  KIND.find(([pattern]) => pattern.test(name))?.[1] ?? null;

const MAX_FILES = 8;
const MAX_BYTES = 10 * 1024 * 1024;

/** The Intake: a name, anything you know, any files. Submitting starts the Build. */
export function IntakeDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [portrait, setPortrait] = useState<File | null>(null);
  const [portraitPreview, setPortraitPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"form" | "sending">("form");
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [stage, setStage] = useState("");
  const filePicker = useRef<HTMLInputElement>(null);
  const portraitPicker = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase === "form") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  useEffect(() => {
    if (!portrait) {
      setPortraitPreview(null);
      return;
    }
    const url = URL.createObjectURL(portrait);
    setPortraitPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [portrait]);

  const addFiles = (incoming: File[]) => {
    const rejected = incoming.filter(
      (file) => !kindOf(file.name) || file.size > MAX_BYTES,
    );
    if (rejected.length > 0) {
      setError(
        `${rejected.map((file) => file.name).join(", ")}: use PDF, images, xlsx, csv, docx, txt or md under 10 MB.`,
      );
    } else {
      setError(null);
    }
    setFiles((current) =>
      [
        ...current,
        ...incoming.filter(
          (file) => kindOf(file.name) && file.size <= MAX_BYTES,
        ),
      ].slice(0, MAX_FILES),
    );
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    filesFromDrop(event.dataTransfer)
      .then(addFiles)
      .catch(() => setError("Couldn't read that file."));
  };

  const fillExample = (index: number) => {
    const example = EXAMPLE_INTAKES[index];
    if (!example) return;
    setName(example.name);
    setNote(example.note);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Give the client a name.");
      return;
    }
    if (!note.trim() && files.length === 0) {
      setError("Add something about them: a note, or at least one file.");
      return;
    }
    setError(null);
    setPhase("sending");
    let createdId: string | null = null;
    try {
      setStage("Opening a file for the client");
      const created = await postJson<Created>("/api/client-manager/clients", {
        name: name.trim(),
        note,
        files: files.map(metaOf),
        portrait: portrait ? metaOf(portrait) : null,
      });
      createdId = created.clientId;
      setStage(
        files.length || portrait
          ? "Uploading to Supabase Storage"
          : "Starting the pipeline",
      );
      await Promise.all([
        ...created.uploads.map((upload) => {
          const file = files.find((item) => item.name === upload.name);
          return file
            ? putFile(upload.url, file, (fraction) =>
                setProgress((current) => ({
                  ...current,
                  [upload.name]: fraction,
                })),
              )
            : Promise.resolve();
        }),
        portrait && created.portraitUpload
          ? putFile(created.portraitUpload.url, portrait)
          : Promise.resolve(),
      ]);
      setStage("Starting the pipeline");
      await postJson(`/api/client-manager/builds/${created.buildId}/start`, {});
      router.push(`/demos/client-manager/${created.clientId}`);
    } catch (failure) {
      // A client whose files never arrived would sit in the Catalog as failed.
      if (createdId) {
        void fetch(`/api/client-manager/clients/${createdId}`, {
          method: "DELETE",
        });
      }
      setPhase("form");
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not add the client.",
      );
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && phase === "form") onClose();
      }}
    >
      <motion.form
        role="dialog"
        aria-modal="true"
        aria-labelledby="cm-intake-title"
        onSubmit={submit}
        initial={{ y: 60, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="outline-box flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-sm bg-marble shadow-hard-lg"
      >
        <header className="flex items-center justify-between border-ink border-b-2 bg-paper px-5 py-4">
          <div>
            <p className="eyebrow text-ink-muted">Intake</p>
            <h2
              id="cm-intake-title"
              className="font-mono text-2xl font-bold uppercase"
            >
              Add a client
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "sending"}
            aria-label="Close"
            className="outline-box press flex size-9 items-center justify-center rounded-sm bg-paper font-mono text-lg font-bold"
          >
            ×
          </button>
        </header>

        <AnimatePresence mode="wait">
          {phase === "form" ? (
            <motion.div
              key="form"
              exit={{ opacity: 0, x: -30 }}
              className="flex-1 space-y-5 overflow-y-auto p-5"
            >
              <div className="flex items-start gap-4">
                <button
                  type="button"
                  onClick={() => portraitPicker.current?.click()}
                  className="outline-box group relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-dashed bg-paper text-center"
                  aria-label={
                    portrait
                      ? "Change the portrait"
                      : "Upload a portrait (optional)"
                  }
                >
                  {portraitPreview ? (
                    // biome-ignore lint/performance/noImgElement: a local object URL preview
                    <img
                      src={portraitPreview}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="eyebrow px-2 text-[0.55rem] leading-tight text-ink-muted group-hover:text-federal-blue">
                      Photo
                      <br />
                      optional
                    </span>
                  )}
                </button>
                <input
                  ref={portraitPicker}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    setPortrait(event.target.files?.[0] ?? null);
                    event.target.value = "";
                  }}
                />
                <div className="flex-1">
                  <label htmlFor="cm-name" className="eyebrow font-bold">
                    Name
                  </label>
                  <input
                    ref={first}
                    id="cm-name"
                    value={name}
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Elena Marsh"
                    className="outline-box mt-1 w-full rounded-sm bg-paper px-3 py-2.5 font-mono text-lg font-bold focus:outline-2 focus:outline-federal-blue"
                  />
                  <p className="mt-1.5 text-xs text-ink-muted">
                    No photo? We'll paint a portrait from the personality the
                    graph shows.
                  </p>
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="cm-note" className="eyebrow font-bold">
                    Everything you know
                  </label>
                  <span className="flex gap-1">
                    {EXAMPLE_INTAKES.map((example, index) => (
                      <button
                        key={example.name}
                        type="button"
                        onClick={() => fillExample(index)}
                        className="eyebrow rounded-sm px-1.5 py-0.5 text-[0.6rem] font-bold text-federal-blue hover:bg-morning-haze"
                      >
                        Try {example.name.split(" ")[0]}
                      </button>
                    ))}
                  </span>
                </div>
                <textarea
                  id="cm-note"
                  value={note}
                  maxLength={20_000}
                  onChange={(event) => setNote(event.target.value)}
                  rows={7}
                  placeholder="Meeting notes, family, what they own and owe, what they worry about, how they like to be spoken to… Write it the way you'd tell a colleague."
                  className="outline-box mt-1 w-full resize-y rounded-sm bg-paper px-3 py-2.5 text-sm leading-relaxed focus:outline-2 focus:outline-federal-blue"
                />
                <p className="mt-1 text-right font-mono text-[0.65rem] text-stone">
                  {note.length.toLocaleString("en-US")} / 20,000
                </p>
              </div>

              <div>
                <p className="eyebrow font-bold">Files</p>
                <button
                  type="button"
                  onClick={() => filePicker.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={`mt-1 flex w-full flex-col items-center gap-1 rounded-sm border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? "border-federal-blue bg-morning-haze" : "border-ink bg-paper hover:bg-morning-haze/50"}`}
                >
                  <motion.span
                    animate={dragging ? { y: [-2, 2, -2] } : { y: 0 }}
                    transition={{
                      repeat: dragging ? Infinity : 0,
                      duration: 0.8,
                    }}
                    className="font-mono text-2xl"
                    aria-hidden="true"
                  >
                    ⇪
                  </motion.span>
                  <span className="font-semibold">
                    Drop statements, IDs, spreadsheets, photos
                  </span>
                  <span className="text-xs text-ink-muted">
                    PDF, PNG, JPG, XLSX, CSV, DOCX, TXT · up to 8 files, 10 MB
                    each
                  </span>
                </button>
                <input
                  ref={filePicker}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
                <ul className="mt-2 space-y-1.5">
                  <AnimatePresence initial={false}>
                    {files.map((file, index) => (
                      <motion.li
                        key={`${file.name}-${file.size}-${index}`}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="outline-box flex items-center gap-3 rounded-sm bg-paper px-3 py-1.5 text-sm"
                      >
                        <span className="outline-box rounded-sm bg-marble px-1 font-mono text-[0.6rem] font-bold">
                          {kindOf(file.name)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {file.name}
                        </span>
                        <span className="font-mono text-xs text-stone">
                          {formatBytes(file.size)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setFiles(files.filter((_, item) => item !== index))
                          }
                          aria-label={`Remove ${file.name}`}
                          className="font-mono font-bold hover:text-seal-red"
                        >
                          ×
                        </button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
                <div className="mt-3">
                  <SampleFiles
                    onAdd={addFiles}
                    onFill={(client) => {
                      const index = EXAMPLE_INTAKES.findIndex(
                        (example) => example.name === client,
                      );
                      if (index >= 0 && !note.trim()) fillExample(index);
                      else if (!name.trim()) setName(client);
                    }}
                  />
                </div>
              </div>

              <AnimatePresence>
                {error ? (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    role="alert"
                    className="outline-box rounded-sm bg-paper px-3 py-2 text-sm text-seal-red"
                  >
                    {error}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="sending"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex flex-1 flex-col items-center justify-center gap-6 p-10 text-center"
            >
              <SendingMark />
              <div>
                <p className="font-mono text-xl font-bold uppercase">{name}</p>
                <p className="mt-1 text-ink-muted" aria-live="polite">
                  {stage}…
                </p>
              </div>
              {files.length > 0 ? (
                <ul className="w-full max-w-sm space-y-2 text-left">
                  {files.map((file) => (
                    <li key={file.name} className="text-xs">
                      <div className="flex justify-between">
                        <span className="truncate">{file.name}</span>
                        <span className="font-mono">
                          {Math.round((progress[file.name] ?? 0) * 100)}%
                        </span>
                      </div>
                      <div className="outline-box mt-1 h-2 overflow-hidden rounded-sm bg-paper">
                        <motion.div
                          className="h-full bg-federal-blue"
                          animate={{
                            width: `${(progress[file.name] ?? 0) * 100}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="flex items-center justify-between gap-3 border-ink border-t-2 bg-paper px-5 py-3">
          <p className="hidden text-xs text-ink-muted sm:block">
            Synthetic data only, please. Clients you add are visible to this
            browser only and expire in 30 days.
          </p>
          <button
            type="submit"
            disabled={phase === "sending"}
            className="outline-box press ml-auto inline-flex min-h-11 items-center gap-2 rounded-sm bg-federal-blue px-5 py-2 font-mono text-sm font-bold tracking-[0.1em] text-paper uppercase disabled:opacity-60"
          >
            {phase === "sending" ? "Building…" : "Build the graph →"}
          </button>
        </footer>
      </motion.form>
    </motion.div>
  );
}

/** Three Nodes orbiting a fourth while the Intake is sent. */
function SendingMark() {
  return (
    <svg viewBox="-60 -60 120 120" className="size-32" aria-hidden="true">
      <circle
        r={44}
        fill="none"
        stroke="#14213d"
        strokeOpacity={0.2}
        strokeDasharray="3 6"
      />
      <motion.g
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 3.2, ease: "linear" }}
      >
        {[0, 1, 2].map((index) => {
          const angle = (index * 2 * Math.PI) / 3;
          return (
            <g key={index}>
              <line
                x1={0}
                y1={0}
                x2={Math.cos(angle) * 44}
                y2={Math.sin(angle) * 44}
                stroke="#1d4e89"
                strokeWidth={2}
              />
              <circle
                cx={Math.cos(angle) * 44}
                cy={Math.sin(angle) * 44}
                r={8}
                fill={["#2f6b3f", "#d9a84e", "#b23a2b"][index]}
                stroke="#14213d"
                strokeWidth={2}
              />
            </g>
          );
        })}
      </motion.g>
      <circle r={16} fill="#fff" stroke="#14213d" strokeWidth={3} />
    </svg>
  );
}
