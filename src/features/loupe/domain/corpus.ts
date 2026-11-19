/**
 * The Corpus as the app uses it: the Manifest, each Document's recorded
 * Sweep, and the featured Samples. The data is generated
 * (`corpus.generated.json`, written by scripts/build-loupe-data.mts from
 * fixtures/loupe); nothing here reads a file at run time.
 */
import type {
  ManifestEntry,
  Measurement,
  PageInfo,
  RawMeasurement,
  SampleCard,
} from "./contract";
import generated from "./corpus.generated.json";
import { asMeasurements, type RecordedSweep } from "./score";

type SampleFiles = {
  /** `document.<ext>` under public/loupe/samples/<id>/. */
  file: string;
  sha256: string;
  bytes: number;
  pages: { page: number; width: number; height: number }[];
  /** Evidence layer PNGs the recorded Sweep drew. */
  layers: string[];
};

const data = generated as unknown as {
  entries: ManifestEntry[];
  sweeps: { id: string; measurements: RawMeasurement[] }[];
  samples: Record<string, SampleFiles>;
};

/** Where a Sample's static files are served from. Public: synthetic data, no Owner. */
export const SAMPLES_ROOT = "/loupe/samples";

export function sampleUrl(sampleId: string, file: string) {
  return `${SAMPLES_ROOT}/${sampleId}/${file}`;
}

export const MANIFEST: ManifestEntry[] = data.entries;

export const RECORDED: Map<string, RecordedSweep> = new Map(
  data.sweeps.map((sweep) => [sweep.id, sweep]),
);

export function manifestEntry(id: string): ManifestEntry | undefined {
  return MANIFEST.find((entry) => entry.id === id);
}

export function sampleFiles(sampleId: string): SampleFiles | undefined {
  return data.samples[sampleId];
}

/** A Sample's pages as static images. */
export function samplePages(sampleId: string): PageInfo[] {
  return (sampleFiles(sampleId)?.pages ?? []).map((page) => ({
    ...page,
    image: sampleUrl(sampleId, `p${page.page}.jpg`),
  }));
}

/** The Samples on the page. A card never says whether its Document was tampered with. */
export function sampleCards(): SampleCard[] {
  return MANIFEST.filter(
    (entry) => entry.featured && data.samples[entry.id],
  ).map((entry) => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    format: entry.format,
    issuer: entry.issuer,
    blurb: entry.blurb,
    pages: samplePages(entry.id),
    file: sampleUrl(entry.id, data.samples[entry.id].file),
  }));
}

/**
 * A Sample's recorded Sweep as Measurements of an Examination, with each
 * Evidence layer pointing at its static file.
 */
export function recordedMeasurements(sampleId: string): Measurement[] | null {
  const sweep = RECORDED.get(sampleId);
  const files = sampleFiles(sampleId);
  if (!sweep || !files) return null;
  return asMeasurements(
    sweep.measurements.map((item) =>
      // A layer the recorded Sweep names but that was not shipped is dropped.
      item.layer && !files.layers.includes(item.layer)
        ? { ...item, layer: undefined }
        : item,
    ),
    "sweep",
    "sweep",
    "s",
    (file) => sampleUrl(sampleId, file),
  );
}
