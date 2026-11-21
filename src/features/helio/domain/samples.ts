import type { DirectorPreset, HelioMarket, HelioSpecimen } from "./types";

/** Four cross-industry studio RGBA specimen products committed in `public/helio/samples/`. */
export const SPECIMENS: readonly HelioSpecimen[] = [
  {
    slug: "solis-kettle",
    code: "SKU-01",
    name: "Solis No. 2 Pour-Over",
    brand: "SOLIS HOME",
    category: "Industrial Design · Appliances",
    priceTag: "$245",
    tagline: "Matte terracotta ceramic & brushed brass gooseneck.",
    materialNotes:
      "Unlacquered matte terracotta stoneware body with subtle kiln grain, slender satin brushed-brass gooseneck spout, turned dark walnut finial knob, small embossed 'SOLIS' brass medallion near the base.",
    imageUrl: "/helio/samples/solis-kettle.png",
    accentHex: "#c26345",
    defaultMarkets: ["tokyo", "milan", "manila"],
    traditionalShootUsd: 68500,
    traditionalLeadDays: 32,
    traditionalCrewCount: 14,
  },
  {
    slug: "kuro-serum",
    code: "SKU-02",
    name: "Kuro No. 04 Botanical Elixir",
    brand: "KURO ATELIER",
    category: "Luxury Skincare · Retail",
    priceTag: "$138",
    tagline: "Faceted smoked-amber apothecary glass with cotton label.",
    materialNotes:
      "Heavy faceted smoked-amber glass dropper bottle catching internal caustic refractions, matte-black anodized aluminum collar, crisp off-white cotton paper label reading 'KURO / NO. 04 BOTANICAL ELIXIR'.",
    imageUrl: "/helio/samples/kuro-serum.png",
    accentHex: "#b8732d",
    defaultMarkets: ["seoul", "milan", "stockholm"],
    traditionalShootUsd: 82000,
    traditionalLeadDays: 38,
    traditionalCrewCount: 16,
  },
  {
    slug: "stride-runner",
    code: "SKU-03",
    name: "Stride X-Carbon Trail",
    brand: "STRIDE LABS",
    category: "Performance Footwear · Apparel",
    priceTag: "$290",
    tagline: "Sculpted limestone knit over exposed gold-carbon plate.",
    materialNotes:
      "Engineered warm limestone-white mesh upper, deep navy structured heel counter, exposed woven brushed-gold carbon propulsion plate in midsole, aggressive matte charcoal tread lugs.",
    imageUrl: "/helio/samples/stride-runner.png",
    accentHex: "#1d4e89",
    defaultMarkets: ["new-york", "tokyo", "stockholm"],
    traditionalShootUsd: 94000,
    traditionalLeadDays: 42,
    traditionalCrewCount: 19,
  },
  {
    slug: "kestrel-chrono",
    code: "SKU-04",
    name: "Norden Automatic Chrono",
    brand: "NORDEN GENÈVE",
    category: "Horology · Luxury Goods",
    priceTag: "$4,850",
    tagline: "Grade-5 titanium case with federal-blue sunburst dial.",
    materialNotes:
      "Brushed Grade-5 titanium octagonal watch case, deep federal-blue radial sunburst dial reading 'NORDEN AUTOMATIC CHRONOGRAPH' with sharp white chronograph sub-dials, brass-gold tachymeter ring, saddle-tan stitched calfskin strap, anti-reflective sapphire crystal.",
    imageUrl: "/helio/samples/kestrel-chrono.png",
    accentHex: "#d9a84e",
    defaultMarkets: ["milan", "new-york", "tokyo"],
    traditionalShootUsd: 118000,
    traditionalLeadDays: 45,
    traditionalCrewCount: 21,
  },
] as const;

export const MARKETS: readonly HelioMarket[] = [
  {
    id: "tokyo",
    city: "Tokyo",
    country: "Japan",
    label: "Tokyo Rain Flagship",
    language: "Japanese / English",
    kelvin: 4100,
    lens: "85mm f/1.8",
    surface: "Wet black volcanic basalt",
    mood: "Rain-kissed Aoyama concrete, warm lantern bokeh, crisp mirror reflection",
    swatchHex: "#1d4e89",
    defaultHeadline: "Precision, distilled.",
    defaultSubcopy: "Aoyama Flagship Release · 東京限定",
    scenePrompt:
      "Editorial luxury commercial photograph in an Aoyama, Tokyo architectural flagship interior at dusk. The exact hero product rests on a rain-kissed honed dark volcanic basalt plinth with subtle wet mirror reflection beneath it. Soft warm cedar-slat lantern bokeh glows far in the out-of-focus background, cool rain-blue twilight rim light kisses the edge of the object. Shallow depth of field, medium-format 85mm lens, physically accurate contact shadows and surface reflections.",
  },
  {
    id: "milan",
    city: "Milan",
    country: "Italy",
    label: "Milan Travertine Salon",
    language: "Italian / English",
    kelvin: 5200,
    lens: "90mm Macro",
    surface: "Honed Roman travertine",
    mood: "Brera gallery daylight, architectural louver shadows, warm gallery stone",
    swatchHex: "#d9a84e",
    defaultHeadline: "Form meets quiet light.",
    defaultSubcopy: "Collezione Milano · Brera Edition",
    scenePrompt:
      "High-fashion Italian architectural still life in a sunlit Brera, Milan gallery. The exact hero product stands on a monolithic block of honed warm Roman travertine marble. Crisp afternoon Mediterranean sunlight streams through unseen architectural louvers, casting sculptural diagonal shadows across the limestone wall behind. Museum-grade editorial lighting, natural bounce warmth, razor-sharp product texture, medium-format 90mm photography.",
  },
  {
    id: "manila",
    city: "Manila",
    country: "Philippines",
    label: "Manila Golden Terrace",
    language: "English / Filipino",
    kelvin: 3100,
    lens: "65mm f/2.0",
    surface: "Brushed narra wood & capiz light",
    mood: "Tropical golden hour, warm palm-frond dappled shadows, sunlit teak",
    swatchHex: "#c26345",
    defaultHeadline: "Crafted for the warm hour.",
    defaultSubcopy: "Makati Design Showcase · Limited Drop",
    scenePrompt:
      "Sun-drenched tropical modernist commercial photograph on an elevated Makati penthouse terrace at golden hour. The exact hero product is placed on a wide brushed narra hardwood table beside a subtle shadow of palm fronds cast by low 3100K amber sunlight. Warm architectural limestone wall and soft glowing sunset sky haze out of focus behind. Rich natural rim glow, honest shadows, tactile material reflections.",
  },
  {
    id: "stockholm",
    city: "Stockholm",
    country: "Sweden",
    label: "Stockholm Winter Light",
    language: "Swedish / English",
    kelvin: 6400,
    lens: "80mm f/2.2",
    surface: "Pale ash & frosted glass",
    mood: "Crisp Nordic daylight, cool architectural serenity, soft linen texture",
    swatchHex: "#6fa0dc",
    defaultHeadline: "Stripped to essentials.",
    defaultSubcopy: "Nordic Monograph · Stockholm Studio",
    scenePrompt:
      "Minimalist Scandinavian design monograph photograph in a Stockholm waterfront studio. The exact hero product rests on pale brushed Nordic ash wood in front of translucent fluted architectural glass diffusing crisp 6400K winter northern daylight. Clean cool highlights, whisper-soft shadow gradient, calm gallery restraint, zero visual clutter, Hasselblad medium-format precision.",
  },
  {
    id: "new-york",
    city: "New York",
    country: "USA",
    label: "SoHo Brutalist Loft",
    language: "English",
    kelvin: 4800,
    lens: "50mm f/2.0",
    surface: "Poured raw concrete & steel",
    mood: "Cast-iron loft daylight, bold editorial contrast, raw industrial polish",
    swatchHex: "#4a4f5b",
    defaultHeadline: "Built to command the room.",
    defaultSubcopy: "SoHo Flagship · Crosby Street Drop",
    scenePrompt:
      "Bold editorial flagship campaign photograph inside a SoHo, New York cast-iron loft. The exact hero product sits on a chamfered raw architectural concrete pedestal with a thin brushed-steel inlay edge. High-contrast skylight beams cut from upper left, carving crisp specular highlights across the product materials while the industrial brick-and-steel loft recedes into moody bokeh.",
  },
  {
    id: "seoul",
    city: "Seoul",
    country: "South Korea",
    label: "Seongsu Glass Pop-Up",
    language: "Korean / English",
    kelvin: 5600,
    lens: "75mm f/1.8",
    surface: "Ribbed smoked glass & chrome",
    mood: "Seongsu-dong avant-garde retail, chromatic prism refraction, gallery gloss",
    swatchHex: "#2f6b3f",
    defaultHeadline: "Next-wave object craft.",
    defaultSubcopy: "Seongsu Flagship · 성수 팝업 에디션",
    scenePrompt:
      "Avant-garde luxury retail campaign photograph in a Seongsu-dong, Seoul design pop-up gallery. The exact hero product is staged on a thick ribbed crystal glass plinth above brushed aluminum, catching clean prism-like studio light reflections and subtle emerald-cool architectural accents in the minimalist gallery background. Razor-sharp macro detail, ultra-modern commercial lighting.",
  },
] as const;

export const DIRECTOR_PRESETS: readonly DirectorPreset[] = [
  {
    id: "golden-hour",
    label: "Golden Hour Rim",
    shortTag: "2900K",
    kelvinLabel: "2900K Low Sun",
    instruction:
      "Relight this exact scene and product with dramatic 2900K low-angle golden hour sunlight coming from the left edge, casting long warm architectural shadows to the right and igniting a warm amber specular rim highlight along the silhouette while keeping the product geometry and branding 100% unchanged.",
  },
  {
    id: "tokyo-localize",
    label: "Localize Tokyo Edition",
    shortTag: "東京限定",
    kelvinLabel: "Pack + Card",
    instruction:
      "Keep the exact product and lighting coherent, and introduce an authentic minimalist Japanese flagship display card tucked tastefully beside the product base printed in crisp editorial ink reading '東京限定 · LIMITED EDITION' while preserving every product detail and reflection.",
  },
  {
    id: "noir-chiaroscuro",
    label: "Noir Spotlight",
    shortTag: "CHIAROSCURO",
    kelvinLabel: "3600K Spot",
    instruction:
      "Transform the lighting of this exact shot into high-drama museum chiaroscuro: darken the surrounding backdrop into deep obsidian slate shadow and carve a tight overhead theatrical spotlight directly onto the product so its textures, curves, and metallic reflections gleam dramatically.",
  },
  {
    id: "macro-mist",
    label: "Atmosphere & Mist",
    shortTag: "TACTILE",
    kelvinLabel: "Fine Vapor",
    instruction:
      "Keep the exact product and setting identical, and add ultra-fine cinematic atmospheric depth: subtle sunlit wisps of warm mist / condensation catch the key light beam behind the product, elevating tactile luxury realism without obscuring the product or label.",
  },
] as const;

export function findSpecimen(slug: string): HelioSpecimen | undefined {
  return SPECIMENS.find((item) => item.slug === slug);
}

export function findMarket(id: string): HelioMarket | undefined {
  return MARKETS.find((item) => item.id === id);
}

export function calculateRoi(input: {
  traditionalUsd: number;
  traditionalDays: number;
  aiCostUsd: number;
  aiSeconds: number;
  frameCount: number;
}) {
  const safeAiCost = Math.max(0.001, input.aiCostUsd);
  const safeAiSeconds = Math.max(1, input.aiSeconds);
  const savingsUsd = Math.max(0, input.traditionalUsd - safeAiCost);
  const costReductionPct = Math.min(
    99.99,
    Math.max(0, (savingsUsd / Math.max(1, input.traditionalUsd)) * 100),
  );
  const traditionalSeconds = input.traditionalDays * 24 * 3600;
  const speedMultiplier = Math.round(traditionalSeconds / safeAiSeconds);
  return {
    savingsUsd,
    costReductionPct,
    speedMultiplier,
    costPerFrameUsd: safeAiCost / Math.max(1, input.frameCount),
  };
}
