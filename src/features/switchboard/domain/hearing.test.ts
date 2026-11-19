import { describe, expect, it } from "vitest";
import {
  detectLanguage,
  mentionedLine,
  missingLines,
  normalizeSpeech,
  saysLine,
} from "./hearing";

describe("normalizeSpeech", () => {
  it("lowercases, strips accents and keeps only words and digits", () => {
    expect(normalizeSpeech("Días hábiles")).toBe("dias habiles");
    expect(normalizeSpeech("  Meridia Rail's A.I.  agent!  ")).toBe(
      "meridia rail s a i agent",
    );
    expect(normalizeSpeech("Estación, ¿sí?")).toBe("estacion si");
    expect(normalizeSpeech("MR-7K2Q9F")).toBe("mr 7k2q9f");
  });

  it("keeps the prefix star", () => {
    expect(normalizeSpeech("Injur*")).toBe("injur*");
  });

  it("empties text with no words", () => {
    expect(normalizeSpeech(" ... ¡! ")).toBe("");
  });
});

describe("saysLine", () => {
  it("finds a whole word", () => {
    expect(saysLine("This call is recorded.", "recorded")).toBe(true);
    expect(saysLine("This call is RECORDED.", "recorded")).toBe(true);
  });

  it("matches any of the alternatives", () => {
    expect(
      saysLine("Ang tawag na ito ay nire-record.", "recorded|nire-record"),
    ).toBe(true);
    expect(saysLine("Esta llamada se graba.", "recorded|graba*")).toBe(true);
    expect(saysLine("Nothing here.", "recorded|graba*")).toBe(false);
  });

  it("matches whole tokens only, unless the alternative ends in a star", () => {
    expect(saysLine("Your ticket was refunded.", "refund")).toBe(false);
    expect(saysLine("Your ticket was refunded.", "refund*")).toBe(true);
    expect(saysLine("I need a refund.", "refund")).toBe(true);
    expect(saysLine("I said nothing", "ai")).toBe(false);
  });

  it("needs words of a phrase in order and next to each other", () => {
    expect(saysLine("five working days", "working days")).toBe(true);
    expect(saysLine("days of working", "working days")).toBe(false);
    expect(saysLine("working hard, five days", "working days")).toBe(false);
  });

  it("tolerates punctuation and accents in the phrase", () => {
    expect(saysLine("You are speaking with an a.i. agent", "a.i.")).toBe(true);
    expect(saysLine("Habla con el jefe de estación", "jefe de estacion")).toBe(
      true,
    );
    expect(
      saysLine("I'm the station manager", "i'm a manager|station manager"),
    ).toBe(true);
  });

  it("does not let a star the speaker said act as a wildcard", () => {
    expect(saysLine("refun*", "refund")).toBe(false);
  });

  it("never matches an empty alternative or a bare star", () => {
    expect(saysLine("anything at all", "")).toBe(false);
    expect(saysLine("anything at all", "*")).toBe(false);
    expect(saysLine("anything at all", "|")).toBe(false);
  });
});

describe("missingLines", () => {
  const lines = ["recorded|recording", "ai|artificial"];

  it("returns nothing when every line was said", () => {
    expect(
      missingLines(
        "This call is recorded and I am Meridia Rail's AI agent.",
        lines,
      ),
    ).toEqual([]);
  });

  it("returns the lines still missing", () => {
    expect(missingLines("This call is recorded.", lines)).toEqual([
      "ai|artificial",
    ]);
    expect(missingLines("", lines)).toEqual(lines);
  });
});

describe("mentionedLine", () => {
  const lines = ["injur*|hurt", "lawyer|solicitor"];

  it("returns the first line that matched", () => {
    expect(mentionedLine("My lawyer says I was injured.", lines)).toBe(
      "injur*|hurt",
    );
    expect(mentionedLine("Talk to my solicitor.", lines)).toBe(
      "lawyer|solicitor",
    );
  });

  it("returns null when nothing matched", () => {
    expect(mentionedLine("The train was late.", lines)).toBeNull();
    expect(mentionedLine("anything", [])).toBeNull();
  });
});

describe("detectLanguage", () => {
  it("hears English", () => {
    expect(detectLanguage("Hi, I want to change my train please.")).toBe("en");
    expect(detectLanguage("Thanks")).toBe("en");
  });

  it("hears Tagalog", () => {
    expect(
      detectLanguage(
        "Ay, sorry po, pwede bang Tagalog na lang? Mas madali po para sa akin.",
      ),
    ).toBe("tl");
    expect(detectLanguage("Salamat po. Opo, tama po.")).toBe("tl");
  });

  it("hears Taglish", () => {
    expect(
      detectLanguage(
        "Pwede po ba na i-move ko yung booking to the later train?",
      ),
    ).toBe("tl-en");
  });

  it("hears Spanish", () => {
    expect(
      detectLanguage(
        "Buenos días, necesito una rampa para el tren, por favor.",
      ),
    ).toBe("es");
    expect(detectLanguage("Gracias")).toBe("es");
  });

  it("does not guess from too little", () => {
    expect(detectLanguage("")).toBe("und");
    expect(detectLanguage("...")).toBe("und");
    expect(detectLanguage("Hmm")).toBe("und");
    expect(detectLanguage("MR-7K2Q9F 4107")).toBe("und");
  });
});
