import { describe, expect, it } from "vitest";
import { play, type Round } from "./engine";
import { SCENARIOS, scenarioById } from "./scenarios";
import { checkStatement, found, passes, phrase } from "./statement";
import { stubDrafts } from "./stub";

const halyard = scenarioById("halyard-air");
if (!halyard) throw new Error("missing scenario");

const option = (inject: string, id: string): Round => ({
  inject,
  choice: { kind: "option", option: id },
  levers: [],
});

const careful = play(halyard, [
  option("screens-black", "screens-black/roster"),
  option("courier-memo", "courier-memo/confirm"),
  option("duty-hours", "duty-hours/hall"),
  option("authority-letter", "authority-letter/file"),
  option("decryptor-offer", "decryptor-offer/care"),
  option("back-in-the-air", "back-in-the-air/crews"),
]);

const failed = (text: string, state = careful) =>
  checkStatement(halyard, state, text)
    .filter((note) => !note.ok)
    .map((note) => note.check);

const GOOD =
  "To every passenger affected this weekend: a cyberattack took down our crew scheduling on Friday. We have flown 94 percent of Monday's schedule, put stranded passengers in hotels and told the Authority. Check the Halyard app to rebook. Our next update is at 18:00 today.";

describe("checkStatement", () => {
  it("passes a plain, honest Statement", () => {
    expect(failed(GOOD)).toEqual([]);
  });

  it("asks for the people, an action and a time", () => {
    expect(
      failed("We had a difficult weekend and we are working hard."),
    ).toEqual(expect.arrayContaining(["who", "action", "next-update"]));
  });

  it("strikes guesses and blame, quoting the words", () => {
    const notes = checkStatement(
      halyard,
      careful,
      `${GOOD} It was probably the vendor's fault.`,
    );
    expect(notes.find((n) => n.check === "no-speculation")?.quotes).toEqual([
      "probably",
    ]);
    expect(notes.find((n) => n.check === "no-blame")?.quotes).toEqual([
      "fault",
    ]);
  });

  it("refuses a promise the executive did not make", () => {
    // Refunds were never pulled in this drill.
    expect(failed(`${GOOD} Everyone gets a full refund.`)).toEqual([
      "promises",
    ]);
  });

  it("caps the length", () => {
    expect(failed(`${GOOD} ${"More words here. ".repeat(40)}`)).toContain(
      "length",
    );
  });

  it("asks for an apology only when the drill went badly", () => {
    const badly = play(halyard, [
      option("screens-black", "screens-black/tell"),
      option("terminal-queues", "terminal-queues/hold"),
      option("passports-posted", "passports-posted/hold"),
      option("authority-letter", "authority-letter/vendor"),
    ]);
    expect(failed(GOOD, badly)).toContain("apology");
    expect(failed(`We are sorry. ${GOOD}`, badly)).not.toContain("apology");
  });
});

describe("phrase", () => {
  it("never matches a short word inside a longer one", () => {
    expect(phrase("app").test("this will apply")).toBe(false);
    expect(phrase("app").test("use the app")).toBe(true);
    expect(phrase("refund").test("full refunds")).toBe(true);
    expect(found("Do NOT eat it", ["do not eat"])).toEqual(["Do NOT eat"]);
  });
});

describe.each(SCENARIOS)("stubDrafts for $id", (scenario) => {
  it("fails the first draft and passes the second", () => {
    const state = play(scenario, []);
    const [first, second] = stubDrafts(scenario, state);
    expect(passes(checkStatement(scenario, state, first ?? ""))).toBe(false);
    expect(
      checkStatement(scenario, state, second ?? "").filter((n) => !n.ok),
    ).toEqual([]);
  });
});
