import { isoDate, yearOf } from "../dates";
import { nameScore, sameName, words } from "../names";
import {
  type Check,
  documentsOf,
  type Hit,
  list,
  names,
  type RunState,
  text,
} from "../run-state";
import type { JobOutcome } from "./types";

export type WatchlistEntry = {
  id: string;
  name: string;
  aliases: string[];
  date_of_birth: string;
  nationality: string;
  list_type: "sanctions" | "pep" | "adverse_media";
  list_source: string;
  reason: string;
};

export const HIT_THRESHOLD = 88;

/** Everyone in the case worth screening, with the role they play. */
export function namesToScreen(state: RunState) {
  const found: { name: string; role: string }[] = [];
  const add = (name: string, role: string) => {
    if (name && !found.some((item) => sameName(item.name, name, 95)))
      found.push({ name, role });
  };
  for (const document of state.documents) {
    if (!document.fields) continue;
    switch (document.kind) {
      case "withdrawal_request_form":
        add(text(document, "member_name"), "member");
        add(text(document, "payee_name"), "payee");
        break;
      case "member_statement":
        add(text(document, "member_name"), "member");
        break;
      case "customer_profile":
        add(text(document, "customer_name"), "customer");
        break;
      case "employer_application":
        add(text(document, "employer_name"), "employer");
        for (const name of names(document, "signatory_names"))
          add(name, "signatory");
        break;
      case "register_of_directors":
        for (const item of list<{ name: string; role?: string }>(
          document,
          "directors",
        ))
          add(item.name, item.role || "director");
        break;
      case "authorised_signatories":
        for (const item of list<{ name: string }>(document, "signatories"))
          add(item.name, "signatory");
        break;
      case "trust_deed":
        for (const name of names(document, "settlor_names"))
          add(name, "settlor");
        for (const name of names(document, "trustee_names"))
          add(name, "trustee");
        for (const name of names(document, "protector_names"))
          add(name, "protector");
        for (const name of names(document, "beneficiary_names"))
          add(name, "beneficiary");
        break;
      case "register_of_members":
        for (const item of list<{ holder_name: string }>(document, "members"))
          add(item.holder_name, "shareholder");
        break;
      case "identity_document":
        add(text(document, "full_name"), "ID holder");
        break;
      default:
        break;
    }
  }
  for (const ubo of state.ownership?.ubos ?? []) add(ubo.name, ubo.role);
  return found;
}

/** screen: every name against the watchlist, keeping hits at or above the threshold. */
export function screen(
  state: RunState,
  watchlist: WatchlistEntry[],
): JobOutcome {
  const people = namesToScreen(state);
  const hits: Hit[] = [];
  for (const person of people) {
    for (const entry of watchlist) {
      const score = Math.max(
        nameScore(person.name, entry.name),
        ...entry.aliases.map((alias) => nameScore(person.name, alias)),
      );
      if (score < HIT_THRESHOLD) continue;
      hits.push({
        screenedName: person.name,
        role: person.role,
        hitName: entry.name,
        listType: entry.list_type,
        listSource: entry.list_source,
        reference: entry.id,
        score,
        hitDateOfBirth: entry.date_of_birth,
        hitNationality: entry.nationality,
        aliases: entry.aliases,
        reason: entry.reason,
      });
    }
  }
  const checks: Check[] = [
    {
      id: "screening_clear",
      outcome: hits.length === 0 ? "pass" : "review",
      detail:
        hits.length === 0
          ? `${people.length} names screened, no hits`
          : `${hits.length} potential match${hits.length === 1 ? "" : "es"} to weigh: ${hits.map((hit) => hit.hitName).join(", ")}`,
      job: "screen",
      evidence: [],
    },
  ];
  return {
    checks,
    patch: { hits },
    summary: `${people.length} names screened, ${hits.length} hit${hits.length === 1 ? "" : "s"}`,
  };
}

type AlertHit = {
  hit_name?: string;
  list_type?: string;
  list_source?: string;
  match_score?: number;
  hit_date_of_birth?: string;
  hit_nationality?: string;
  hit_reference?: string;
};

/** Hits listed on screening alert Documents, filled out from the watchlist where it knows them. */
export function hitsFromAlerts(
  state: RunState,
  watchlist: WatchlistEntry[],
): Hit[] {
  return documentsOf(state, "screening_alert").flatMap((alert) =>
    list<AlertHit>(alert, "hits").map((item): Hit => {
      const entry =
        watchlist.find((candidate) => candidate.id === item.hit_reference) ??
        watchlist.find((candidate) =>
          sameName(candidate.name, item.hit_name ?? "", 95),
        );
      const listType =
        (["sanctions", "pep", "adverse_media"] as const).find(
          (type) => type === item.list_type,
        ) ??
        entry?.list_type ??
        "sanctions";
      return {
        screenedName: text(alert, "customer_name"),
        role: "customer",
        hitName: item.hit_name ?? entry?.name ?? "",
        listType,
        listSource: item.list_source ?? entry?.list_source ?? "",
        reference: item.hit_reference ?? entry?.id ?? "",
        score: Number(item.match_score ?? 0),
        hitDateOfBirth: item.hit_date_of_birth ?? entry?.date_of_birth ?? "",
        hitNationality: item.hit_nationality ?? entry?.nationality ?? "",
        aliases: entry?.aliases ?? [],
        reason: entry?.reason ?? "",
      };
    }),
  );
}

/** What the case knows about the person a hit was raised on. */
export function personFacts(state: RunState, name: string) {
  const facts = {
    dateOfBirth: "",
    nationality: "",
    otherNames: [] as string[],
    idNumbers: [] as string[],
    residence: "",
  };
  for (const document of state.documents) {
    if (!document.fields) continue;
    if (
      document.kind === "customer_profile" &&
      sameName(text(document, "customer_name"), name, 80)
    ) {
      facts.dateOfBirth ||= text(document, "date_of_birth");
      facts.nationality ||= text(document, "nationality");
      facts.residence ||= text(document, "residence");
      facts.otherNames.push(...names(document, "other_names"));
      facts.idNumbers.push(text(document, "id_number"));
    }
    if (
      document.kind === "identity_document" &&
      (sameName(text(document, "full_name"), name, 80) ||
        state.pipeline === "screening_review")
    ) {
      facts.dateOfBirth ||= text(document, "date_of_birth");
      facts.nationality ||= text(document, "nationality");
      facts.idNumbers.push(text(document, "id_number"));
    }
    if (
      (document.kind === "member_statement" ||
        document.kind === "withdrawal_request_form") &&
      sameName(text(document, "member_name"), name, 85)
    ) {
      facts.dateOfBirth ||= text(document, "date_of_birth");
    }
    if (document.kind === "register_of_directors") {
      for (const director of list<{
        name: string;
        date_of_birth?: string;
        nationality?: string;
      }>(document, "directors")) {
        if (sameName(director.name, name, 85)) {
          facts.dateOfBirth ||= director.date_of_birth ?? "";
          facts.nationality ||= director.nationality ?? "";
        }
      }
    }
  }
  facts.idNumbers = facts.idNumbers.filter(Boolean);
  return facts;
}

const DEMONYMS: Record<string, string> = {
  nigerian: "nigeria",
  british: "united kingdom",
  jamaican: "jamaica",
  filipino: "philippines",
  caymanian: "cayman islands",
  canadian: "canada",
  american: "united states",
  indian: "india",
  honduran: "honduras",
  venezuelan: "venezuela",
  spanish: "spain",
  italian: "italy",
  romanian: "romania",
  russian: "russia",
  chinese: "china",
  colombian: "colombia",
  brazilian: "brazil",
  jordanian: "jordan",
  lebanese: "lebanon",
  cypriot: "cyprus",
};

function country(value: string) {
  const key = words(value).join(" ");
  return DEMONYMS[key] ?? key;
}

/**
 * A first disposition from identifiers alone, the way an analyst starts: a
 * different full date of birth discounts; a matching full date confirms; a
 * year alone is not enough. The model refines it on live runs.
 */
export function proposeDisposition(
  hit: Hit,
  facts: ReturnType<typeof personFacts>,
): Pick<Hit, "disposition" | "dispositionReason"> {
  if (/deceased|died|death/i.test(hit.reason)) {
    return {
      disposition: "false_positive",
      dispositionReason: `The listed person is recorded as deceased: ${hit.reason}`,
    };
  }
  const listed = isoDate(hit.hitDateOfBirth);
  const known = isoDate(facts.dateOfBirth);
  const listedYear = yearOf(hit.hitDateOfBirth);
  const knownYear = known ? Number(known.slice(0, 4)) : null;
  const sameCountry =
    hit.hitNationality && facts.nationality
      ? country(hit.hitNationality) === country(facts.nationality)
      : null;
  const aliasMatch = facts.otherNames.some((name) =>
    [hit.hitName, ...hit.aliases].some((alias) => sameName(alias, name, 95)),
  );
  if (listed && known) {
    const swapped = `${listed.slice(0, 4)}-${listed.slice(8, 10)}-${listed.slice(5, 7)}`;
    if (listed !== known && swapped === known) {
      return {
        disposition: "inconclusive",
        dispositionReason: `List date of birth ${listed} is the customer's ${known} with day and month swapped; cannot discount.`,
      };
    }
    if (listed === known) {
      return {
        disposition: "true_match",
        dispositionReason: `Same full date of birth (${known})${sameCountry ? " and nationality" : ""} as the listed ${hit.hitName}.`,
      };
    }
    return {
      disposition: "false_positive",
      dispositionReason: `Different date of birth: list ${listed}, customer ${known}${sameCountry === false ? `; nationality ${hit.hitNationality} vs ${facts.nationality}` : ""}.`,
    };
  }
  if (listedYear && knownYear) {
    if (Math.abs(listedYear - knownYear) > 1) {
      return {
        disposition: "false_positive",
        dispositionReason: `Born ${listedYear} on the list against ${knownYear} for the customer.`,
      };
    }
    if (sameCountry === false) {
      return {
        disposition: "false_positive",
        dispositionReason: `Different nationality: the listed person is ${hit.hitNationality}, the customer ${facts.nationality}.`,
      };
    }
    if (aliasMatch && listedYear === knownYear) {
      return {
        disposition: "true_match",
        dispositionReason: `Same birth year (${knownYear}) and a shared alias with the listed ${hit.hitName}.`,
      };
    }
    return {
      disposition: "inconclusive",
      dispositionReason: `The list gives only the year ${listedYear}, which matches; not enough to confirm or discount.`,
    };
  }
  if (sameCountry === false) {
    return {
      disposition: "inconclusive",
      dispositionReason: `No date of birth to compare; nationality differs (${hit.hitNationality} vs ${facts.nationality}).`,
    };
  }
  return {
    disposition: "inconclusive",
    dispositionReason: "Too little on the list to confirm or discount.",
  };
}

/** The screening Check once every hit has a disposition. */
export function screeningCheck(hits: Hit[]): Check {
  const sanctions = hits.filter(
    (hit) => hit.disposition === "true_match" && hit.listType === "sanctions",
  );
  const other = hits.filter(
    (hit) => hit.disposition === "true_match" && hit.listType !== "sanctions",
  );
  const open = hits.filter((hit) => hit.disposition === "inconclusive");
  const cleared = hits.filter((hit) => hit.disposition === "false_positive");
  const outcome: Check["outcome"] =
    sanctions.length > 0
      ? "fail"
      : other.length + open.length > 0
        ? "review"
        : "pass";
  const parts = [
    sanctions.length
      ? `sanctions match: ${sanctions.map((hit) => hit.hitName).join(", ")}`
      : "",
    other.length
      ? `${other.map((hit) => `${hit.listType === "pep" ? "PEP" : "adverse media"} match: ${hit.hitName}`).join(", ")}`
      : "",
    open.length ? `${open.length} inconclusive` : "",
    cleared.length ? `${cleared.length} discounted` : "",
  ].filter(Boolean);
  return {
    id: "screening_clear",
    outcome,
    detail:
      hits.length === 0
        ? "No hits"
        : parts.join("; ").replace(/^./, (c) => c.toUpperCase()),
    job: "adjudicate",
    evidence: [],
  };
}

/** adjudicate without a model: every hit gets the identifier-based proposal. */
export function adjudicate(
  state: RunState,
  watchlist: WatchlistEntry[],
): JobOutcome {
  const base =
    state.hits && state.hits.length > 0
      ? state.hits
      : hitsFromAlerts(state, watchlist);
  const hits = base.map((hit) => ({
    ...hit,
    ...proposeDisposition(hit, personFacts(state, hit.screenedName)),
  }));
  const check = screeningCheck(hits);
  const blind = hits.find((hit) => {
    const facts = personFacts(state, hit.screenedName);
    return (
      hit.disposition === "inconclusive" &&
      !facts.dateOfBirth &&
      !facts.nationality &&
      facts.idNumbers.length === 0
    );
  });
  return {
    checks: hits.length > 0 || state.hits ? [check] : [],
    patch: { hits },
    summary: hits.length === 0 ? "No hits to weigh" : check.detail,
    question: blind
      ? {
          prompt: `Nothing on file says when or where ${blind.screenedName} was born, so the ${blind.hitName} hit can't be weighed. Do you have a certified passport?`,
          kinds: ["identity_document"],
        }
      : undefined,
  };
}
