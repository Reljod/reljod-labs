"use client";

import { motion } from "motion/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { createAddition, startBuild, stopBuild } from "./api";
import { Icon } from "./icons";
import { ACCEPT, formatBytes, metaOf, putFile } from "./upload";

/** An addition: a note or files about a client, run through the same Build as the Intake. */
export function AddDialog({
  clientId,
  clientName,
  onClose,
  onStarted,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onStarted: (buildId: string) => void;
}) {
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Set at once, so a double click or Enter cannot start two additions.
  const sending = useRef(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current || (!note.trim() && files.length === 0)) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const created = await createAddition(clientId, {
        note,
        files: files.map(metaOf),
      });
      try {
        await Promise.all(
          created.uploads.map((upload) => {
            const file = files.find((item) => item.name === upload.name);
            return file ? putFile(upload.url, file) : Promise.resolve();
          }),
        );
      } catch (failure) {
        // Leave nothing queued behind: a queued Build blocks the next addition.
        await stopBuild(created.buildId).catch(() => {});
        throw failure;
      }
      await startBuild(created.buildId);
      onStarted(created.buildId);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not add that.",
      );
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <motion.form
        role="dialog"
        aria-modal="true"
        aria-label={`Add to ${clientName}`}
        onSubmit={submit}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        className="outline-box w-full max-w-lg rounded-sm bg-paper p-4 shadow-hard-lg"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono font-bold uppercase">Add to {clientName}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="outline-box press grid size-8 place-items-center rounded-sm bg-paper"
          >
            <Icon name="close" />
          </button>
        </div>
        <textarea
          ref={area}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={5}
          placeholder="What's new? A meeting note, a life event, a change of plans…"
          className="outline-box w-full resize-none rounded-sm bg-marble/50 p-3 text-sm shadow-hard-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
        />
        {files.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {files.map((file) => (
              <li
                key={file.name}
                className="flex items-center gap-1 rounded-sm border border-ink bg-marble px-2 py-0.5 text-xs"
              >
                {file.name}
                <span className="text-stone">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setFiles(files.filter((item) => item !== file))
                  }
                  className="text-stone hover:text-seal-red"
                >
                  <Icon name="close" className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="mt-2 text-sm text-seal-red">{error}</p> : null}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className="outline-box press eyebrow flex items-center gap-1.5 rounded-sm bg-paper px-3 py-2"
          >
            <Icon name="doc" className="size-3.5" />
            Files
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              setFiles(
                [...files, ...Array.from(event.target.files ?? [])].slice(0, 8),
              );
              event.target.value = "";
            }}
          />
          <button
            type="submit"
            disabled={busy || (!note.trim() && files.length === 0)}
            aria-busy={busy}
            className="outline-box press eyebrow ml-auto rounded-sm bg-federal-blue px-4 py-2 font-bold text-paper disabled:opacity-40"
          >
            {busy ? "Starting…" : "Add to the graph"}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
