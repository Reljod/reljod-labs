import { describe, expect, it } from "vitest";
import {
  type Attachment,
  attachmentList,
  MAX_ATTACHMENT_NOTES,
  resolveSourceRef,
} from "./attachments";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const attached: Attachment[] = [
  {
    sourceId: A,
    title: "penhallow-leaving-cayman",
    fileName: "penhallow-leaving-cayman.md",
    kind: "text",
    status: "pending",
  },
  {
    sourceId: B,
    title: "Schedule March",
    kind: "csv",
    status: "ready",
  },
];

describe("resolveSourceRef", () => {
  it("passes a Source id through, lower-cased", () => {
    expect(resolveSourceRef(A.toUpperCase(), [])).toEqual({
      ok: true,
      sourceId: A,
    });
  });

  it("resolves a file name, the name without its extension, or a title, in any case", () => {
    for (const ref of [
      "penhallow-leaving-cayman.md",
      "Penhallow-Leaving-Cayman",
      " penhallow-leaving-cayman ",
    ]) {
      expect(resolveSourceRef(ref, attached)).toEqual({
        ok: true,
        sourceId: A,
      });
    }
    expect(resolveSourceRef("schedule march", attached)).toEqual({
      ok: true,
      sourceId: B,
    });
    expect(resolveSourceRef("Schedule March.csv", attached)).toEqual({
      ok: false,
      reason: "none",
      message: expect.any(String),
    });
  });

  it("says no match, and lists the attachments with their ids", () => {
    const result = resolveSourceRef("somebody-else.pdf", attached);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("none");
    expect(result.message).toContain("is not a Source id");
    expect(result.message).toContain(`id ${A}`);
    expect(result.message).toContain(`id ${B}`);
    expect(result.message).toContain("attached, not filed");
  });

  it("does not resolve another Session's attachment (it is not in the list it is given)", () => {
    const result = resolveSourceRef("elsewhere.md", [
      attached[1] as Attachment,
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain(A);
  });

  it("refuses when several attachments fit", () => {
    const twins: Attachment[] = [
      { ...attached[0], sourceId: A } as Attachment,
      { ...attached[0], sourceId: B } as Attachment,
    ];
    const result = resolveSourceRef("penhallow-leaving-cayman", twins);
    expect(result).toMatchObject({ ok: false, reason: "several" });
    if (result.ok) return;
    expect(result.message).toContain("more than one");
    expect(result.message).toContain(A);
    expect(result.message).toContain(B);
  });

  it("says plainly when nothing is attached", () => {
    const result = resolveSourceRef("x.md", []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("Nothing is attached in this Session.");
  });
});

describe("attachmentList", () => {
  it("is capped, and says how many more", () => {
    const many = Array.from({ length: MAX_ATTACHMENT_NOTES + 3 }, (_, i) => ({
      ...(attached[1] as Attachment),
      sourceId: `s${i}`,
    }));
    const text = attachmentList(many);
    expect(text.split("\n")).toHaveLength(MAX_ATTACHMENT_NOTES + 1);
    expect(text).toContain("… and 3 more");
  });
});
