/** The demo's caps on paid work. Applied in the server functions, not only in the UI. */
export const LIMITS = {
  runsPerVisitorPerHour: 6,
  runsPerDay: 120,
  /** USD one Owner's Runs may cost in a day before new work is refused. */
  spendPerOwnerPerDay: 1.5,
  /** A Recording larger than this is refused: the model takes it inline. */
  uploadBytes: 18 * 1024 * 1024,
  /**
   * Longer calls are refused; the demo is for a short handover. Read from
   * every box that declares a length, not the movie header alone
   * (`recordingLength` in `domain/uploads.ts`).
   */
  uploadSeconds: 10 * 60,
  /** The most the Watch model may write back about one Recording. */
  watchOutputTokens: 32_000,
  /** Deck redos allowed on one Run. */
  redosPerRun: 3,
  /** Recordings one Owner may have stored in the last day, counted from the objects under their prefix. */
  uploadsPerOwnerPerDay: 20,
  /** A Process with more steps than this is refused: split the call. */
  maxSteps: 40,
  /** A Deck plan is cut to this many slides before it is laid out. */
  maxSlides: 60,
} as const;

export const UPLOAD_TYPES = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
} as const;
export type UploadType = keyof typeof UPLOAD_TYPES;

export const BUCKET = "process-transfer";
export const DEMO_PATH = "/demos/process-transfer";
