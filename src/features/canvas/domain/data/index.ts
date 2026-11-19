/**
 * The open data of the fictional Republic of Meridia, 2025: a seeded,
 * reproducible Catalog of about a million rows with planted structure (STORY).
 */
export { CATALOG, DATA_VERSION, tableRows } from "./catalog";
export { tableCsvChunks } from "./csv";
export { REGIONS } from "./geography";
export {
  type Holiday,
  STORY,
  STORY_EVENTS,
  type Story,
  type StoryEvent,
  type StoryId,
} from "./story";
export type {
  CatalogColumn,
  CatalogGroup,
  CatalogTable,
  Cell,
  ColumnType,
} from "./types";
