// pdfjs-dist ships no types for its worker; parsers.ts only registers it.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
