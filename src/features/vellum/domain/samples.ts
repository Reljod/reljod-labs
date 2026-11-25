/**
 * The sample screenshots a visitor can hand to Vellum. Each is rendered from
 * `fixtures/vellum/<slug>.html` by `pnpm render:vellum-samples`; width and
 * height are the PNG's pixel size (the screen's CSS size at scale 1).
 */
export type Sample = {
  slug: string;
  title: string;
  kind: string;
  width: number;
  height: number;
  src: string;
  thumb: string;
};

function sample(
  slug: string,
  title: string,
  kind: string,
  width: number,
  height: number,
): Sample {
  return {
    slug,
    title,
    kind,
    width,
    height,
    src: `/vellum/samples/${slug}.png`,
    thumb: `/vellum/samples/${slug}.thumb.jpg`,
  };
}

export const SAMPLES: readonly Sample[] = [
  sample("rail-ticket", "Rail e-ticket", "Mobile app", 390, 844),
  sample("harbour-dashboard", "Berths dashboard", "Dashboard", 1280, 800),
  sample("tidewater-card", "Bank hero", "Landing page", 1280, 720),
  sample("ferry-poster", "Ferry Week poster", "Poster", 900, 1200),
];

export function sampleBySlug(slug: string): Sample | undefined {
  return SAMPLES.find((s) => s.slug === slug);
}
