import type { Option, Scenario } from "./scenario";

/*
 * Three companies of the fictional Republic of Meridia on their worst
 * morning. Every name, law and number here is made up. Money is in florin
 * millions (Ƒm). Each Inject's Options are ordered so the first is the one a
 * careful chief executive would usually pick; the Room never sees that order.
 */

const opt = (id: string, label: string, levers: string[]): Option => ({
  id,
  label,
  levers,
});

const halyard: Scenario = {
  id: "halyard-air",
  company: "Halyard Air",
  industry: "Airline",
  title: "Grounded",
  logline:
    "Ransomware takes out crew scheduling on the first morning of a holiday weekend.",
  brief:
    "Halyard Air is Meridia's second airline: 64 aircraft, 1,900 pilots and cabin crew, 212 flights a day out of Port Meridian. CrewLink, bought from a vendor in 2019, tells every crew member where to be. The pilots' association is strong and tired after a summer of long days. The Chair, Dame Ines Corvo, cares about the share price and about not looking weak.",
  startsAt: "Friday 06:10, Founders' Day weekend",
  slots: [0, 3, 8, 20, 36, 60],
  hours: 72,
  start: {
    customers: 72,
    regulator: 70,
    staff: 62,
    press: 66,
    operations: 82,
    board: 74,
  },
  costToShare: 0.9,
  ignition: "operations",
  stakeholders: [
    {
      gauge: "customers",
      name: "Rosa Mendel",
      role: "Passenger, Terminal 2",
      initials: "RM",
      voice:
        "Tired, specific, filming on her phone. Talks about her two children and the boarding pass in her hand.",
      lines: {
        up: [
          "Somebody finally told us something true. I can work with true.",
          "A hotel, a meal and a straight answer. That's all we were asking for.",
        ],
        down: [
          "Six hours on this floor and the boards still say DELAYED.",
          "My daughter asked if the plane is broken. I don't know what to tell her.",
        ],
      },
    },
    {
      gauge: "regulator",
      name: "Teodor Lisk",
      role: "Director, Civil Aviation Authority",
      initials: "TL",
      voice:
        "Formal and measured. Speaks of duties, hours and the Authority in the third person.",
      lines: {
        up: [
          "The Authority notes your report, and the speed of it.",
          "This is how the Authority expects an operator to behave.",
        ],
        down: [
          "The Authority should not learn of an attack on an operator from a newspaper.",
          "I am considering whether Halyard is fit to fly this weekend.",
        ],
      },
    },
    {
      gauge: "staff",
      name: "Capt. Ada Breck",
      role: "Meridia Airline Pilots' Association",
      initials: "AB",
      voice:
        "Blunt. Fatigue and safety first, crews before passengers. Never swears, never softens.",
      lines: {
        up: [
          "You came and said it to our faces. The crews will remember that.",
          "Nobody flies tired on my watch, and today nobody has to.",
        ],
        down: [
          "My members found out from the news. That is not how you treat crews.",
          "Fourteen-hour days on a paper roster. Someone is going to make a mistake.",
        ],
      },
    },
    {
      gauge: "press",
      name: "Maya Okafor",
      role: "Meridia Courier",
      initials: "MO",
      voice:
        "Sharp. Always has the next question ready and quotes people back to themselves.",
      lines: {
        up: [
          "Credit where due: Halyard has said more in an hour than most airlines say in a week.",
          "We'll run your statement in full. Readers can judge.",
        ],
        down: [
          "'A technical issue.' I have the email that says ransomware.",
          "We publish at ten. Your silence will be in the second paragraph.",
        ],
      },
    },
    {
      gauge: "operations",
      name: "Joss Arlen",
      role: "Head of Ops Control",
      initials: "JA",
      voice:
        "Radio-calm. Talks in flights, crews and minutes. Never guesses out loud.",
      lines: {
        up: [
          "Forty departures crewed by hand. The whiteboard holds.",
          "We're flying. Not pretty, but we're flying.",
        ],
        down: [
          "Ninety flights with no crew. I'm out of whiteboard.",
          "Without CrewLink I'm guessing who's legal to fly. I don't guess.",
        ],
      },
    },
    {
      gauge: "board",
      name: "Dame Ines Corvo",
      role: "Chair of the board",
      initials: "IC",
      voice:
        "Dry. Money, reputation and the shareholders. Short sentences, no adjectives.",
      lines: {
        up: [
          "Good. The board can stand behind that.",
          "The analysts will ask. I now have an answer.",
        ],
        down: [
          "I heard about this from my driver.",
          "Every hour of this costs us. Tell me it is ending.",
        ],
      },
    },
  ],
  levers: [
    {
      id: "ground_all",
      label: "Ground the fleet",
      detail: "Stop every departure until crews can be assigned safely.",
      effects: {
        operations: -16,
        regulator: 12,
        customers: -8,
        board: -4,
        cost: 6,
      },
    },
    {
      id: "manual_roster",
      label: "Roster crews by hand",
      detail:
        "Ops Control builds crew pairings from the printed backup and phones every crew member.",
      effects: { operations: 20, staff: -8, cost: 1.5 },
    },
    {
      id: "pay_ransom",
      label: "Pay the ransom",
      detail: "Ƒ4.2m in crypto for a decryption key that may or may not work.",
      effects: {
        operations: 22,
        regulator: -22,
        board: -12,
        press: -10,
        cost: 4.2,
      },
    },
    {
      id: "notify_authority",
      label: "Report to the Authority",
      detail:
        "File the incident with the Civil Aviation Authority and the Data Commissioner.",
      effects: { regulator: 16 },
      late: { after: 24, factor: 0.35 },
    },
    {
      id: "statement",
      label: "Tell passengers the truth",
      detail:
        "A plain statement: a cyberattack, what is cancelled, what passengers should do.",
      effects: { customers: 10, press: 12 },
      late: { after: 6, factor: 0.5 },
    },
    {
      id: "refunds",
      label: "Refund or rebook anyone, free",
      detail: "No forms, no fees, no questions, for every affected booking.",
      effects: { customers: 16, cost: 9 },
    },
    {
      id: "hotels",
      label: "Hotels and meals for the stranded",
      detail: "Rooms and meal vouchers for everyone stuck overnight.",
      effects: { customers: 9, staff: 3, cost: 3 },
    },
    {
      id: "ir_firm",
      label: "Bring in incident responders",
      detail:
        "Hire an outside firm to contain the attack and rebuild CrewLink from backup.",
      effects: { operations: 10, board: 8, regulator: 4, cost: 1.2 },
    },
    {
      id: "brief_unions",
      label: "Meet the unions in person",
      detail: "Go to the pilots' and cabin crew associations yourself.",
      effects: { staff: 14 },
    },
    {
      id: "double_time",
      label: "Pay crews double time",
      detail: "Double pay for every duty flown until CrewLink is back.",
      effects: { staff: 6, operations: 4, cost: 2 },
    },
    {
      id: "no_comment",
      label: "Call it a technical issue",
      detail: "Say nothing about an attack until more is known.",
      effects: { press: -14, customers: -6, board: 2 },
    },
    {
      id: "blame_vendor",
      label: "Blame the software vendor",
      detail: "Say publicly that the vendor's system failed.",
      effects: { press: -4, regulator: -6, staff: -3, board: 4 },
    },
    {
      id: "ceo_on_camera",
      label: "Front it yourself, on camera",
      detail: "The chief executive answers questions, live, at Terminal 2.",
      effects: { press: 12, customers: 6, board: -2 },
    },
    {
      id: "board_call",
      label: "Call the board tonight",
      detail: "An emergency board call with the lawyers on the line.",
      effects: { board: 14 },
    },
    {
      id: "data_check",
      label: "Check what passenger data left",
      detail: "Forensics on whether passport data was copied out.",
      effects: { regulator: 8, operations: -2, cost: 0.4 },
    },
  ],
  burns: [
    {
      id: "silence",
      label: "Nobody has told passengers anything",
      unless: ["statement", "ceo_on_camera"],
      effects: { customers: -6, press: -6 },
    },
    {
      id: "no-crews",
      label: "Crews have no assignments",
      unless: ["manual_roster", "pay_ransom", "ground_all"],
      effects: { operations: -8, customers: -4, cost: 1 },
    },
    {
      id: "authority-blind",
      label: "The Authority is hearing it from the press",
      unless: ["notify_authority"],
      effects: { regulator: -5 },
    },
  ],
  injects: [
    {
      id: "screens-black",
      slot: 0,
      from: "operations",
      title: "The screens go black",
      body: "06:10, Friday, the start of the Founders' Day weekend. CrewLink, the system that tells 1,900 pilots and cabin crew where to be, is encrypted. Every screen in Ops Control shows the same note: Ƒ4.2 million in crypto by Sunday midnight. 212 flights today, 31,000 passengers. The first wave leaves at 07:00 with no crew assigned.",
      pressure: { operations: -12, customers: -4 },
      options: [
        opt("screens-black/roster", "Roster by hand and keep flying", [
          "manual_roster",
        ]),
        opt("screens-black/ground", "Ground everything, call in responders", [
          "ground_all",
          "ir_firm",
        ]),
        opt("screens-black/tell", "Tell passengers first, decide after", [
          "statement",
        ]),
      ],
    },
    {
      id: "courier-memo",
      slot: 1,
      from: "press",
      title: "The Courier has the memo",
      body: "Maya Okafor of the Meridia Courier has an internal email with the word 'ransomware' in it. She publishes at 10:00, with or without a comment from you.",
      pressure: { press: -10 },
      when: { notTaken: ["statement"] },
      options: [
        opt("courier-memo/confirm", "Confirm it and front it yourself", [
          "statement",
          "ceo_on_camera",
        ]),
        opt("courier-memo/hold", "It's a technical issue", ["no_comment"]),
        opt("courier-memo/vendor", "Say the vendor's software failed", [
          "blame_vendor",
        ]),
      ],
    },
    {
      id: "terminal-queues",
      slot: 1,
      from: "customers",
      title: "The queue reaches the car park",
      body: "Terminal 2 at Port Meridian: 4,000 people, nothing on the boards, and a video of a crying toddler with 600,000 views. The airport operator asks who from Halyard is coming to talk to them.",
      pressure: { customers: -8, press: -4 },
      options: [
        opt("terminal-queues/care", "Hotels, meals and free rebooking", [
          "hotels",
          "refunds",
        ]),
        opt("terminal-queues/camera", "Go to Terminal 2 yourself", [
          "ceo_on_camera",
        ]),
        opt("terminal-queues/hold", "Hold the line: a technical issue", [
          "no_comment",
        ]),
      ],
    },
    {
      id: "duty-hours",
      slot: 2,
      from: "staff",
      title: "The pilots draw a line",
      body: "Hand rostering has crews on 14-hour days. The pilots' association says members will refuse any duty over 13 hours from 18:00, and they want to hear it from you, not from a memo.",
      pressure: { staff: -10 },
      when: { taken: ["manual_roster"] },
      options: [
        opt("duty-hours/hall", "Go to the union hall yourself", [
          "brief_unions",
        ]),
        opt("duty-hours/pay", "Pay double time and keep going", [
          "double_time",
        ]),
        opt("duty-hours/ground", "Ground the evening flights", ["ground_all"]),
      ],
    },
    {
      id: "passports-posted",
      slot: 2,
      from: "regulator",
      title: "Passports on a forum",
      body: "The attackers post 50 passport scans of Halyard passengers on a leak forum, to prove they hold more. The Data Commissioner's office calls to ask whether you knew.",
      pressure: { regulator: -10, customers: -6, press: -6 },
      when: { notTaken: ["data_check"] },
      options: [
        opt("passports-posted/report", "Report it and find out what left", [
          "notify_authority",
          "data_check",
        ]),
        opt("passports-posted/pay", "Pay before they post the rest", [
          "pay_ransom",
        ]),
        opt("passports-posted/hold", "No comment on criminal claims", [
          "no_comment",
        ]),
      ],
    },
    {
      id: "data-found",
      slot: 2,
      from: "operations",
      title: "Forensics finds the door",
      body: "The responders find how they got in: a contractor's reused password. Fifty passport scans were copied out, maybe more. You know before anyone outside does.",
      pressure: { regulator: -3 },
      when: { taken: ["data_check"] },
      options: [
        opt("data-found/report", "Report it now, before they post it", [
          "notify_authority",
        ]),
        opt("data-found/board", "Take it to the board first", ["board_call"]),
        opt("data-found/hold", "Keep it inside until it's certain", [
          "no_comment",
        ]),
      ],
    },
    {
      id: "authority-letter",
      slot: 3,
      from: "regulator",
      title: "A letter from the Authority",
      body: "The Civil Aviation Authority writes that it learned of the attack from the Courier. It wants a full report by 06:00 and is considering an order to ground Halyard.",
      pressure: { regulator: -14, board: -4 },
      when: { notTaken: ["notify_authority"] },
      options: [
        opt("authority-letter/file", "File the full report tonight", [
          "notify_authority",
        ]),
        opt("authority-letter/board", "Board and lawyers first", [
          "board_call",
        ]),
        opt("authority-letter/vendor", "Say the vendor never warned you", [
          "blame_vendor",
        ]),
      ],
    },
    {
      id: "chair-asks",
      slot: 3,
      from: "board",
      title: "The Chair asks the question",
      body: "Dame Ines Corvo, on the phone at midnight: 'If we pay, does this end on Monday? Shareholders will ask why we spent a week being brave.'",
      pressure: { board: -6 },
      options: [
        opt("chair-asks/convene", "Convene the board and decide together", [
          "board_call",
        ]),
        opt("chair-asks/rebuild", "Rebuild with the responders instead", [
          "ir_firm",
        ]),
        opt("chair-asks/pay", "Pay, and get the decryptor", ["pay_ransom"]),
      ],
    },
    {
      id: "decryptor-offer",
      slot: 4,
      from: "operations",
      title: "An offer, today only",
      body: "The attackers write again: pay by 18:00 and they will 'delete the passports too'. Ops Control says rebuilding CrewLink from backup needs another 30 hours.",
      pressure: { operations: -6 },
      when: { notTaken: ["pay_ransom"] },
      options: [
        opt("decryptor-offer/rebuild", "Keep rebuilding", ["ir_firm"]),
        opt(
          "decryptor-offer/care",
          "Look after the stranded while you rebuild",
          ["hotels"],
        ),
        opt("decryptor-offer/pay", "Pay", ["pay_ransom"]),
      ],
    },
    {
      id: "backlog",
      slot: 4,
      from: "customers",
      title: "Nine thousand still stranded",
      body: "Rebooked passengers are stuck behind the backlog. A family has slept in Terminal 2 for two nights; a pensioners' group is at Gate 14 with a banner.",
      pressure: { customers: -8 },
      options: [
        opt("backlog/hotels", "Hotels and meals for everyone stuck", [
          "hotels",
        ]),
        opt("backlog/refunds", "Refund or rebook anyone, free", ["refunds"]),
        opt("backlog/camera", "Go to Gate 14 yourself", ["ceo_on_camera"]),
      ],
    },
    {
      id: "class-action",
      slot: 5,
      from: "press",
      title: "Bramble & Co. file",
      body: "A Meridia law firm announces a class action on behalf of 'every Halyard passenger failed this weekend'. Its press conference is at noon.",
      pressure: { board: -10, press: -6 },
      when: { below: { customers: 45 } },
      options: [
        opt("class-action/refunds", "Refund everyone before noon", ["refunds"]),
        opt("class-action/camera", "Answer it on camera", ["ceo_on_camera"]),
        opt("class-action/vendor", "Point them at the vendor", [
          "blame_vendor",
        ]),
      ],
    },
    {
      id: "back-in-the-air",
      slot: 5,
      from: "operations",
      title: "Back in the air",
      body: "CrewLink is back. Monday's schedule flies at 94 percent. The Courier has one question for tomorrow's front page: what will you change?",
      pressure: {},
      options: [
        opt("back-in-the-air/crews", "Thank the crews first, in person", [
          "brief_unions",
        ]),
        opt("back-in-the-air/camera", "Answer it on camera", ["ceo_on_camera"]),
        opt("back-in-the-air/board", "A board review of what failed", [
          "board_call",
        ]),
      ],
    },
  ],
  rules: [
    {
      id: "inform-6h",
      kind: "by",
      text: "Tell passengers what is happening and what to do within 6 hours of the first cancellation.",
      anyOf: ["statement", "ceo_on_camera"],
      hour: 6,
      source: "Halyard Customer Charter, 2.1",
    },
    {
      id: "care-12h",
      kind: "by",
      text: "Give stranded passengers a bed and a meal within 12 hours.",
      anyOf: ["hotels"],
      hour: 12,
      source: "Meridia Passenger Rights Act, s.9",
    },
    {
      id: "report-24h",
      kind: "by",
      text: "Report a cyber incident to the Civil Aviation Authority within 24 hours of finding it.",
      anyOf: ["notify_authority"],
      hour: 24,
      source: "Meridia Aviation Security Order, s.12",
    },
    {
      id: "ransom-told",
      kind: "before",
      text: "Do not pay a ransom until the board and the Authority have both been told.",
      lever: "pay_ransom",
      first: ["board_call", "notify_authority"],
      source: "Halyard Crisis Policy, 4.2",
    },
    {
      id: "no-mislead",
      kind: "never",
      text: "Never call a known attack a technical issue.",
      lever: "no_comment",
      source: "Halyard Code of Conduct, 1.4",
    },
  ],
  statement: {
    who: ["passenger", "customer", "traveller", "traveler", "flying with us"],
    action: [
      "rebook",
      "refund",
      "check",
      "visit",
      "call",
      "do not come",
      "don't come",
      "app",
    ],
    promises: [
      { lever: "refunds", words: ["refund"] },
      { lever: "hotels", words: ["hotel", "accommodation"] },
      { lever: "ground_all", words: ["grounded", "grounding"] },
    ],
  },
  recorded: [
    "screens-black/roster",
    "courier-memo/confirm",
    "duty-hours/hall",
    "authority-letter/file",
    "decryptor-offer/care",
    "back-in-the-air/crews",
  ],
};

const saltmarsh: Scenario = {
  id: "saltmarsh-kitchen",
  company: "Saltmarsh Kitchen",
  industry: "Food",
  title: "Recall",
  logline:
    "Listeria on a ready-meal line that has already shipped to 412 stores.",
  brief:
    "Saltmarsh Kitchen makes chilled ready meals in two plants and sells most of them through Gullwing Supermarkets, which is a third of its revenue. Line 4 at Plant 2 makes the Harbour Chicken Pasta, its best seller. The staff are local and long-serving. Insurance covers Ƒ5m of recall costs. The Food Standards Office is strict on notification times.",
  startsAt: "Tuesday 05:40",
  slots: [0, 2, 6, 18, 36, 60],
  hours: 72,
  start: {
    customers: 78,
    regulator: 72,
    staff: 70,
    press: 70,
    operations: 76,
    board: 72,
  },
  costToShare: 1.1,
  ignition: "operations",
  stakeholders: [
    {
      gauge: "customers",
      name: "Priya Anand",
      role: "Shopper, mother of two",
      initials: "PA",
      voice:
        "Worried and practical. Wants to know exactly what to do with the meal in her fridge.",
      lines: {
        up: [
          "Clear instructions. I've binned it and I'm getting my money back. Thank you.",
          "They told us before the news did. That counts for something.",
        ],
        down: [
          "I fed that pasta to my kids on Sunday. Nobody is telling me anything.",
          "Is it just the one batch? How would I even know which batch I have?",
        ],
      },
    },
    {
      gauge: "regulator",
      name: "Dr Hal Mercer",
      role: "Food Standards Office",
      initials: "HM",
      voice:
        "Clinical, patient, exact about hours and batch numbers. Never raises his voice.",
      lines: {
        up: [
          "The Office has what it needs. This is a proper notification.",
          "Your scope matches the evidence. We will say so.",
        ],
        down: [
          "A positive swab is a four-hour clock. You know that.",
          "Three batches is not a scope. It is a hope.",
        ],
      },
    },
    {
      gauge: "staff",
      name: "Bea Lowry",
      role: "Line supervisor, Plant 2",
      initials: "BL",
      voice:
        "Loyal, scared for jobs, knows every machine on the line by its nickname.",
      lines: {
        up: [
          "They kept us on full pay. Line 4 will scrub that slicer till it shines.",
          "You came to the canteen. People saw that.",
        ],
        down: [
          "Eighty people in the car park and nobody from head office.",
          "They're saying agency staff go first. Is that true?",
        ],
      },
    },
    {
      gauge: "press",
      name: "Cal Fenwick",
      role: "Meridia Morning, consumer desk",
      initials: "CF",
      voice: "Warm on camera, ruthless in the edit. Thinks in headlines.",
      lines: {
        up: [
          "A straight 'do not eat' from the top. That's a responsible company.",
          "We'll lead with the recall list, not the blame.",
        ],
        down: [
          "We've got the label photo. We need you, or we run it without you.",
          "'No comment' from a food company? That writes itself.",
        ],
      },
    },
    {
      gauge: "operations",
      name: "Nils Harrow",
      role: "Plant director",
      initials: "NH",
      voice: "Engineer. Swabs, shifts and pallets. Hates guessing.",
      lines: {
        up: [
          "Line's stopped, swabs are out, trucks are turning round.",
          "Plant 2 is cleaner than the day it opened.",
        ],
        down: [
          "Line 4 is still running. Every hour is another 2,000 packs.",
          "Gullwing's trucks are waiting and I don't know what to load.",
        ],
      },
    },
    {
      gauge: "board",
      name: "Odile Saint-Ver",
      role: "Chair of the board",
      initials: "OS",
      voice: "Careful, legal-minded, asks for the number and the worst case.",
      lines: {
        up: [
          "A clear scope and a clear cost. The board can work with that.",
          "Insurers will like this file.",
        ],
        down: [
          "I need a number, not an adjective.",
          "If there's a second case, we are not a food company any more. We're a story.",
        ],
      },
    },
  ],
  levers: [
    {
      id: "notify_fso",
      label: "Tell the Food Standards Office",
      detail: "Full notification: the swab, the line, the batches, the stores.",
      effects: { regulator: 18 },
      late: { after: 4, factor: 0.3 },
    },
    {
      id: "stop_line",
      label: "Stop Line 4",
      detail: "Halt the line and quarantine everything made today.",
      effects: { operations: -10, staff: -4, regulator: 8, cost: 0.8 },
    },
    {
      id: "recall_batches",
      label: "Recall the three named batches",
      detail: "Pull batches 4-117, 4-118 and 4-119 from every store.",
      effects: { customers: 4, regulator: 2, cost: 1.1 },
    },
    {
      id: "recall_all",
      label: "Recall everything Line 4 made this month",
      detail: "Every pack of Harbour Chicken Pasta since the last clear swab.",
      effects: { customers: 12, regulator: 14, operations: -6, cost: 6.5 },
      late: { after: 24, factor: 0.5 },
    },
    {
      id: "do_not_eat",
      label: "Public warning: do not eat",
      detail: "A do-not-eat notice on TV, in stores and on every channel.",
      effects: { customers: 14, press: 10 },
      late: { after: 12, factor: 0.5 },
    },
    {
      id: "medical_costs",
      label: "Cover medical costs",
      detail:
        "Pay the medical costs of anyone made ill, without admitting fault.",
      effects: { customers: 6, press: 6, cost: 0.5 },
    },
    {
      id: "independent_lab",
      label: "Send swabs to an independent lab",
      detail: "A second lab, not ours, to find the source.",
      effects: { regulator: 8, board: 4, cost: 0.2 },
    },
    {
      id: "blame_supplier",
      label: "Blame the spice supplier",
      detail: "Say the contamination came in with a supplier's ingredients.",
      effects: { press: -8, regulator: -10, board: 3 },
    },
    {
      id: "no_comment",
      label: "Say nothing until the lab is back",
      detail: "No public comment until the source is certain.",
      effects: { press: -12, customers: -10 },
    },
    {
      id: "visit_family",
      label: "Visit the family, privately",
      detail: "Go to the hospital, no cameras, no lawyers.",
      effects: { customers: 6, staff: 4 },
    },
    {
      id: "brief_retailers",
      label: "Brief the supermarkets",
      detail:
        "Give Gullwing and the others the full picture and a recall list.",
      effects: { operations: 10, board: 6 },
    },
    {
      id: "deep_clean",
      label: "Strip and deep-clean Plant 2",
      detail: "Take the line apart and clean it to bare metal.",
      effects: { operations: -6, regulator: 10, staff: 6, cost: 1.4 },
    },
    {
      id: "board_call",
      label: "Call the board",
      detail: "An emergency board call with the insurers' figures.",
      effects: { board: 12 },
    },
    {
      id: "pay_staff",
      label: "Keep Line 4's crew on full pay",
      detail:
        "Every worker on the line, agency staff included, for as long as it's down.",
      effects: { staff: 16, cost: 0.6 },
    },
  ],
  burns: [
    {
      id: "on-shelves",
      label: "Suspect meals are still on shelves",
      unless: ["recall_batches", "recall_all"],
      effects: { customers: -7, regulator: -5, cost: 0.3 },
    },
    {
      id: "fridges",
      label: "Shoppers don't know what to do",
      unless: ["do_not_eat"],
      effects: { customers: -5, press: -6 },
    },
    {
      id: "line-running",
      label: "Line 4 is still running",
      unless: ["stop_line", "deep_clean"],
      effects: { regulator: -6, operations: -3 },
    },
  ],
  injects: [
    {
      id: "positive-swab",
      slot: 0,
      from: "operations",
      title: "Positive",
      body: "05:40, Tuesday. The overnight swab from Line 4 at Plant 2 is positive for Listeria. Line 4 makes the Harbour Chicken Pasta: 61,000 packs this week, in 412 stores. The lab is certain about three batches and calls the rest of the month 'possible'.",
      pressure: { regulator: -4, operations: -6 },
      options: [
        opt("positive-swab/stop", "Stop the line and call the Office", [
          "stop_line",
          "notify_fso",
        ]),
        opt("positive-swab/three", "Recall three batches, keep running", [
          "recall_batches",
        ]),
        opt("positive-swab/wait", "Wait for a second lab", ["independent_lab"]),
      ],
    },
    {
      id: "office-calls",
      slot: 1,
      from: "regulator",
      title: "The Office calls you",
      body: "Dr Hal Mercer of the Food Standards Office rings: a hospital has reported a listeriosis case linked to a Saltmarsh product. 'Is there anything you want to tell me?'",
      pressure: { regulator: -12 },
      when: { notTaken: ["notify_fso"] },
      options: [
        opt("office-calls/tell", "Tell him everything, now", ["notify_fso"]),
        opt("office-calls/supplier", "Point at the spice supplier", [
          "blame_supplier",
        ]),
        opt("office-calls/hold", "Say you're still investigating", [
          "no_comment",
        ]),
      ],
    },
    {
      id: "hospital",
      slot: 1,
      from: "customers",
      title: "A woman in Holloway General",
      body: "A pregnant woman is in Holloway General with listeriosis. Her husband has posted a photo of the pasta's label: batch 4-118. That's one of yours.",
      pressure: { customers: -10, press: -8 },
      options: [
        opt("hospital/warn", "Warn the public: do not eat", ["do_not_eat"]),
        opt("hospital/visit", "Cover her costs, visit privately", [
          "medical_costs",
          "visit_family",
        ]),
        opt("hospital/hold", "Nothing until it's confirmed", ["no_comment"]),
      ],
    },
    {
      id: "tv-doorstep",
      slot: 2,
      from: "press",
      title: "Cameras at the gate",
      body: "Meridia Morning has a crew at Plant 2's gate, filming workers going home. Their consumer reporter is live at 18:00: 'Is your fridge safe?'",
      pressure: { press: -10, staff: -4 },
      when: { notTaken: ["do_not_eat"] },
      options: [
        opt("tv-doorstep/warn", "Go out and say: do not eat", ["do_not_eat"]),
        opt("tv-doorstep/supplier", "Point at the spice supplier", [
          "blame_supplier",
        ]),
        opt("tv-doorstep/shut", "Keep the gates shut", ["no_comment"]),
      ],
    },
    {
      id: "retailers",
      slot: 2,
      from: "board",
      title: "Gullwing wants an answer",
      body: "Gullwing Supermarkets, a third of your sales, asks whether to pull every Saltmarsh product from 230 stores tonight. Their buyer: 'Tell me it's three batches or tell me it's everything. Don't tell me maybe.'",
      pressure: { board: -8, operations: -4 },
      options: [
        opt("retailers/all", "It's everything: recall the month", [
          "recall_all",
          "brief_retailers",
        ]),
        opt("retailers/three", "Three batches only", [
          "recall_batches",
          "brief_retailers",
        ]),
        opt("retailers/wait", "Ask for a day to know", ["independent_lab"]),
      ],
    },
    {
      id: "staff-fear",
      slot: 3,
      from: "staff",
      title: "Line 4 is frightened",
      body: "Bea Lowry, supervisor on Line 4: 'Eighty people are in the car park asking if they still have a job. Someone said agency staff get let go first.'",
      pressure: { staff: -12 },
      when: { taken: ["stop_line"] },
      options: [
        opt("staff-fear/pay", "Full pay, said by you, in the canteen", [
          "pay_staff",
        ]),
        opt("staff-fear/clean", "Put them on the deep clean", ["deep_clean"]),
        opt("staff-fear/board", "Ask the board first", ["board_call"]),
      ],
    },
    {
      id: "lab-back",
      slot: 3,
      from: "operations",
      title: "The lab is back",
      body: "The independent lab finds Listeria monocytogenes in the line's slicer, not in the spices. Swabs from the fortnight before are positive too: the problem is older than the three batches.",
      pressure: { regulator: -4 },
      options: [
        opt("lab-back/widen", "Widen the recall to the month", ["recall_all"]),
        opt("lab-back/clean", "Strip the plant", ["deep_clean"]),
        opt("lab-back/pay", "Keep Line 4's crew on full pay", ["pay_staff"]),
      ],
    },
    {
      id: "second-case",
      slot: 4,
      from: "customers",
      title: "A second case",
      body: "A 71-year-old man in Port Meridian is in intensive care. His pack was from batch 4-109, made a week before the recalled batches.",
      pressure: { customers: -14, regulator: -12, press: -10 },
      when: { notTaken: ["recall_all"] },
      options: [
        opt("second-case/all", "Recall everything, now", ["recall_all"]),
        opt("second-case/costs", "Cover his medical costs", ["medical_costs"]),
        opt("second-case/supplier", "Point at the spice supplier", [
          "blame_supplier",
        ]),
      ],
    },
    {
      id: "board-asks",
      slot: 4,
      from: "board",
      title: "The board wants a number",
      body: "Odile Saint-Ver, the Chair: 'Insurers cover Ƒ5m. Tell me what this costs, and tell me nobody else is going to hospital.'",
      pressure: { board: -6 },
      options: [
        opt("board-asks/convene", "Take the board through it tonight", [
          "board_call",
        ]),
        opt("board-asks/lab", "Bring them the lab's report", [
          "independent_lab",
        ]),
        opt("board-asks/clean", "Show them the deep clean", ["deep_clean"]),
      ],
    },
    {
      id: "prosecution-file",
      slot: 5,
      from: "regulator",
      title: "The Office opens a file",
      body: "The Food Standards Office says it is reviewing whether Saltmarsh delayed its notification. A prosecution file is open.",
      pressure: { board: -10, press: -6 },
      when: { below: { regulator: 45 } },
      options: [
        opt("prosecution-file/board", "Brief the board and the lawyers", [
          "board_call",
        ]),
        opt("prosecution-file/clean", "Show the Office the deep clean", [
          "deep_clean",
        ]),
        opt("prosecution-file/supplier", "Point at the spice supplier", [
          "blame_supplier",
        ]),
      ],
    },
    {
      id: "restart",
      slot: 5,
      from: "operations",
      title: "Ready to restart?",
      body: "Plant 2 is clean. The Office will let Line 4 restart after three clear swabs. Gullwing asks when the pasta comes back. Bea asks if the crew can come back first.",
      pressure: {},
      options: [
        opt("restart/crew", "The crew comes back first, on full pay", [
          "pay_staff",
        ]),
        opt("restart/retailers", "Give Gullwing a date", ["brief_retailers"]),
        opt("restart/clean", "One more clean before anything", ["deep_clean"]),
      ],
    },
  ],
  rules: [
    {
      id: "stop-2h",
      kind: "by",
      text: "Stop a line that has tested positive within the same shift (2 hours).",
      anyOf: ["stop_line", "deep_clean"],
      hour: 2,
      source: "Saltmarsh Food Safety Manual, 6.3",
    },
    {
      id: "notify-4h",
      kind: "by",
      text: "Tell the Food Standards Office within 4 hours of a positive pathogen test.",
      anyOf: ["notify_fso"],
      hour: 4,
      source: "Meridia Food Safety Act, s.21",
    },
    {
      id: "warn-12h",
      kind: "by",
      text: "Warn the public within 12 hours when a product may cause serious illness.",
      anyOf: ["do_not_eat"],
      hour: 12,
      source: "FSO Recall Guidance, 3.1",
    },
    {
      id: "scope-24h",
      kind: "by",
      text: "Recall every batch made since the last clear swab within 24 hours of knowing.",
      anyOf: ["recall_all"],
      hour: 24,
      source: "FSO Recall Guidance, 4.2",
    },
    {
      id: "lab-first",
      kind: "before",
      text: "Do not name a supplier as the cause until an independent lab says so.",
      lever: "blame_supplier",
      first: ["independent_lab"],
      source: "Saltmarsh Supplier Charter, 9",
    },
  ],
  statement: {
    who: ["customer", "shopper", "anyone who bought", "people who bought"],
    action: [
      "do not eat",
      "don't eat",
      "return",
      "bring it back",
      "throw",
      "refund",
      "call",
      "check",
    ],
    promises: [
      {
        lever: "recall_all",
        words: ["every batch", "all batches", "this month"],
      },
      { lever: "medical_costs", words: ["medical costs"] },
    ],
  },
  recorded: [
    "positive-swab/stop",
    "hospital/warn",
    "retailers/all",
    "staff-fear/pay",
    "board-asks/convene",
    "restart/retailers",
  ],
};

const brightwater: Scenario = {
  id: "brightwater-mobile",
  company: "Brightwater Mobile",
  industry: "Telecoms",
  title: "Leak",
  logline: "2.1 million customer records go up for sale on a leak forum.",
  brief:
    "Brightwater Mobile is Meridia's third mobile network: 2.4 million customers, a call centre of 600 in Kessel, a security team of 30. Many customers use their Brightwater number to receive bank codes, so a leaked SIM serial is a door into their bank. The Data Commissioner, Ruth Abara, is new and wants to be seen to act.",
  startsAt: "Monday 08:15",
  slots: [0, 4, 10, 24, 44, 64],
  hours: 72,
  start: {
    customers: 70,
    regulator: 68,
    staff: 66,
    press: 64,
    operations: 78,
    board: 72,
  },
  costToShare: 0.7,
  ignition: "customers",
  stakeholders: [
    {
      gauge: "customers",
      name: "Elias Varga",
      role: "Customer since 2011",
      initials: "EV",
      voice:
        "Anxious, practical, thinks first about his bank account and his mother's.",
      lines: {
        up: [
          "A text telling me what to do, and a PIN on my SIM. Fine. I can breathe.",
          "They told me before a stranger did. I'll stay, for now.",
        ],
        down: [
          "I found my own ID number on a website. Brightwater said nothing.",
          "Someone moved my number and emptied my account. Who do I even call?",
        ],
      },
    },
    {
      gauge: "regulator",
      name: "Ruth Abara",
      role: "Data Commissioner",
      initials: "RA",
      voice:
        "New in post, crisp, wants to be seen to act. Talks in obligations and dates.",
      lines: {
        up: [
          "A full report, early. That is what the law asks, and you did it.",
          "My office will note your cooperation in its findings.",
        ],
        down: [
          "I read about your breach in a newsletter. I'd rather read it in a report.",
          "The clock started when you knew. Not when you were sure.",
        ],
      },
    },
    {
      gauge: "staff",
      name: "Lena Ostrova",
      role: "Team lead, Kessel call centre",
      initials: "LO",
      voice:
        "Frontline, hoarse, protective of her agents. Counts calls in the queue.",
      lines: {
        up: [
          "We've got a script and overtime. My team can finally answer people.",
          "The queue's down to forty. Nobody's crying in the break room any more.",
        ],
        down: [
          "Three thousand in the queue and all we can say is 'no information'.",
          "One of my agents was screamed at for an hour. We need words.",
        ],
      },
    },
    {
      gauge: "press",
      name: "Sami Kett",
      role: "The Kett Report",
      initials: "SK",
      voice:
        "Technical, sceptical, posts screenshots. Respects precise answers.",
      lines: {
        up: [
          "Specific, early, no spin. Rarer than it should be.",
          "Brightwater's disclosure is the template others should copy.",
        ],
        down: [
          "'Neither confirm nor deny' while the rows are on the forum. Bold.",
          "I have the column headers. They have a press office.",
        ],
      },
    },
    {
      gauge: "operations",
      name: "Dev Ramsay",
      role: "Chief Information Security Officer",
      initials: "DR",
      voice: "Precise, tired, careful to say what is known and what isn't.",
      lines: {
        up: [
          "Door's found and shut. Forensics have the logs.",
          "SIM swaps now need a PIN. The fraud curve is bending.",
        ],
        down: [
          "I can't tell you how they got in yet. I can tell you they're still trying.",
          "We're blind without forensics. I'm guessing, and I hate guessing.",
        ],
      },
    },
    {
      gauge: "board",
      name: "Henrik Moll",
      role: "Chair of the board",
      initials: "HM",
      voice: "Investor-minded, wants the cost and the end date. Impatient.",
      lines: {
        up: [
          "A cost, a plan, an end. I can take that to the analysts.",
          "The board is with you on this.",
        ],
        down: [
          "The share price is down eight percent and I learned why from a newsletter.",
          "Tell me this is contained. Tell me something.",
        ],
      },
    },
  ],
  levers: [
    {
      id: "confirm",
      label: "Verify the breach",
      detail: "Security checks the posted rows against live records.",
      effects: { operations: 6, regulator: 4 },
    },
    {
      id: "notify_commissioner",
      label: "Report to the Data Commissioner",
      detail: "A formal breach report: what, who, how many, what next.",
      effects: { regulator: 18 },
      late: { after: 48, factor: 0.5 },
    },
    {
      id: "tell_customers",
      label: "Text every affected customer",
      detail:
        "A text and an email to all 2.1 million: what was taken, what to do.",
      effects: { customers: 14, press: 8, staff: -4, cost: 0.3 },
      late: { after: 48, factor: 0.5 },
    },
    {
      id: "sim_lock",
      label: "Lock SIM swaps behind a PIN",
      detail: "No number moves to a new SIM without a PIN sent to the old one.",
      effects: { customers: 10, operations: -6, staff: -4, regulator: 4 },
    },
    {
      id: "id_protection",
      label: "Free identity protection, two years",
      detail: "Credit monitoring and fraud cover for every affected customer.",
      effects: { customers: 10, cost: 8.4 },
    },
    {
      id: "pay_deletion",
      label: "Pay the seller to delete it",
      detail: "Ƒ1.8m for a promise and a video of the file being deleted.",
      effects: {
        customers: 2,
        regulator: -20,
        board: -8,
        press: -6,
        cost: 1.8,
      },
    },
    {
      id: "forensics",
      label: "Bring in forensics",
      detail: "An outside firm to find the way in and shut it.",
      effects: { operations: 12, board: 6, cost: 1.1 },
    },
    {
      id: "police",
      label: "Report it to the police",
      detail: "Hand everything to the Meridia Police cyber unit.",
      effects: { regulator: 6, operations: 2 },
    },
    {
      id: "no_comment",
      label: "Neither confirm nor deny",
      detail: "No public comment while it's investigated.",
      effects: { press: -12, customers: -8 },
    },
    {
      id: "blame_contractor",
      label: "Name the contractor",
      detail: "Say publicly that a billing contractor's system was breached.",
      effects: { press: -4, regulator: -6, board: 4, staff: -2 },
    },
    {
      id: "ceo_on_camera",
      label: "Front it yourself, on camera",
      detail: "The chief executive explains it, live, and takes questions.",
      effects: { press: 12, customers: 6, board: -2 },
    },
    {
      id: "board_call",
      label: "Call the board",
      detail: "An emergency board call with the forensic lead on the line.",
      effects: { board: 14 },
    },
    {
      id: "staff_script",
      label: "Script and overtime for the call centre",
      detail: "Agents get the facts, the words and paid overtime.",
      effects: { staff: 14, customers: 4, cost: 0.4 },
    },
    {
      id: "reset_portal",
      label: "Force new passwords everywhere",
      detail:
        "Every customer and contractor account resets, with a second factor.",
      effects: { operations: 4, customers: -2, regulator: 4 },
    },
  ],
  burns: [
    {
      id: "sim-swaps",
      label: "Fraudsters are moving numbers",
      unless: ["sim_lock"],
      effects: { customers: -6, cost: 0.5 },
    },
    {
      id: "in-the-dark",
      label: "Customers don't know if they're in it",
      unless: ["tell_customers"],
      effects: { customers: -5, press: -5, staff: -3 },
    },
    {
      id: "commissioner-blind",
      label: "The Commissioner hasn't heard from you",
      unless: ["notify_commissioner"],
      effects: { regulator: -4 },
    },
  ],
  injects: [
    {
      id: "for-sale",
      slot: 0,
      from: "operations",
      title: "For sale: 2.1 million of you",
      body: "08:15, Monday. A seller on a leak forum lists 'Brightwater full customer DB, 2.1M rows' for Ƒ900,000 and posts 1,000 rows as proof: names, ID numbers, home addresses, SIM serials. Dev, your security chief, thinks the sample is real.",
      pressure: { operations: -8, customers: -4 },
      options: [
        opt("for-sale/verify", "Verify it and bring in forensics", [
          "confirm",
          "forensics",
        ]),
        opt("for-sale/report", "Report it to the police and the Commissioner", [
          "police",
          "notify_commissioner",
        ]),
        opt("for-sale/hold", "Neither confirm nor deny", ["no_comment"]),
      ],
    },
    {
      id: "kett-post",
      slot: 1,
      from: "press",
      title: "The Kett Report has it",
      body: "Sami Kett posts the sample's column headers and asks Brightwater to comment. His newsletter has 300,000 readers, most of them in your industry.",
      pressure: { press: -10, customers: -4 },
      when: { notTaken: ["tell_customers"] },
      options: [
        opt("kett-post/confirm", "Confirm it, on camera", [
          "confirm",
          "ceo_on_camera",
        ]),
        opt("kett-post/contractor", "Say a contractor was breached", [
          "blame_contractor",
        ]),
        opt("kett-post/hold", "Neither confirm nor deny", ["no_comment"]),
      ],
    },
    {
      id: "queue",
      slot: 1,
      from: "staff",
      title: "Three thousand in the queue",
      body: "Lena's call centre has 3,000 callers waiting and no script. Agents are telling customers 'we have no information', and that is now on social media.",
      pressure: { staff: -10, customers: -4 },
      options: [
        opt("queue/script", "A script and overtime, now", ["staff_script"]),
        opt("queue/text", "Text every affected customer", ["tell_customers"]),
        opt("queue/lock", "Lock SIM swaps first", ["sim_lock"]),
      ],
    },
    {
      id: "sim-swap",
      slot: 2,
      from: "customers",
      title: "The first emptied account",
      body: "Elias Varga, a customer since 2011, lost his number at lunch. By 15:00 someone had reset his banking app and moved Ƒ14,200. Three banks report the same pattern.",
      pressure: { customers: -12, press: -6 },
      when: { notTaken: ["sim_lock"] },
      options: [
        opt("sim-swap/lock", "Lock SIM swaps tonight", ["sim_lock"]),
        opt("sim-swap/protect", "Identity protection for everyone", [
          "id_protection",
        ]),
        opt("sim-swap/banks", "It's the banks' problem", ["no_comment"]),
      ],
    },
    {
      id: "seller-offer",
      slot: 2,
      from: "board",
      title: "An offer to make it go away",
      body: "The seller writes to your security inbox: Ƒ1.8m and the database is 'deleted, with video proof'. A broker says companies pay this all the time.",
      pressure: { board: -4 },
      options: [
        opt("seller-offer/police", "Hand the message to the police", [
          "police",
        ]),
        opt("seller-offer/trace", "Let forensics trace the seller", [
          "forensics",
        ]),
        opt("seller-offer/pay", "Pay", ["pay_deletion"]),
      ],
    },
    {
      id: "commissioner-call",
      slot: 3,
      from: "regulator",
      title: "The Commissioner calls",
      body: "Commissioner Ruth Abara: 'I read about your breach in a newsletter. You have 48 hours left of your 72. I would like them used well.'",
      pressure: { regulator: -12 },
      when: { notTaken: ["notify_commissioner"] },
      options: [
        opt("commissioner-call/report", "File the full report today", [
          "notify_commissioner",
        ]),
        opt("commissioner-call/board", "Board first, then the report", [
          "board_call",
        ]),
        opt("commissioner-call/contractor", "Say it was a contractor", [
          "blame_contractor",
        ]),
      ],
    },
    {
      id: "the-door",
      slot: 3,
      from: "operations",
      title: "How they got in",
      body: "Forensics found it: an old billing-contractor account with no second factor, never switched off. It has been open for nineteen months.",
      pressure: { board: -6, operations: -2 },
      when: { taken: ["forensics"] },
      options: [
        opt("the-door/reset", "Force new passwords everywhere", [
          "reset_portal",
        ]),
        opt("the-door/tell", "Tell customers exactly what was taken", [
          "tell_customers",
        ]),
        opt("the-door/contractor", "Name the contractor", ["blame_contractor"]),
      ],
    },
    {
      id: "fraud-wave",
      slot: 3,
      from: "customers",
      title: "The fraud wave",
      body: "Banks report 400 SIM-swap frauds against Brightwater numbers since Monday. One bank is telling its customers to leave Brightwater.",
      pressure: { customers: -10, board: -6 },
      options: [
        opt("fraud-wave/lock", "Lock SIM swaps behind a PIN", ["sim_lock"]),
        opt("fraud-wave/protect", "Identity protection for everyone", [
          "id_protection",
        ]),
        opt("fraud-wave/camera", "Front it yourself, on camera", [
          "ceo_on_camera",
        ]),
      ],
    },
    {
      id: "full-dump",
      slot: 4,
      from: "press",
      title: "The full file is out",
      body: "The seller gave up and posted all 2.1 million rows for free. Search sites are indexing it. Customers are finding themselves before you've told them.",
      pressure: { customers: -14, press: -10 },
      when: { notTaken: ["tell_customers"] },
      options: [
        opt("full-dump/tell", "Text everyone, with protection", [
          "tell_customers",
          "id_protection",
        ]),
        opt("full-dump/camera", "Front it yourself, on camera", [
          "ceo_on_camera",
        ]),
        opt("full-dump/hold", "Neither confirm nor deny", ["no_comment"]),
      ],
    },
    {
      id: "chair-plan",
      slot: 4,
      from: "board",
      title: "The Chair wants a plan",
      body: "Henrik Moll: 'The share price is down and the analysts call at nine. I want to say what this costs and that it's over.'",
      pressure: { board: -6 },
      options: [
        opt("chair-plan/convene", "Take the board through it tonight", [
          "board_call",
        ]),
        opt("chair-plan/protect", "Announce identity protection", [
          "id_protection",
        ]),
        opt("chair-plan/forensics", "Show them the forensic report", [
          "forensics",
        ]),
      ],
    },
    {
      id: "hearing",
      slot: 5,
      from: "regulator",
      title: "Parliament asks",
      body: "The Minister for Digital Affairs has called Brightwater to a hearing next week, citing 'a pattern of silence'.",
      pressure: { board: -10, press: -8 },
      when: { below: { regulator: 45 } },
      options: [
        opt("hearing/camera", "Go on camera before the hearing", [
          "ceo_on_camera",
        ]),
        opt("hearing/report", "File everything with the Commissioner", [
          "notify_commissioner",
        ]),
        opt("hearing/board", "Prepare with the board", ["board_call"]),
      ],
    },
    {
      id: "never-again",
      slot: 5,
      from: "press",
      title: "The question for Friday",
      body: "Sami Kett asks for an interview: 'What will Brightwater do so this never happens again?'",
      pressure: {},
      options: [
        opt("never-again/reset", "Second factor on every account, announced", [
          "reset_portal",
        ]),
        opt("never-again/camera", "Do the interview yourself", [
          "ceo_on_camera",
        ]),
        opt("never-again/staff", "Thank the call centre first", [
          "staff_script",
        ]),
      ],
    },
  ],
  rules: [
    {
      id: "sim-24h",
      kind: "by",
      text: "Require a second check for SIM swaps within 24 hours of a breach of SIM data.",
      anyOf: ["sim_lock"],
      hour: 24,
      source: "Brightwater Fraud Standard, 7",
    },
    {
      id: "customers-48h",
      kind: "by",
      text: "Tell affected customers without undue delay, and within 48 hours where fraud is likely.",
      anyOf: ["tell_customers"],
      hour: 48,
      source: "Meridia Data Protection Act, s.34",
    },
    {
      id: "commissioner-72h",
      kind: "by",
      text: "Report a personal data breach to the Data Commissioner within 72 hours of becoming aware of it.",
      anyOf: ["notify_commissioner"],
      hour: 72,
      source: "Meridia Data Protection Act, s.33",
    },
    {
      id: "verify-first",
      kind: "before",
      text: "Do not go on camera until the breach has been verified.",
      lever: "ceo_on_camera",
      first: ["confirm"],
      source: "Brightwater Crisis Policy, 1.3",
    },
    {
      id: "never-pay",
      kind: "never",
      text: "Never pay a criminal to delete stolen data.",
      lever: "pay_deletion",
      source: "Brightwater Crisis Policy, 2.4",
    },
  ],
  statement: {
    who: ["customer", "subscriber"],
    action: ["pin", "password", "call", "check", "bank", "change", "watch"],
    promises: [
      { lever: "id_protection", words: ["identity protection", "monitoring"] },
      { lever: "sim_lock", words: ["sim swap", "sim-swap"] },
    ],
  },
  recorded: [
    "for-sale/verify",
    "kett-post/confirm",
    "sim-swap/lock",
    "commissioner-call/report",
    "full-dump/tell",
    "never-again/reset",
  ],
};

export const SCENARIOS: Scenario[] = [halyard, saltmarsh, brightwater];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
