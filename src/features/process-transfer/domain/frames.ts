/*
 * Frames are stills of the Recording, captured in the browser from the video
 * at the times the Process and the Deck point at. They are never uploaded:
 * the DOCX and PPTX are built in the browser with whatever Frames it has.
 */

export type Frame = {
  bytes: Uint8Array;
  width: number;
  height: number;
  mime: "image/jpeg" | "image/png";
};

/** Frames by the second they were taken at; see `frameKey`. */
export type Frames = Record<string, Frame>;

/** The same Frames as URLs the page can show. */
export type FrameUrls = Record<string, string>;

/** Times are matched to the tenth of a second. */
export function frameKey(seconds: number): string {
  return Math.max(0, seconds).toFixed(1);
}
