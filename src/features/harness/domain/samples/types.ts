/**
 * A sample file a visitor (or a Demo mode Beat) can attach in chat without
 * having one of their own. Served from `public/harness/samples/`.
 */
export type SampleFile = {
  /** Stable id a Scenario names, such as `request-overseas-transfer`. */
  id: string;
  /** What the picker shows. */
  title: string;
  /** One line on what it is and what it is good for. */
  about: string;
  /** Path under `public/`, starting with `/harness/samples/`. */
  path: string;
  /** File name to upload it under. */
  name: string;
  /** MIME type. */
  type: string;
  /** Which group the picker lists it under. */
  group: "member request" | "contributions" | "knowledge";
};
