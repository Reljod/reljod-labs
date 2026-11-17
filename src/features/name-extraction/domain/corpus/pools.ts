/**
 * Name pools for the synthetic Corpus. Every name is invented for the fictional
 * Republic of Meridia; the pools mix naming cultures on purpose so the Corpus
 * exercises particles, hyphens, transliteration, nicknames and surname-first
 * order. Text stays inside WinAnsi (Latin-1 plus a few marks) so the sample
 * PDFs can print it with a standard font.
 */

export type GivenSeed = {
  name: string;
  sex: "f" | "m";
  /** A nickname printed as "<nick> <surname>". */
  nick?: string;
  /** Transliteration variants, e.g. Mohammed / Muhammad. */
  variants?: string[];
};

export type Culture = {
  key: string;
  given: GivenSeed[];
  /** Surnames; "a|b" lists a transliteration variant b. */
  surnames: string[];
  /** Surnames take a feminine ending for women (Volkov / Volkova). */
  gendered?: boolean;
  /** Second given names (or patronymics) used for some people. */
  middle?: { f: string[]; m: string[] };
  honorifics: { f: string[]; m: string[] };
  /** Surname printed first in native order ("CHEN Jiahui"). */
  surnameFirst?: boolean;
};

const g = (
  name: string,
  sex: "f" | "m",
  extra: { nick?: string; variants?: string[] } = {},
): GivenSeed => ({ name, sex, ...extra });

const WESTERN = { f: ["Ms", "Mrs", "Dr"], m: ["Mr", "Dr"] };

export const CULTURES: Culture[] = [
  {
    key: "lusophone",
    given: [
      g("Ana", "f"),
      g("Lucía", "f"),
      g("João", "m", { variants: ["Joao"] }),
      g("María", "f"),
      g("José", "m", { nick: "Pepe" }),
      g("Carlos", "m"),
      g("Isabel", "f"),
      g("Tomás", "m"),
      g("Beatriz", "f"),
      g("Rafael", "m", { nick: "Rafa" }),
      g("Inês", "f"),
    ],
    surnames: [
      "Ferreira-Vos",
      "dos Santos",
      "de la Cruz",
      "Albuquerque",
      "Monteiro",
      "Salgado-Reis",
      "Pereira",
      "Valadares",
      "de Souza-Lima",
      "Quintela",
    ],
    middle: { f: ["Lucía", "Helena", "Graça"], m: ["Augusto", "Manuel"] },
    honorifics: { f: ["Sra.", "Dr", "Ms"], m: ["Sr.", "Dr", "Mr"] },
  },
  {
    key: "dutch",
    given: [
      g("Pieter", "m"),
      g("Johanna", "f", { nick: "Hanna" }),
      g("Willem", "m", { nick: "Wim" }),
      g("Anneke", "f"),
      g("Klaus", "m"),
      g("Greta", "f"),
      g("Henrik", "m"),
      g("Maarten", "m"),
    ],
    surnames: [
      "van der Merwe",
      "de Vries",
      "van den Bosch",
      "Brandt",
      "von Hollen",
      "Vogelsang",
      "ter Horst",
      "Grünwald|Gruenwald",
      "van Leeuwen",
      "Achterberg",
    ],
    middle: { f: ["Maria", "Elisabeth"], m: ["Jan", "Cornelis"] },
    honorifics: WESTERN,
  },
  {
    key: "arabic",
    given: [
      g("Mohammed", "m", { variants: ["Muhammad", "Mohamad", "Mohamed"] }),
      g("Yusuf", "m", { variants: ["Yousef", "Youssef"] }),
      g("Hussein", "m", { variants: ["Husain"] }),
      g("Abdullah", "m", { variants: ["Abdallah"] }),
      g("Khalid", "m", { variants: ["Khaled"] }),
      g("Omar", "m", { variants: ["Umar"] }),
      g("Fatima", "f", { variants: ["Fatimah"] }),
      g("Aisha", "f", { variants: ["Ayesha"] }),
      g("Layla", "f", { variants: ["Leila"] }),
      g("Tariq", "m", { variants: ["Tareq"] }),
    ],
    surnames: [
      "al-Rashid",
      "al-Mansouri",
      "bin Hamad",
      "Haddad",
      "el-Amin",
      "bin Saleh",
      "al-Farsi",
      "Nasrallah",
      "al-Qasimi",
      "Khoury",
    ],
    middle: { f: ["Noor", "Mariam"], m: ["Ibrahim", "Saeed"] },
    honorifics: { f: ["Ms", "Dr", "Sheikha"], m: ["Mr", "Sheikh", "Dr"] },
  },
  {
    key: "slavic",
    given: [
      g("Aleksandr", "m", {
        nick: "Sasha",
        variants: ["Alexander", "Alexandr"],
      }),
      g("Sergei", "m", { variants: ["Sergey"] }),
      g("Dmitri", "m", { nick: "Dima", variants: ["Dmitry"] }),
      g("Yuri", "m", { variants: ["Yury"] }),
      g("Natalia", "f", { variants: ["Natalya"] }),
      g("Yelena", "f", { variants: ["Elena"] }),
      g("Mikhail", "m"),
      g("Irina", "f"),
      g("Oksana", "f"),
      g("Viktor", "m", { variants: ["Victor"] }),
    ],
    surnames: [
      "Volkov",
      "Sokolov",
      "Kuznetsov|Kouznetsov",
      "Morozov",
      "Petrovsky",
      "Lebedev",
      "Fyodorov|Fedorov",
      "Zhukov",
      "Orlov",
      "Belyaev",
    ],
    middle: {
      f: ["Ivanovna", "Sergeyevna", "Petrovna"],
      m: ["Ivanovich", "Nikolaevich", "Petrovich"],
    },
    honorifics: WESTERN,
    gendered: true,
  },
  {
    key: "nigerian",
    given: [
      g("Chukwuemeka", "m", { nick: "Emeka" }),
      g("Adaeze", "f", { nick: "Ada" }),
      g("Oluwaseun", "m", { nick: "Seun" }),
      g("Ngozi", "f"),
      g("Babatunde", "m", { nick: "Tunde" }),
      g("Folake", "f"),
      g("Ifeoma", "f", { nick: "Ify" }),
      g("Obinna", "m"),
      g("Joseph", "m", { nick: "Joe" }),
    ],
    surnames: [
      "Okafor",
      "Adeyemi",
      "Nwosu",
      "Balogun",
      "Eze-Obi",
      "Okonkwo",
      "Adebayo-Cole",
      "Oyelaran",
      "Uchendu",
      "Afolabi",
    ],
    middle: { f: ["Grace", "Ebele"], m: ["Daniel", "Chinedu"] },
    honorifics: { f: ["Mrs", "Dr", "Ms"], m: ["Chief", "Mr", "Dr"] },
  },
  {
    key: "nordic",
    given: [
      g("Erik", "m"),
      g("Astrid", "f"),
      g("Lars", "m"),
      g("Ingrid", "f"),
      g("Sigrid", "f"),
      g("Magnus", "m"),
      g("Solveig", "f"),
    ],
    surnames: [
      "Lindqvist",
      "Halvorsen",
      "Bergström|Bergstrom",
      "Sørensen|Sorensen",
      "Åkesson|Akesson",
      "Nyberg",
      "Engdahl",
      "Rasmussen",
      "Thorsrud",
    ],
    middle: { f: ["Marie", "Linnea"], m: ["Olof", "Johan"] },
    honorifics: WESTERN,
  },
  {
    key: "anglo",
    given: [
      g("William", "m", { nick: "Bill" }),
      g("Margaret", "f", { nick: "Peggy" }),
      g("Robert", "m", { nick: "Bob" }),
      g("Elizabeth", "f", { nick: "Liz" }),
      g("James", "m", { nick: "Jim" }),
      g("Catherine", "f", { nick: "Kate" }),
      g("Richard", "m", { nick: "Rick" }),
      g("Edward", "m", { nick: "Ted" }),
      g("Jonathan", "m", { nick: "Jon" }),
      g("Patricia", "f", { nick: "Trish" }),
      g("Thomas", "m", { nick: "Tom" }),
      g("Eleanor", "f", { nick: "Nell" }),
    ],
    surnames: [
      "Ashworth",
      "Pemberton",
      "Whitcombe",
      "Fairbanks",
      "Hollis",
      "Thackeray",
      "O'Donnell",
      "McAllister",
      "Blackwood",
      "Carrington-Hale",
      "Fairweather",
      "Gilchrist",
    ],
    middle: { f: ["Anne", "Rose", "Louise"], m: ["Henry", "Arthur", "George"] },
    honorifics: { f: ["Mrs", "Ms", "Dr", "Prof."], m: ["Mr", "Dr", "Sir"] },
  },
  {
    key: "french",
    given: [
      g("Jean-Luc", "m"),
      g("Marguerite", "f"),
      g("Étienne", "m", { variants: ["Etienne"] }),
      g("Sylvie", "f"),
      g("Benoît", "m", { variants: ["Benoit"] }),
      g("Hélène", "f", { variants: ["Helene"] }),
      g("Amélie", "f"),
      g("Thierry", "m"),
    ],
    surnames: [
      "Delacroix",
      "Lefèvre|Lefevre",
      "Beaumont",
      "de la Fontaine",
      "Duval",
      "Rousseau-Blanc",
      "Marchand",
      "Giraud",
    ],
    middle: { f: ["Claire", "Odile"], m: ["Pierre", "Marie"] },
    honorifics: { f: ["Mme", "Dr", "Ms"], m: ["Mr", "Dr"] },
  },
  {
    key: "sinitic",
    given: [
      g("Jiahui", "f"),
      g("Wei", "m"),
      g("Mingyu", "m"),
      g("Xiaoling", "f"),
      g("Haoran", "m"),
      g("Meilin", "f"),
      g("Zhiwei", "m"),
    ],
    surnames: ["Chen", "Zhou", "Liang", "Xu", "Tan", "Huang", "Lim", "Guo"],
    honorifics: WESTERN,
    surnameFirst: true,
  },
  {
    key: "filipino",
    given: [
      g("Corazon", "f", { nick: "Cora" }),
      g("Rodrigo", "m", { nick: "Rody" }),
      g("Ligaya", "f"),
      g("Emmanuel", "m", { nick: "Manny" }),
      g("Rosario", "f", { nick: "Charo" }),
      g("Eduardo", "m", { nick: "Eddie" }),
    ],
    surnames: [
      "Bautista",
      "Macaraeg",
      "Villanueva",
      "Dimaculangan",
      "Santiago",
      "Panganiban",
      "Evangelista",
    ],
    middle: { f: ["Lourdes", "Paz"], m: ["Jose", "Ramon"] },
    honorifics: WESTERN,
  },
  {
    key: "indian",
    given: [
      g("Venkatesh", "m", { nick: "Venky" }),
      g("Priya", "f"),
      g("Rajesh", "m", { nick: "Raj" }),
      g("Lakshmi", "f"),
      g("Arjun", "m"),
      g("Deepa", "f"),
      g("Sunil", "m"),
    ],
    surnames: [
      "Subramanian",
      "Krishnamurthy",
      "Iyer",
      "Raghunathan",
      "Chatterjee",
      "Bhattacharya",
      "Venkataraman",
      "Deshpande",
    ],
    honorifics: WESTERN,
  },
];

/** First words of company names. None is a surname in the person pools. */
export const ORG_WORDS = [
  "Kestrel",
  "Bluefin",
  "Orchard",
  "Silverline",
  "Tamarind",
  "Corvid",
  "Saltmarsh",
  "Northgate",
  "Ironbark",
  "Quayside",
  "Lantern",
  "Juniper",
  "Pelican",
  "Cobalt",
  "Saffron",
  "Driftwood",
  "Granite",
  "Amberley",
  "Westmoor",
  "Calloway",
  "Brightwater",
  "Mistral",
  "Zenobia",
  "Larkspur",
  "Obsidian",
  "Sable",
  "Verdant",
  "Harrowgate",
  "Tidewater",
  "Redfern",
  "Coralline",
  "Stonebridge",
  "Windrose",
  "Marigold",
  "Falconridge",
  "Bramble",
  "Halyard",
  "Copperleaf",
  "Seabright",
  "Thornfield",
  "Aurelian",
  "Blackthorn",
  "Eastwind",
  "Goldcrest",
];

export const ORG_SECTORS = [
  "Maritime",
  "Trading",
  "Logistics",
  "Capital",
  "Ventures",
  "Commodities",
  "Agro",
  "Minerals",
  "Shipping",
  "Textiles",
  "Energy",
  "Consulting",
  "Imports",
  "Properties",
  "Investments",
  "Freight",
  "Metals",
];

/** Legal-form suffixes with the other way they get printed. */
export const LEGAL_SUFFIXES: { suffix: string; alt?: string; swift: string }[] =
  [
    { suffix: "Ltd", alt: "Limited", swift: "LTD" },
    { suffix: "Limited", alt: "Ltd", swift: "LIMITED" },
    { suffix: "LLC", alt: "L.L.C.", swift: "LLC" },
    { suffix: "S.A.", alt: "SA", swift: "SA" },
    { suffix: "GmbH", swift: "GMBH" },
    { suffix: "Inc.", alt: "Inc", swift: "INC" },
    { suffix: "PLC", alt: "plc", swift: "PLC" },
    { suffix: "B.V.", alt: "BV", swift: "BV" },
    { suffix: "Pte. Ltd", alt: "Pte Ltd", swift: "PTE LTD" },
    { suffix: "N.V.", alt: "NV", swift: "NV" },
  ];

// Decoys: printed in the Documents, never parties ---------------------------------

/** Streets named after people. */
export const STREETS = [
  "Rua Almirante Costa",
  "Avenida Presidente Moreau",
  "Calle General Ibáñez",
  "Rue Commandant Lefort",
  "King Edmund Street",
  "Queen Adelaide Road",
  "Jalan Sultan Ismail",
  "Avenida Doña Remedios",
  "Rua Barão de Mauá",
  "Saint Brendan's Quay",
  "Lady Ashcombe Gardens",
  "Bishop Okonjo Lane",
];

/** Vessels, often named after people. */
export const VESSELS = [
  "MV Santa Leonor",
  "MV Admiral Okonjo",
  "MT Princess Halima",
  "MV Captain Arvid",
  "MV Doña Remedios",
  "MV Senator Barroso",
];

/** Places in Meridia. */
export const PLACES = [
  "Port Selene",
  "Carrow Point",
  "St. Agathe",
  "Mount Vellan",
  "Lisle Harbour",
  "San Telmo",
  "Vila Nova do Cabo",
];

/** Products and schemes. */
export const PRODUCTS = [
  "Halcyon Platinum Card",
  "Meridia Saver Plus",
  "SelenePay",
  "Navigator Gold Account",
  "Harbour Business Current Account",
];

/** Job titles. */
export const TITLES = [
  "Chief Compliance Officer",
  "Relationship Manager",
  "Company Secretary",
  "Managing Director",
  "Head of Trade Operations",
  "Money Laundering Reporting Officer",
  "Financial Controller",
];

/** Boilerplate the default Rulebook excludes. */
export const BOILERPLATE = ["Meridia Central Bank", "Republic of Meridia"];

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
