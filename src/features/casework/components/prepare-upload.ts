"use client";

const MAX_PAGES = 12;

/**
 * Builds the upload form: PDFs are rendered to JPEG page images in the
 * browser (the jobs read pages as images) and flagged when they carry a text
 * layer, so the server knows to parse rather than OCR them.
 */
export async function prepareUpload(files: File[]): Promise<FormData> {
  const form = new FormData();
  for (const [index, file] of files.entries()) {
    form.append("file", file);
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) continue;
    const pdfjs = await import("pdfjs-dist");
    // The worker matches the installed pdf.js exactly; bundling it would make it an external server package.
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    }).promise;
    let text = 0;
    for (
      let number = 1;
      number <= Math.min(pdf.numPages, MAX_PAGES);
      number++
    ) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      text += content.items.length;
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) continue;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.82),
      );
      if (blob)
        form.append(
          `pages-${index}`,
          new File([blob], `page-${number}.jpg`, { type: "image/jpeg" }),
        );
    }
    form.append(`digital-${index}`, text > 20 ? "1" : "0");
    await pdf.cleanup();
  }
  return form;
}
