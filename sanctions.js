// US sanctions by country, for the Sanctions view. The levels are this site's simplification of OFAC's
// programs, not an official US scale. sanctions-data.json (built by scripts/sanctions.mjs from OFAC's own list,
// at most once a day) adds how many listed people and companies are based in each country, and corrects the
// levels below by itself when a country's program disappears from the list.
"use strict";

const SANCTIONS_CHECKED = "2026-10-12"; // when the levels below were last checked by hand

const SANCTION_LEVELS = [
  { level: 1, label: "Full embargo", text: "Nearly all trade with the US is banned." },
  { level: 2, label: "Heavy", text: "The government or whole sectors of the economy (banks, energy, technology) are blocked, but it is not a full embargo." },
  { level: 3, label: "Targeted program", text: "The US has a sanctions program for this country, aimed at officials, armed groups, the military or some firms. Ordinary trade is allowed." },
  { level: 4, label: "Listed people or companies", text: "No sanctions on the country itself, but some people or companies based here are on the US sanctions list." },
  { level: 5, label: "None", text: "No US sanctions program, and nobody based here is on the list." },
];

// Why: one main reason per country (the Reason colors). Countries with a program have it set by hand below;
// the rest get it from what most of their listed people and companies are listed for (see reasonOf).
const SANCTION_REASONS = [
  { id: "war", label: "War & aggression", text: "Russia's war on Ukraine, and the firms helping Russia get around sanctions." },
  { id: "weapons", label: "Weapons & military threat", text: "Nuclear, missile and weapons programs, and their suppliers." },
  { id: "repression", label: "Repression & corruption", text: "Governments that crush opposition or rig elections, human-rights abusers and corrupt officials." },
  { id: "conflict", label: "Armed conflict", text: "Warlords, militias and backers prolonging civil wars, and conflict-mineral traders." },
  { id: "terror", label: "Terrorism & militias", text: "Terrorist groups, armed militias and their financiers." },
  { id: "crime", label: "Crime, drugs & cyber", text: "Drug cartels, organized crime, hackers and election interference." },
];

// Countries with their own US program (and Zimbabwe, whose program ended). Names as on the map.
// reason, reason2: main and (optional) second reason, from SANCTION_REASONS.
// tags: the program codes on OFAC's list that belong to this program. If none of them is on the list any more,
// the program has ended and the level drops by itself (see levelOf). An empty list means no automatic check
// (the program's people are listed under other codes, such as terrorism for the Taliban).
// eased: sanctions were eased recently and the level may change again.
const SANCTION_COUNTRIES = [
  { country: "Cuba", level: 1, reason: "repression", program: "Cuba Sanctions", tags: ["CUBA", "CUBA-EO14404"],
    note: "Trade embargo since 1962. Also on the State Department's list of state sponsors of terrorism." },
  { country: "Iran", level: 1, reason: "weapons", reason2: "terror", program: "Iran Sanctions", tags: ["IRAN", "IRAN-EO13902", "IRAN-EO13846", "IRAN-EO13871", "IRAN-EO13876", "IRGC", "IFSR", "IRAN-HR", "IRAN-TRA", "IRAN-CON-ARMS-EO", "HRIT-IR", "CAATSA - IRAN"],
    note: "Almost all trade banned, and foreign firms dealing with Iran's oil, banks or shipping can be sanctioned too. State sponsor of terrorism." },
  { country: "North Korea", level: 1, reason: "weapons", program: "North Korea Sanctions", tags: ["DPRK", "DPRK2", "DPRK3", "DPRK4", "DPRK-NKSPEA"],
    note: "Almost all trade banned. State sponsor of terrorism." },
  { country: "Russia", level: 2, reason: "war", program: "Russian Harmful Foreign Activities; Ukraine-/Russia-related", tags: ["RUSSIA-EO14024", "UKRAINE-EO13660", "UKRAINE-EO13661", "UKRAINE-EO13662", "CAATSA - RUSSIA", "PEESA-EO14039"],
    note: "Major banks, the central bank's reserves, energy companies (Rosneft and Lukoil since October 2025), technology exports and many services are blocked. Not a full embargo." },
  { country: "Venezuela", level: 2, reason: "repression", reason2: "crime", program: "Venezuela-Related Sanctions", tags: ["VENEZUELA", "VENEZUELA-EO13850", "VENEZUELA-EO13884"], eased: true,
    note: "The Venezuelan government is still blocked, but since early 2026 general licenses allow most oil trade, including with the state oil company PDVSA." },
  { country: "Belarus", level: 3, reason: "repression", reason2: "war", program: "Belarus Sanctions", tags: ["BELARUS", "BELARUS-EO14038"], eased: true,
    note: "Eased in 2025 and 2026 after prisoner releases: the potash producers, the finance ministry and some banks were removed from the list. Measures over Belarus's support for Russia's war remain." },
  { country: "Syria", level: 3, reason: "repression", reason2: "crime", program: "Promoting Accountability for Assad and Regional Stabilization (PAARSS)", tags: ["PAARSSR-EO13894"], eased: true,
    note: "The embargo ended in 2025, the Caesar Act was repealed in December 2025 and Syria left the terrorism list in August 2026. The remaining program targets the former Assad government's network and captagon drug traffickers." },
  { country: "Myanmar", level: 3, reason: "repression", program: "Burma-Related Sanctions", tags: ["BURMA-EO14014"],
    note: "Aimed at the military government, its leaders and military-owned firms." },
  { country: "Nicaragua", level: 3, reason: "repression", program: "Nicaragua-related Sanctions", tags: ["NICARAGUA", "NICARAGUA-NHRAA"],
    note: "Aimed at the government's officials and firms linked to them." },
  { country: "China", level: 3, reason: "weapons", reason2: "repression", program: "Chinese Military Companies; Hong Kong-Related Sanctions", tags: [],
    note: "Americans may not invest in listed Chinese military companies, and officials are sanctioned over Hong Kong. Many Chinese firms are also listed under other programs (Iran, Russia, drugs). Separate export controls (not shown here) restrict advanced technology." },
  { country: "Hong Kong", level: 3, reason: "repression", program: "Hong Kong-Related Sanctions", tags: [],
    note: "Aimed at officials responsible for curbing Hong Kong's autonomy. Many trading firms here are also listed under other programs (Iran, Russia)." },
  { country: "Sudan", level: 3, reason: "conflict", program: "Sudan and Darfur Sanctions", tags: ["SUDAN-EO14098", "DARFUR"],
    note: "Aimed at both sides of the civil war (the army and the Rapid Support Forces) and their firms." },
  { country: "S. Sudan", level: 3, reason: "conflict", program: "South Sudan-Related Sanctions", tags: ["SOUTH SUDAN"],
    note: "Aimed at officials and commanders accused of prolonging the conflict." },
  { country: "Central African Rep.", level: 3, reason: "conflict", program: "Central African Republic Sanctions", tags: ["CAR"],
    note: "Aimed at armed groups and people fuelling the conflict, including Wagner-linked firms." },
  { country: "Dem. Rep. Congo", level: 3, reason: "conflict", program: "Democratic Republic of the Congo-Related Sanctions", tags: ["DRCONGO"],
    note: "Aimed at armed groups (including M23), their backers and conflict-mineral traders." },
  { country: "Libya", level: 3, reason: "conflict", program: "Libya Sanctions", tags: ["LIBYA2", "LIBYA3"],
    note: "Aimed at people threatening Libya's peace and at illegal oil exports; parts of Qaddafi-era assets remain frozen." },
  { country: "Somalia", level: 3, reason: "conflict", reason2: "terror", program: "Somalia Sanctions", tags: ["SOMALIA"],
    note: "Aimed at al-Shabaab and people threatening Somalia's peace." },
  { country: "Somaliland", level: 3, reason: "conflict", reason2: "terror", program: "Somalia Sanctions", tags: ["SOMALIA"],
    note: "Counted as part of Somalia by the US. The Somalia program is aimed at al-Shabaab and people threatening the peace." },
  { country: "Yemen", level: 3, reason: "conflict", reason2: "terror", program: "Yemen-related Sanctions", tags: ["YEMEN"],
    note: "Aimed at people threatening Yemen's peace. The Houthis are also listed as a terrorist organization." },
  { country: "Mali", level: 3, reason: "conflict", program: "Mali-Related Sanctions", tags: ["MALI-EO13882"],
    note: "Aimed at people obstructing Mali's peace agreement, including senior military officers." },
  { country: "Iraq", level: 3, reason: "terror", program: "Iraq-Related Sanctions", tags: ["IRAQ2", "IRAQ3"],
    note: "Aimed at former Saddam-era officials and Iran-aligned militias, not the Iraqi government." },
  { country: "Lebanon", level: 3, reason: "terror", program: "Lebanon-Related Sanctions", tags: ["LEBANON"],
    note: "Aimed at people undermining Lebanon's sovereignty, mostly linked to Hezbollah, which is also listed as a terrorist organization." },
  { country: "Afghanistan", level: 3, reason: "terror", program: "Afghanistan-Related Sanctions", tags: [],
    note: "Aimed at the Taliban, who govern the country and are listed as terrorists. Humanitarian aid and ordinary trade are allowed under general licenses." },
  { country: "Zimbabwe", level: 4, reason: "repression", program: null, tags: [],
    note: "The Zimbabwe program ended in March 2024. The president and some officials remain listed under Global Magnitsky (corruption)." },
];

// Regions under a full embargo, drawn from regions.js on top of their country.
const SANCTION_REGION_INFO = {
  "Crimea": { level: 1, reason: "war", program: "Ukraine-/Russia-related (Crimea)", tags: ["UKRAINE-EO13685"],
    note: "Embargo on the Russian-occupied Crimea region since 2014." },
  "Sevastopol": { level: 1, reason: "war", program: "Ukraine-/Russia-related (Crimea)", tags: ["UKRAINE-EO13685"],
    note: "Part of the Crimea embargo since 2014." },
  "Donetsk region": { level: 1, reason: "war", program: "Ukraine-/Russia-related (DNR and LNR)", tags: ["RUSSIA-EO14065"],
    note: "Embargo since 2022 on the so-called Donetsk People's Republic: the Russian-occupied part of the region (the whole region is shaded)." },
  "Luhansk region": { level: 1, reason: "war", program: "Ukraine-/Russia-related (DNR and LNR)", tags: ["RUSSIA-EO14065"],
    note: "Embargo since 2022 on the so-called Luhansk People's Republic: the Russian-occupied part of the region (the whole region is shaded)." },
};

// Plain names for the program codes on OFAC's list (for the card), matched in order.
const PROGRAM_FAMILIES = [
  [/^RUSSIA|^UKRAINE|^CAATSA - RUSSIA|^PEESA|^MAGNIT$|^SSIDES$/, "Russia / Ukraine"],
  [/^IRAN|^IRGC|^IFSR|^HRIT-IR|^CAATSA - IRAN/, "Iran"],
  [/^DPRK/, "North Korea"],
  [/^CUBA/, "Cuba"],
  [/^VENEZUELA/, "Venezuela"],
  [/^BELARUS/, "Belarus"],
  [/^BURMA/, "Burma (Myanmar)"],
  [/^PAARSS|^HRIT-SY/, "Syria (former Assad network)"],
  [/^SDGT$|^FTO$/, "Terrorism"],
  [/^SDNTK$|^SDNT$|^ILLICIT-DRUGS/, "Drug trafficking"],
  [/^TCO$/, "Organized crime"],
  [/^NPWMD$|^IFCA$|^NS-PLC$/, "Weapons proliferation"],
  [/^GLOMAG$/, "Corruption and abuses (Global Magnitsky)"],
  [/^CYBER/, "Cyber"],
  [/^ELECTION/, "Election interference"],
  [/^BALKANS/, "Western Balkans"],
  [/^ICC/, "International Criminal Court"],
  [/^HOSTAGES/, "Hostage-taking"],
  [/^UHRPA$/, "Uyghur human rights (China)"],
  [/^PAIPA$/, "Intellectual property theft"],
  [/^NICARAGUA/, "Nicaragua"],
  [/^SUDAN|^DARFUR/, "Sudan"],
  [/^SOUTH SUDAN/, "South Sudan"],
  [/^DRCONGO/, "DR Congo"],
  [/^CAR$/, "Central African Republic"],
  [/^LIBYA/, "Libya"],
  [/^SOMALIA/, "Somalia"],
  [/^YEMEN/, "Yemen"],
  [/^MALI/, "Mali"],
  [/^IRAQ/, "Iraq"],
  [/^LEBANON/, "Lebanon"],
];

// The reason behind each program family, for countries without a program of their own. Families not listed
// here (the International Criminal Court program, "Other") don't count towards a reason.
const FAMILY_REASON = {
  "Russia / Ukraine": "war",
  "Iran": "weapons", "North Korea": "weapons", "Weapons proliferation": "weapons",
  "Cuba": "repression", "Venezuela": "repression", "Belarus": "repression", "Burma (Myanmar)": "repression",
  "Nicaragua": "repression", "Syria (former Assad network)": "repression",
  "Corruption and abuses (Global Magnitsky)": "repression", "Uyghur human rights (China)": "repression",
  "Sudan": "conflict", "South Sudan": "conflict", "DR Congo": "conflict", "Central African Republic": "conflict",
  "Libya": "conflict", "Somalia": "conflict", "Yemen": "conflict", "Mali": "conflict", "Western Balkans": "conflict",
  "Terrorism": "terror", "Iraq": "terror", "Lebanon": "terror", "Hostage-taking": "terror",
  "Drug trafficking": "crime", "Organized crime": "crime", "Cyber": "crime", "Election interference": "crime",
  "Intellectual property theft": "crime",
};
// A country without a program gets a reason only when at least this many of its people and companies are listed.
const REASON_MIN_LISTED = 10;

// The United States and its territories: they set the sanctions.
const US_HOME = ["United States of America", "Puerto Rico", "Guam", "U.S. Virgin Is.", "American Samoa", "N. Mariana Is."];

const MeridianSanctions = (() => {
  const byCountry = new Map(SANCTION_COUNTRIES.map((c) => [c.country, c]));
  const LABEL = Object.fromEntries(SANCTION_LEVELS.map((l) => [l.level, l.label]));

  function familyOf(tag) {
    for (const [re, label] of PROGRAM_FAMILIES) if (re.test(tag)) return label;
    return "Other";
  }

  // [["Russia / Ukraine", 4210], ["Terrorism", 120], …] for a country's listed people and companies, largest
  // first. sanctions-data.json counts each one once per family; older copies only have per-code counts.
  function families(counts) {
    if (counts.families) return Object.entries(counts.families).sort((a, b) => b[1] - a[1]);
    const sum = new Map();
    for (const [tag, n] of Object.entries(counts.programs || {})) sum.set(familyOf(tag), (sum.get(familyOf(tag)) || 0) + n);
    return [...sum].sort((a, b) => b[1] - a[1]);
  }

  // A country's level, with OFAC's list (sanctions-data.json) when there is one:
  // - A country program none of whose codes is still on the list has ended: the level drops to 4 or 5.
  // - Countries without a program are 4 if anyone based there is listed, otherwise 5.
  // Returns { level, entry, entities, lowered } (lowered: the hand-set level it was lowered from).
  function levelOf(name, data, entry = byCountry.get(name)) {
    const counts = data && data.countries ? data.countries[name] : null;
    const entities = counts ? counts.entities : null;
    const fallback = data ? (entities ? 4 : 5) : null; // null: no list, so unknown
    if (US_HOME.includes(name)) return { level: null, entry: null, entities, home: true };
    if (!entry) return { level: fallback, entry: null, entities };
    if (entry.level <= 3 && data && data.tags && entry.tags.length && !entry.tags.some((t) => data.tags.includes(t))) {
      return { level: fallback, entry, entities, lowered: entry.level };
    }
    return { level: entry.level, entry, entities };
  }

  // An embargoed region, or null if it has none (or its program ended: it then takes its country's color).
  function regionLevel(name, data) {
    const info = SANCTION_REGION_INFO[name];
    if (!info) return null;
    const r = levelOf(name, data, { country: name, ...info });
    return r.lowered ? null : r;
  }

  // Why a country is sanctioned, for a levelOf/regionLevel result r:
  // - a program country (not lowered): its hand-set reason and second reason;
  // - otherwise, with the list: the reason most of its listed people and companies fall under, if at least
  //   REASON_MIN_LISTED are listed. share: that reason's part of the count (people under several are
  //   counted once per family).
  // Returns { reason, reason2, auto, share } or null.
  function reasonOf(name, data, r) {
    if (!r || r.home) return null;
    if (r.entry && r.entry.reason && !r.lowered) return { reason: r.entry.reason, reason2: r.entry.reason2 || null, auto: false };
    const counts = data && data.countries ? data.countries[name] : null;
    if (!counts || (counts.entities || 0) < REASON_MIN_LISTED) return null;
    const sum = new Map();
    for (const [family, n] of families(counts)) {
      const reason = FAMILY_REASON[family];
      if (reason) sum.set(reason, (sum.get(reason) || 0) + n);
    }
    const total = [...sum.values()].reduce((a, b) => a + b, 0);
    if (!total) return null;
    const [reason, n] = [...sum].sort((a, b) => b[1] - a[1])[0];
    return { reason, reason2: null, auto: true, share: n / total };
  }

  const REASON = Object.fromEntries(SANCTION_REASONS.map((x) => [x.id, x]));

  return { LABEL, REASON, familyOf, families, levelOf, regionLevel, reasonOf, byCountry };
})();
