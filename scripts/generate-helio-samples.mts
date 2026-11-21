/**
 * Generates the four studio-grade transparent RGBA specimen product plates
 * for Helio using Microsoft MAI Image 2.7-Flash (Nov 2026) via Vercel AI Gateway.
 *
 * Run once after changing specimen briefs:
 *   node --env-file=.env.local --experimental-strip-types scripts/generate-helio-samples.mts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGateway, generateImage } from "ai";

const OUT_DIR = join(process.cwd(), "public", "helio", "samples");

const SPECIMENS = [
  {
    slug: "solis-kettle",
    prompt:
      "Ultra-clean commercial industrial-design studio photograph of a minimalist matte terracotta ceramic electric pour-over coffee kettle with a slender brushed-brass gooseneck spout, dark walnut lid knob, and small subtle embossed 'SOLIS' brass badge near the base. Three-quarter front hero angle, crisp softbox studio lighting, razor-sharp silhouette, completely isolated single object centered with generous margin, transparent background, no shadow on floor, no props, no text outside the product.",
  },
  {
    slug: "kuro-serum",
    prompt:
      "Ultra-clean luxury skincare commercial studio photograph of a faceted smoked-amber glass botanical dropper bottle with a heavy matte-black anodized aluminum collar and glass pipette cap. Minimalist off-white cotton paper front label with crisp black serif typography reading 'KURO' and 'NO. 04 BOTANICAL ELIXIR'. Straight-on hero angle, crisp specular studio rim light, completely isolated single object centered with generous margin, transparent background, no floor shadow, no props.",
  },
  {
    slug: "stride-runner",
    prompt:
      "Ultra-clean athletic footwear commercial studio photograph of a single futuristic trail-running shoe in sculpted warm limestone-white engineered knit, dark navy technical heel counter, exposed brushed-gold carbon midsole plate, and aggressive charcoal lug outsole. Clean side-three-quarter profile facing right, dramatic crisp studio key light, completely isolated single shoe centered with generous margin, transparent background, no floor shadow, no props.",
  },
  {
    slug: "kestrel-chrono",
    prompt:
      "Ultra-clean Swiss-style horology studio photograph of a mechanical chronograph wristwatch standing upright on an invisible mount: brushed Grade-5 titanium octagonal case, deep federal-blue sunburst dial with crisp white sub-dials, brass-gold tachymeter accents, and stitched saddle-tan calfskin leather strap. Front hero angle set to 10:10, razor-sharp macro reflections on sapphire crystal, completely isolated single watch centered with generous margin, transparent background, no floor shadow, no props.",
  },
] as const;

async function main() {
  const apiKey =
    process.env.HELIO_AI_GATEWAY_API_KEY ||
    process.env.DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set HELIO_AI_GATEWAY_API_KEY or DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY",
    );
  }

  await mkdir(OUT_DIR, { recursive: true });
  const gw = createGateway({ apiKey });
  const model = gw.imageModel("microsoft/mai-image-2.7-flash");

  console.log(
    `Generating ${SPECIMENS.length} RGBA specimen plates in parallel…`,
  );
  const results = await Promise.all(
    SPECIMENS.map(async (item) => {
      const started = Date.now();
      const res = await generateImage({
        model,
        prompt: item.prompt,
        size: "1024x1024",
        providerOptions: {
          azure: {
            background: "transparent",
          },
        },
      });
      const bytes = res.image.uint8Array;
      const outPath = join(OUT_DIR, `${item.slug}.png`);
      await writeFile(outPath, bytes);
      const colorType = bytes[0] === 0x89 && bytes[1] === 0x50 ? bytes[25] : -1;
      console.log(
        `  ✓ ${item.slug}.png (${(bytes.length / 1024).toFixed(0)} KB, PNG colorType=${colorType}, ${Date.now() - started} ms)`,
      );
      return outPath;
    }),
  );

  console.log(`Done! Wrote ${results.length} files to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
