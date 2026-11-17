"use client";

import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { LIMITS } from "../../domain/limits";
import { SAMPLES, type SampleFile } from "../../domain/samples";
import { formatBytes } from "../api";
import { Badge, Button, cx, Spinner } from "../ui";
import { type Attachment, sendBlocker } from "./chat-state";
import { Popover } from "./popover";

const ACCEPT =
  ".pdf,.csv,.xlsx,.xls,.doc,.docx,.txt,.md,.html,.htm,application/pdf,text/csv,text/plain";

const GROUP_LABEL: Record<SampleFile["group"], string> = {
  "member request": "Member requests",
  contributions: "Contributions",
  knowledge: "Knowledge base",
};

/** Catches files dropped anywhere on the chat, with a hint while they hover. */
export function DropZone({
  children,
  onFiles,
  disabled,
  className = "",
}: {
  children: ReactNode;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; files also attach by the button and by paste
    <div
      className={cx("relative", className)}
      onDragEnter={(event) => {
        if (disabled || !hasFiles(event)) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {over ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-federal-blue bg-morning-haze/80 text-sm font-semibold text-federal-blue"
        >
          Drop files to attach them
        </div>
      ) : null}
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const status =
    attachment.state === "uploading"
      ? attachment.progress >= 1
        ? "Reading…"
        : `Uploading ${Math.round(attachment.progress * 100)}%`
      : attachment.state === "ready"
        ? formatBytes(attachment.bytes)
        : "Failed";
  return (
    <li
      title={attachment.error ?? undefined}
      className={cx(
        "flex max-w-full items-center gap-1.5 rounded-sm border px-2 py-1 text-xs",
        attachment.state === "failed"
          ? "border-seal-red/40 bg-seal-red/5 text-seal-red"
          : "border-ink/20 bg-paper",
      )}
    >
      {attachment.state === "uploading" ? <Spinner /> : null}
      <span className="min-w-0 max-w-44 truncate font-medium">
        {attachment.name}
      </span>
      <span className="shrink-0 text-ink-muted">{status}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
        className="shrink-0 rounded-sm px-1 leading-none hover:bg-ink/10 focus-visible:outline-2 focus-visible:outline-federal-blue"
      >
        ×
      </button>
    </li>
  );
}

function SamplePicker({
  onPick,
  busyId,
  disabled,
}: {
  onPick: (sample: SampleFile) => void;
  busyId: string | null;
  disabled: boolean;
}) {
  const groups = (Object.keys(GROUP_LABEL) as SampleFile["group"][])
    .map((group) => ({
      group,
      items: SAMPLES.filter((sample) => sample.group === group),
    }))
    .filter((entry) => entry.items.length > 0);
  return (
    <Popover
      label="Sample files"
      side="top"
      disabled={disabled}
      panelClassName="max-h-[min(28rem,60dvh)] overflow-y-auto hx-scroll"
    >
      {(close) =>
        groups.length === 0 ? (
          <p className="text-ink-muted">
            No sample files yet. Attach one of your own.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-ink-muted">
              Fictional SPECIMEN documents. Picking one attaches it to your next
              message.
            </p>
            {groups.map((entry) => (
              <div key={entry.group}>
                <p className="font-mono text-[0.65rem] font-bold tracking-[0.08em] text-ink-muted uppercase">
                  {GROUP_LABEL[entry.group]}
                </p>
                <ul className="mt-1 space-y-1">
                  {entry.items.map((sample) => (
                    <li key={sample.id}>
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => {
                          onPick(sample);
                          close();
                        }}
                        className="w-full rounded-sm border border-transparent px-2 py-1.5 text-left hover:border-ink/20 hover:bg-marble focus-visible:outline-2 focus-visible:outline-federal-blue disabled:opacity-55"
                      >
                        <span className="block text-sm font-medium">
                          {sample.title}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {sample.about}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      }
    </Popover>
  );
}

/**
 * The message box. Enter sends, Shift+Enter starts a new line, Stop ends the
 * Agent's answer without asking. Files attach by button, drop or paste.
 */
export function Composer({
  text,
  onText,
  attachments,
  onFiles,
  onRemoveAttachment,
  onSend,
  onStop,
  onPickSample,
  sampleBusyId,
  streaming,
  blockedReason,
  notice,
  textareaRef,
}: {
  text: string;
  onText: (text: string) => void;
  attachments: Attachment[];
  onFiles: (files: File[]) => void;
  onRemoveAttachment: (localId: string) => void;
  onSend: () => void;
  onStop: () => void;
  onPickSample: (sample: SampleFile) => void;
  sampleBusyId: string | null;
  streaming: boolean;
  /** Why sending is off for now (a limit was hit), or null. */
  blockedReason: string | null;
  /** An error or note about the last attach, shown above the box. */
  notice: ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const blocker = sendBlocker({
    text,
    maxChars: LIMITS.messageChars,
    attachments,
    streaming,
    blockedReason,
  });
  const showReason =
    blocker !== null &&
    (text.trim().length > 0 || streaming || blockedReason !== null);

  // Grow with the text, up to about eight lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the text is what changes the height
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 192)}px`;
  }, [text, textareaRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    if (blocker === null) onSend();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    onFiles(files);
  };

  return (
    <form
      className="space-y-2 border-ink/15 border-t bg-paper px-3 py-3 sm:px-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (blocker === null) onSend();
      }}
    >
      {notice}
      {attachments.length > 0 ? (
        <ul
          className="flex flex-wrap gap-1.5"
          aria-label="Files for the next message"
        >
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.localId}
              attachment={attachment}
              onRemove={() => onRemoveAttachment(attachment.localId)}
            />
          ))}
        </ul>
      ) : null}
      <div className="rounded-sm border border-ink/30 bg-paper focus-within:border-federal-blue focus-within:outline-2 focus-within:outline-federal-blue/40">
        <textarea
          ref={textareaRef}
          value={text}
          rows={2}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          aria-label="Message the Agent"
          aria-describedby={showReason ? reasonId : undefined}
          placeholder="Ask about a Member, upload a document, start a Run…"
          className="block max-h-48 w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-ink-muted/70"
        />
        <div className="flex flex-wrap items-center gap-2 border-ink/10 border-t px-2 py-1.5">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose files to attach"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) onFiles(files);
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => fileInput.current?.click()}
          >
            Attach files
          </Button>
          <SamplePicker
            onPick={onPickSample}
            busyId={sampleBusyId}
            disabled={false}
          />
          <span className="ml-auto flex items-center gap-2">
            {text.length > LIMITS.messageChars * 0.8 ? (
              <Badge
                tone={text.length > LIMITS.messageChars ? "red" : "amber"}
                title="Characters in this message"
              >
                {text.length.toLocaleString("en")} /{" "}
                {LIMITS.messageChars.toLocaleString("en")}
              </Badge>
            ) : null}
            {streaming ? (
              <Button size="sm" variant="secondary" onClick={onStop}>
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                type="submit"
                disabled={blocker !== null}
                aria-describedby={showReason ? reasonId : undefined}
              >
                Send
              </Button>
            )}
          </span>
        </div>
      </div>
      <p
        id={reasonId}
        className={cx(
          "text-xs",
          blockedReason ? "text-seal-red" : "text-ink-muted",
          !showReason && "hidden sm:block",
        )}
      >
        {showReason
          ? blocker
          : "Enter sends. Shift and Enter start a new line."}
      </p>
    </form>
  );
}
