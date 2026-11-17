import type { ProjectMark } from "@/content/types";
import { Badge, type BadgeTone } from "./badge";

const markTone: Record<ProjectMark, BadgeTone> = {
  New: "brass",
  Beta: "sky",
};

/** A project's "New" / "Beta" tags, in one place so every listing draws them alike. */
export function ProjectMarks({
  marks,
  size,
}: {
  marks?: ProjectMark[];
  size?: "md" | "sm";
}) {
  if (!marks?.length) return null;
  return marks.map((mark) => (
    <Badge key={mark} tone={markTone[mark]} size={size}>
      {mark}
    </Badge>
  ));
}
