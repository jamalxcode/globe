// US sanctions by country, for the Sanctions view. The levels are this site's simplification of OFAC's
// programs, not an official US scale. sanctions-data.json (built by scripts/sanctions.mjs from OFAC's own list,
// at most once a day) adds how many listed people and companies are based in each country (in all, and listed in
// the last RECENT_YEARS years), which programs have ended, and warnings for a person to look at.
"use strict";

const SANCTIONS_CHECKED = "2026-10-12"; // when the levels below were last checked by hand

const SANCTION_LEVELS = [
  { level: 1, label: "Full embargo", text: "Nearly all trade with the US is banned." },
  { level: 2, label: "Heavy", text: "The government or whole sectors of the economy (banks, energy, technology) are blocked, but it is not a full embargo." },
  { level: 3, label: "Targeted program", text: "The US has a sanctions program for this country, aimed at officials, armed groups, the military or some firms. Ordinary trade is allowed." },
  { level: 4, label: "No country program", text: "No US sanctions on the country itself. Some people or companies based here may be on the US list (see the card)." },
];

// Why: one main reason per country (the Reason colors). Countries with a program have it set by hand below;
// the rest get it from what most of their recently listed people and companies are listed for (see reasonOf).
const SANCTION_REASONS = [
  { id: "war", label: "War & aggression", text: "Russia's war on Ukraine, and the firms helping Russia get around sanctions." },
  { id: "weapons", label: "Weapons & military threat", text: "Nuclear, missile and weapons programs, and their suppliers." },
  { id: "repression", label: "Repression & corruption", text: "Governments that crush opposition or rig elections, human-rights abusers and corrupt officials." },
  { id: "conflict", label: "Armed conflict", text: "Warlords, militias and backers prolonging civil wars, and conflict-mineral traders." },
  { id: "terror", label: "Terrorism & militias", text: "Terrorist groups, armed militias and their financiers." },
  { id: "crime", label: "Crime, drugs & cyber", text: "Drug cartels, organized crime, hackers and election interference." },
  { id: "evasion", label: "Sanctions evasion", text: "Trading, shipping and finance networks helping Iran, Russia or another sanctioned country get around US sanctions." },
];

// Countries with their own US program (and Zimbabwe, whose program ended). Names as on the map.
// reason, reason2: main and (optional) second reason, from SANCTION_REASONS.
// tags: the program codes on OFAC's list that belong to this program. pages: the program's page(s) on OFAC's site
// (the end of the address). When none of the tags is on the list and the pages are gone, for LOWER_AFTER_DAYS days
// in a row, the program has ended and the level drops by itself (scripts/sanctions.mjs decides; see levelOf).
// With no tags (the program's people are listed under other codes), only the pages are checked.
// eased: sanctions were eased recently and the level may change again.
const SANCTION_COUNTRIES = [
  { country: "Cuba", level: 1, reason: "repression", program: "Cuba Sanctions", tags: ["CUBA", "CUBA-EO14404"], pages: ["cuba-sanctions"],
    note: "Trade embargo since 1962. Also on the State Department's list of state sponsors of terrorism." },
  { country: "Iran", level: 1, reason: "weapons", reason2: "terror", program: "Iran Sanctions", tags: ["IRAN", "IRAN-EO13902", "IRAN-EO13846", "IRAN-EO13871", "IRAN-EO13876", "IRGC", "IFSR", "IRAN-HR", "IRAN-TRA", "IRAN-CON-ARMS-EO", "HRIT-IR", "CAATSA - IRAN"], pages: ["iran-sanctions"],
    note: "Almost all trade banned, and foreign firms dealing with Iran's oil, banks or shipping can be sanctioned too. State sponsor of terrorism." },
  { country: "North Korea", level: 1, reason: "weapons", program: "North Korea Sanctions", tags: ["DPRK", "DPRK2", "DPRK3", "DPRK4", "DPRK-NKSPEA"], pages: ["north-korea-sanctions"],
    note: "Almost all trade banned. State sponsor of terrorism." },
  { country: "Russia", level: 2, reason: "war", program: "Russian Harmful Foreign Activities; Ukraine-/Russia-related", tags: ["RUSSIA-EO14024", "UKRAINE-EO13660", "UKRAINE-EO13661", "UKRAINE-EO13662", "CAATSA - RUSSIA", "PEESA-EO14039"], pages: ["russian-harmful-foreign-activities-sanctions", "ukraine-russia-related-sanctions"],
    note: "Major banks, the central bank's reserves, energy companies (Rosneft and Lukoil since October 2025), technology exports and many services are blocked. Not a full embargo." },
  { country: "Venezuela", level: 2, reason: "repression", reason2: "crime", program: "Venezuela-Related Sanctions", tags: ["VENEZUELA", "VENEZUELA-EO13850", "VENEZUELA-EO13884"], pages: ["venezuela-related-sanctions"], eased: true,
    note: "The Venezuelan government is still blocked, but since early 2026 general licenses allow most oil trade, including with the state oil company PDVSA." },
  { country: "Belarus", level: 3, reason: "repression", reason2: "war", program: "Belarus Sanctions", tags: ["BELARUS", "BELARUS-EO14038"], pages: ["belarus-sanctions"], eased: true,
    note: "Eased in 2025 and 2026 after prisoner releases: the potash producers, the finance ministry and some banks were removed from the list. Measures over Belarus's support for Russia's war remain." },
  { country: "Syria", level: 3, reason: "repression", reason2: "crime", program: "Promoting Accountability for Assad and Regional Stabilization (PAARSS)", tags: ["PAARSSR-EO13894"], pages: ["paarss"], eased: true,
    note: "The embargo ended in 2025, the Caesar Act was repealed in December 2025 and Syria left the terrorism list in August 2026. The remaining program targets the former Assad government's network and captagon drug traffickers." },
  { country: "Myanmar", level: 3, reason: "repression", program: "Burma-Related Sanctions", tags: ["BURMA-EO14014"], pages: ["burma"],
    note: "Aimed at the military government, its leaders and military-owned firms." },
  { country: "Nicaragua", level: 3, reason: "repression", program: "Nicaragua-related Sanctions", tags: ["NICARAGUA", "NICARAGUA-NHRAA"], pages: ["nicaragua-related-sanctions"],
    note: "Aimed at the government's officials and firms linked to them." },
  { country: "China", level: 3, reason: "weapons", reason2: "repression", program: "Chinese Military Companies; Hong Kong-Related Sanctions", tags: [], pages: ["chinese-military-companies-sanctions", "hong-kong-related-sanctions"],
    note: "Americans may not invest in listed Chinese military companies, and officials are sanctioned over Hong Kong. Many Chinese firms are also listed under other programs (Iran, Russia, drugs). Separate export controls (not shown here) restrict advanced technology." },
  { country: "Hong Kong", level: 3, reason: "repression", program: "Hong Kong-Related Sanctions", tags: [], pages: ["hong-kong-related-sanctions"],
    note: "Aimed at officials responsible for curbing Hong Kong's autonomy. Many trading firms here are also listed under other programs (Iran, Russia)." },
  { country: "Sudan", level: 3, reason: "conflict", program: "Sudan and Darfur Sanctions", tags: ["SUDAN-EO14098", "DARFUR"], pages: ["sudan-and-darfur-sanctions"],
    note: "Aimed at both sides of the civil war (the army and the Rapid Support Forces) and their firms." },
  { country: "S. Sudan", level: 3, reason: "conflict", program: "South Sudan-Related Sanctions", tags: ["SOUTH SUDAN"], pages: ["south-sudan-related-sanctions"],
    note: "Aimed at officials and commanders accused of prolonging the conflict." },
  { country: "Central African Rep.", level: 3, reason: "conflict", program: "Central African Republic Sanctions", tags: ["CAR"], pages: ["central-african-republic-sanctions"],
    note: "Aimed at armed groups and people fuelling the conflict, including Wagner-linked firms." },
  { country: "Dem. Rep. Congo", level: 3, reason: "conflict", program: "Democratic Republic of the Congo-Related Sanctions", tags: ["DRCONGO"], pages: ["democratic-republic-of-the-congo-related-sanctions"],
    note: "Aimed at armed groups (including M23), their backers and conflict-mineral traders." },
  { country: "Libya", level: 3, reason: "conflict", program: "Libya Sanctions", tags: ["LIBYA2", "LIBYA3"], pages: ["libya-sanctions"],
    note: "Aimed at people threatening Libya's peace and at illegal oil exports; parts of Qaddafi-era assets remain frozen." },
  { country: "Somalia", level: 3, reason: "conflict", reason2: "terror", program: "Somalia Sanctions", tags: ["SOMALIA"], pages: ["somalia-sanctions"],
    note: "Aimed at al-Shabaab and people threatening Somalia's peace." },
  { country: "Somaliland", level: 3, reason: "conflict", reason2: "terror", program: "Somalia Sanctions", tags: ["SOMALIA"], pages: ["somalia-sanctions"],
    note: "Counted as part of Somalia by the US. The Somalia program is aimed at al-Shabaab and people threatening the peace." },
  { country: "Yemen", level: 3, reason: "conflict", reason2: "terror", program: "Yemen-related Sanctions", tags: ["YEMEN"], pages: ["yemen-related-sanctions"],
    note: "Aimed at people threatening Yemen's peace. The Houthis are also listed as a terrorist organization." },
  { country: "Mali", level: 3, reason: "conflict", program: "Mali-Related Sanctions", tags: ["MALI-EO13882"], pages: ["mali-related-sanctions"],
    note: "Aimed at people obstructing Mali's peace agreement, including senior military officers." },
  { country: "Iraq", level: 3, reason: "terror", program: "Iraq-Related Sanctions", tags: ["IRAQ2", "IRAQ3"], pages: ["iraq-related-sanctions"],
    note: "Aimed at former Saddam-era officials and Iran-aligned militias, not the Iraqi government." },
  { country: "Lebanon", level: 3, reason: "terror", program: "Lebanon-Related Sanctions", tags: ["LEBANON"], pages: ["lebanon-related-sanctions"],
    note: "Aimed at people undermining Lebanon's sovereignty, mostly linked to Hezbollah, which is also listed as a terrorist organization." },
  { country: "Afghanistan", level: 3, reason: "terror", program: "Afghanistan-Related Sanctions", tags: [], pages: ["afghanistan-related-sanctions"],
    note: "Aimed at the Taliban, who govern the country and are listed as terrorists. Humanitarian aid and ordinary trade are allowed under general licenses." },
  { country: "Zimbabwe", level: 4, program: null, tags: [], pages: [],
    note: "The Zimbabwe program ended in March 2024. The president and some officials remain listed under Global Magnitsky (corruption)." },
];

// Regions under a full embargo, drawn from regions.js on top of their country.
const SANCTION_REGION_INFO = {
  "Crimea": { level: 1, reason: "war", program: "Ukraine-/Russia-related (Crimea)", tags: ["UKRAINE-EO13685"], pages: ["ukraine-russia-related-sanctions"],
    note: "Embargo on the Russian-occupied Crimea region since 2014." },
  "Sevastopol": { level: 1, reason: "war", program: "Ukraine-/Russia-related (Crimea)", tags: ["UKRAINE-EO13685"], pages: ["ukraine-russia-related-sanctions"],
    note: "Part of the Crimea embargo since 2014." },
  "Donetsk region": { level: 1, reason: "war", program: "Ukraine-/Russia-related (DNR and LNR)", tags: ["RUSSIA-EO14065"], pages: ["ukraine-russia-related-sanctions"],
    note: "Embargo since 2022 on the so-called Donetsk People's Republic: the Russian-occupied part of the region (the whole region is shaded)." },
  "Luhansk region": { level: 1, reason: "war", program: "Ukraine-/Russia-related (DNR and LNR)", tags: ["RUSSIA-EO14065"], pages: ["ukraine-russia-related-sanctions"],
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

// The reason behind each program family, for countries without a program of their own. Being listed from here
// under another country's program (Russia, Iran, North Korea, Cuba, Venezuela, Belarus, Syria) means helping that
// country get around sanctions. Families not listed here (the International Criminal Court program, "Other")
// don't count towards a reason.
const FAMILY_REASON = {
  "Russia / Ukraine": "evasion", "Iran": "evasion", "North Korea": "evasion", "Cuba": "evasion",
  "Venezuela": "evasion", "Belarus": "evasion", "Syria (former Assad network)": "evasion",
  "Weapons proliferation": "weapons",
  "Burma (Myanmar)": "repression", "Nicaragua": "repression",
  "Corruption and abuses (Global Magnitsky)": "repression", "Uyghur human rights (China)": "repression",
  "Sudan": "conflict", "South Sudan": "conflict", "DR Congo": "conflict", "Central African Republic": "conflict",
  "Libya": "conflict", "Somalia": "conflict", "Yemen": "conflict", "Mali": "conflict", "Western Balkans": "conflict",
  "Terrorism": "terror", "Iraq": "terror", "Lebanon": "terror", "Hostage-taking": "terror",
  "Drug trafficking": "crime", "Organized crime": "crime", "Cyber": "crime", "Election interference": "crime",
  "Intellectual property theft": "crime",
};
// A country without a program gets a reason only when it's clear: at least REASON_MIN_RECENT people and companies
// based there were listed in the last RECENT_YEARS years, and more than REASON_MIN_SHARE of them for that reason.
// Old listings (many date from 2001 to 2010) say little about a country today.
const RECENT_YEARS = 5;
const REASON_MIN_RECENT = 25;
const REASON_MIN_SHARE = 0.6;
// A program has to look ended (codes off the list and pages gone) this long before its countries are lowered.
const LOWER_AFTER_DAYS = 7;
// Hand-set levels older than this, or a list older than STALE_LIST_DAYS, turn the status pill amber.
const CHECK_EVERY_DAYS = 90;
const STALE_LIST_DAYS = 3;

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

  // A country's level. Countries without a program are 4. A program country is lowered to 4 only when
  // sanctions-data.json lists it in `ended`: scripts/sanctions.mjs puts it there once its codes have been off
  // OFAC's list and its pages gone from OFAC's site for LOWER_AFTER_DAYS days.
  // Returns { level, entry, entities, recent, lowered } (lowered: the hand-set level it was lowered from).
  function levelOf(name, data, entry = byCountry.get(name)) {
    const counts = data && data.countries ? data.countries[name] : null;
    const entities = counts ? counts.entities : null;
    const recent = counts && counts.recent !== undefined ? counts.recent : null;
    if (US_HOME.includes(name)) return { level: null, entry: null, entities, recent, home: true };
    if (!entry) return { level: 4, entry: null, entities, recent };
    if (entry.level <= 3 && data && data.ended && data.ended.includes(name)) return { level: 4, entry, entities, recent, lowered: entry.level };
    return { level: entry.level, entry, entities, recent };
  }

  // An embargoed region, or null if it has none (or its program ended: it then takes its country's color).
  function regionLevel(name, data) {
    const info = SANCTION_REGION_INFO[name];
    if (!info) return null;
    const r = levelOf(name, data, { country: name, ...info });
    return r.lowered ? null : r;
  }

  // The reasons a listed person or company counts towards, from its program codes.
  function reasonsOfTags(tags) {
    return [...new Set(tags.map((t) => FAMILY_REASON[familyOf(t)]).filter(Boolean))];
  }

  // Why a country is sanctioned, for a levelOf/regionLevel result r:
  // - a program country (not lowered): its hand-set reason and second reason;
  // - otherwise only when clear: of the people and companies based there and listed in the last RECENT_YEARS
  //   years (at least REASON_MIN_RECENT), more than REASON_MIN_SHARE are listed for one reason.
  // Returns { reason, reason2, auto, share, recent } or null.
  function reasonOf(name, data, r) {
    if (!r || r.home) return null;
    if (r.entry && r.entry.reason && r.level <= 3 && !r.lowered) return { reason: r.entry.reason, reason2: r.entry.reason2 || null, auto: false };
    const counts = data && data.countries ? data.countries[name] : null;
    if (!counts || !counts.recentReasons || (counts.recent || 0) < REASON_MIN_RECENT) return null;
    const [reason, n] = Object.entries(counts.recentReasons).sort((a, b) => b[1] - a[1])[0] || [];
    if (!reason || n / counts.recent <= REASON_MIN_SHARE) return null;
    return { reason, reason2: null, auto: true, share: n / counts.recent, recent: counts.recent };
  }

  // What a person should look at, shown in the status pill: warnings from the last list check, hand-set levels
  // not checked for CHECK_EVERY_DAYS, or a list older than STALE_LIST_DAYS. Returns a list of sentences.
  function needsCheck(data, now = Date.now()) {
    const out = [];
    const checkedDays = Math.floor((now - Date.parse(SANCTIONS_CHECKED)) / 864e5);
    if (checkedDays > CHECK_EVERY_DAYS) out.push(`The levels were last checked by hand ${checkedDays} days ago.`);
    if (data && now - Date.parse(data.generated_at) > STALE_LIST_DAYS * 864e5) out.push(`OFAC's list was last read ${Math.floor((now - Date.parse(data.generated_at)) / 864e5)} days ago.`);
    if (data && data.warnings) out.push(...data.warnings);
    return out;
  }

  const REASON = Object.fromEntries(SANCTION_REASONS.map((x) => [x.id, x]));

  return { LABEL, REASON, familyOf, families, levelOf, regionLevel, reasonsOfTags, reasonOf, needsCheck, byCountry };
})();
