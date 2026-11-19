/**
 * Loupe draws with the Colonnade primitives Sieve already has (2px ink
 * outlines, hard offset shadows, `press`). This is the one place Loupe
 * reaches into another demo's components, so a move of those primitives is a
 * one-line change here.
 */
export {
  Button,
  ConfirmDialog,
  cx,
  ErrorNote,
  fieldClass,
  Panel,
  Spinner,
  Tag,
  type TagTone,
  useWrite,
} from "@/features/name-extraction/components/ui";
