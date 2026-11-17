import type { SourceKind, SourceStatus } from "./knowledge";

/*
 * What is attached in a Session, and how a model's reference to one is
 * resolved. A model that is not told a Source's id will guess (a file name,
 * a title); these pure helpers tell it, and turn a guess into the id when
 * exactly one attachment of the Session fits. No Node imports.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isSourceId = (value: string): boolean => UUID.test(value.trim());

/** Attachments the Agent's instructions and an error list name; the newest first. */
export const MAX_ATTACHMENT_NOTES = 12;

/** A Source attached in a Session, filed or not. */
export type Attachment = {
  sourceId: string;
  title: string;
  /** The name of the uploaded file, when it differs from the title. */
  fileName?: string | null;
  kind: SourceKind;
  status: SourceStatus;
};

/** `pending` is attached and not filed; everything else is in the Knowledge base. */
export const isFiled = (status: SourceStatus): boolean => status !== "pending";

/** One attachment as a line: title, kind, filed or not, and the id the tools take. */
export function attachmentLine(attachment: Attachment): string {
  return `- "${attachment.title}" (${attachment.kind}, ${
    isFiled(attachment.status) ? "filed" : "attached, not filed"
  }, id ${attachment.sourceId})`;
}

/** The attachments as a list of lines, cut at `MAX_ATTACHMENT_NOTES`. */
export function attachmentList(attachments: readonly Attachment[]): string {
  const shown = attachments.slice(0, MAX_ATTACHMENT_NOTES);
  const more = attachments.length - shown.length;
  return [
    ...shown.map(attachmentLine),
    ...(more > 0 ? [`- … and ${more} more`] : []),
  ].join("\n");
}

const stem = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
/** Case, spaces, underscores and hyphens do not tell two names apart. */
const norm = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, "-")
    .replace(/^-+|-+$/g, "");

export type SourceRef =
  | { ok: true; sourceId: string }
  | { ok: false; reason: "none" | "several"; message: string };

/**
 * A reference to a Source as a model may give it: the id itself, or, when the
 * Session's attachments are known, a file name, that name without its
 * extension, or a title (any case). Only a single match resolves; anything
 * else says so and lists the attachments with their ids so the next call can
 * be right.
 */
export function resolveSourceRef(
  ref: string,
  attachments: readonly Attachment[],
): SourceRef {
  const given = ref.trim();
  if (isSourceId(given)) return { ok: true, sourceId: given.toLowerCase() };
  const wanted = norm(given);
  const matches = wanted
    ? attachments.filter((item) =>
        [
          item.fileName ?? "",
          item.fileName ? stem(item.fileName) : "",
          item.title,
          stem(item.title),
        ].some((candidate) => candidate !== "" && norm(candidate) === wanted),
      )
    : [];
  const [only] = matches;
  if (matches.length === 1 && only)
    return { ok: true, sourceId: only.sourceId };
  const list =
    attachments.length > 0
      ? `Attached in this Session:\n${attachmentList(attachments)}`
      : "Nothing is attached in this Session.";
  const what = `"${given.slice(0, 80)}" is not a Source id`;
  return matches.length > 1
    ? {
        ok: false,
        reason: "several",
        message: `${what}, and it fits more than one attachment. Call again with the id of the one meant. ${list}`,
      }
    : {
        ok: false,
        reason: "none",
        message: `${what}, and no attachment of this Session has that name. Call again with an id (a UUID). ${list}`,
      };
}

/** A line a Staff message's attachments add to its text in the history the model sees. */
export function attachedNote(parts: readonly { type: string }[]): string {
  const lines = parts.flatMap((part) => {
    const item = part as {
      type: string;
      sourceId?: string;
      name?: string;
      kind?: string;
    };
    return item.type === "attachment" && item.sourceId
      ? [
          `- "${item.name ?? "file"}" (${item.kind ?? "file"}, id ${item.sourceId})`,
        ]
      : [];
  });
  return lines.length > 0
    ? `[Attached to this message:\n${lines.join("\n")}]`
    : "";
}
