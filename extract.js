// Turns news items into "mentions": one headline that names a kind of strike and a known place.
// Shared by the page (app.js) and the archiver (scripts/archive.mjs), so both apply the same rules.
// Needs places.js and cities.js loaded first, and a global d3 with geoCentroid and geoArea.
var MeridianExtract = (function () {
  "use strict";

  const SKIP_CATEGORIES = new Set(["tech", "biz", "science"]);
  // "Other" (a bare "strike" or "attack") is only trusted from conflict-focused sources.
  const OTHER_CATEGORIES = new Set(["osint", "mideast", "defense"]);

  // First match wins, so the more specific kinds come first.
  const TYPE_RULES = [
    ["drone", /\b(drones?|UAVs?|Shaheds?|Gerans?|loitering munitions?|kamikaze)\b/i],
    ["missile", /\b(missiles?|ballistic|Iskanders?|Kinzhals?|Kalibrs?|ATACMS|Storm Shadows?|HIMARS|rockets?|interceptors?|intercepted|interceptions?|projectiles?)\b/i],
    ["airstrike", /\b(air ?strikes?|air-strikes?|air ?raids?|warplanes?|fighter jets?|bombings?|bombed|bombard\w*|glide bombs?|guided bombs?)\b/i],
    // "shells" only as plural/verb: "Shell" alone is usually the oil company.
    ["shelling", /\b(shelling|shelled|shells|artillery|mortars?|MLRS|howitzers?)\b/i],
    ["explosion", /\b(explosions?|(a|the|massive|huge|large|powerful|deadly|mine|bomb|twin) blasts?|blasts? (in|at|near|rocks?|rocked|kills?|killed|heard|hits?)|exploded|detonat\w+|car bombs?|IEDs?|blew up|blown up|suicide bomb\w*)\b/i],
    // Incidents that hit a country's land, water or resources, accident or not.
    ["wildfire", /\b(wildfires?|wild ?land fires?|forest fires?|bush ?fires?|brush ?fires?|grass ?fires?|peat fires?|fires? (rages?|raging|spreads?|spreading) (through|across))\b/i],
    ["environment", /\b(oil spills?|fuel spills?|chemical spills?|toxic (spills?|leaks?|clouds?)|(gas|ammonia|chlorine|chemical|radiation|radioactive) leaks?|pipeline (leaks?|ruptures?|bursts?|spills?|breach\w*)|oil (leaks?|slicks?)|dam (breach\w*|bursts?|collapses?|failures?)|(dam|levee) (breaks?|broke)|mine (collapses?|accidents?|disasters?|floods?|blasts?|explosions?)|(river|water|sea|lake|groundwater) (contaminat\w+|pollut\w+)|contaminat\w+ (of|in) (the )?(river|water|sea|lake))\b/i],
    // Only at a facility (see FIRE_TARGETS): a refinery fire counts, a house fire doesn't.
    ["fire", /\b(fires?|blaze|ablaze|burn(s|ing)?|flames|inferno)\b/i],
    ["other", /\b(strikes?|struck|shot down|downed|attacks? on|attacked)\b/i],
  ];

  // Fires count only at these kinds of site (targets from TARGET_RULES below).
  const FIRE_TARGETS = new Set(["fuel", "power", "industry", "military", "ship", "airport", "rail"]);

  // A weapon alone ("drone maker opens plant") isn't an event; the headline must also say something happened.
  const ACTION = /\b(attack(s|ed|ing)?|launch(es|ed|ing)? (\w+ )?(at|on|against|toward|towards)|strikes?|struck|hit(s|ting)?|shot down|downed|intercept(s|ed|ion|ions)?|explosions?|blasts?|explod\w+|detonat\w+|kill(s|ed|ing)?|injur\w+|wound\w+|damag\w+|destroy\w+|fires?|burn(s|ing|ed)?|ablaze|blazes?|engulf\w*|flames|inferno|gutted|(breaks?|broke) out|sank|sinks?|sinking|sunk|target(s|ed|ing)|land(ed|s)? (in|on|near)|impacts?|shelling|shelled|shells|air ?strikes?|air ?raids?|bombed|bombing|bombard\w*|casualt\w+|dead|died|victims?|pounded|hammered)\b/i;

  // Headlines that use strike words for something else, or talk about what might happen.
  const NEGATIVE = /\b(on strike|strike action|strikers|workers'? strike|general strike|hunger strike|labou?r strike|walkouts?|explosive (growth|rise|increase|claims?|allegations?|report|interview|testimony)|population explosion|lawsuits?|films?|movies?|documentary|anniversary|years ago|missile tests?|tests?|tested|test[- ]?fir\w*|test[- ]?launch\w*|test flights?|acceptance firing|successfully launch\w*|first release|drills?|military exercises?|contest|parade|contracts?|arms deals?|arms sales?|sale|approved|procure\w*|budget|aid package|unveil\w*|presented|develop\w*|manufactur\w*|delivery|deliveries|supply chain|subsidiary|partnership|SpaceX|NASA|Starship|spacecraft|satellite launch|open(ed)? fire|gunfire|fire brigades?|fire season|fire risk|potential|possible|could|might|would|threat of|fears?|plot|prepar\w+|plans? to|expected|may be|risk of|projected)\b/i;

  // Stories that look back at an earlier attack (features, investigations, recaps). Their publish time is new,
  // but the event isn't: "Generals were warned their Kuwait location was vulnerable. Then an Iranian drone hit".
  const RETRO = /\b(were warned|was warned|had warned|had been|investigat\w+|probe into|inquiry|report finds|documents show|records show|declassified|look(s|ing)? back|lessons from|recall(s|ed)?|remember(s|ed|ing)?|retrospective|explainer|what we know|how (a|an|the)|why (a|an|the)|inside the|(months?|weeks?|years?) (ago|after|later|on|since)|last (year|month|spring|summer|autumn|fall|winter)|earlier this year|a year (ago|after|since))\b|[.!?]\s+Then\b/i;

  // Month names. "May" also counts only in a date ("May 3", "in May"), since "may" is a common word.
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTH_RE = /\b(January|February|March|April|June|July|August|September|Sept|October|November|December)\b|\b(in|since|last|early|late|mid|of|on) May\b|\bMay \d/g;

  // True when the headline names a month other than the one it was published in (or, in a month's first
  // three days, the month before), so it's about something that happened earlier.
  function namesOtherMonth(title, published) {
    const d = new Date(published);
    const now = d.getUTCMonth();
    const prev = d.getUTCDate() <= 3 ? (now + 11) % 12 : now;
    for (const m of title.matchAll(MONTH_RE)) {
      const word = m[1] || "May";
      const index = word === "Sept" ? 8 : MONTHS.indexOf(word);
      if (index !== now && index !== prev) return true;
    }
    return false;
  }

  // A place right after one of these words is more likely where it happened than who did it.
  const PLACE_CUES = new Set(["in", "on", "near", "at", "over", "into", "across", "off", "inside", "throughout", "around", "outside", "inside", "of", "targeting", "targeted", "targets", "hit", "hits", "struck", "strikes", "strike", "attack", "attacks", "attacked", "pounds", "pounded", "bombed", "bombs", "shelled", "shells", "toward", "towards"]);

  // What was hit, when the headline says. First match wins, so the more specific targets come first
  // ("airport fuel depot" is an airport, "power plant" is power, not industry).
  const TARGET_RULES = [
    ["hospital", /\b(hospitals?|clinics?|medical (centre|center|facility|facilities)|ambulances?)\b/i],
    ["airport", /\b(airports?|airfields?|air ?bases?|aerodromes?|runways?|hangars?)\b/i],
    ["fuel", /\b(refiner(y|ies)|oil (depots?|terminals?|facilit\w+|storage|tanks?|fields?|plants?|platforms?)|fuel (depots?|storage|tanks?|facilit\w+|stations?)|petrol(eum)? (depots?|facilit\w+)|gas (plants?|facilit\w+|fields?|stations?)|LNG|pipelines?|tank farm)\b/i],
    ["power", /\b(power (plants?|stations?|grid|lines?|facilit\w+|infrastructure|substations?)|substations?|thermal (power )?plants?|energy (infrastructure|facilit\w+|sites?)|hydroelectric|dams?|nuclear (power )?plants?|electricity)\b/i],
    ["rail", /\b(railways?|railroads?|rail (lines?|stations?|infrastructure|depots?|hub)|train stations?|trains?|locomotives?)\b/i],
    ["bridge", /\b(bridges?)\b/i],
    ["ship", /\b(ports?|harbou?rs?|docks?|shipyards?|ships?|vessels?|tankers?|freighters?|warships?|frigates?|boats?)\b/i],
    ["military", /\b(military (bases?|facilit\w+|sites?|targets?|positions?|headquarters|HQ|airfields?)|bases?|barracks|command (posts?|centers?|centres?)|headquarters|air defen[cs]e|radars?|ammunition (depots?|warehouses?|dumps?|stores?)|arms (depots?|warehouses?)|weapons (depots?|warehouses?|stores?)|arsenals?|troops)\b/i],
    ["industry", /\b(factor(y|ies)|plants?|industrial|enterprises?|warehouses?|depots?|production (facilit\w+|sites?)|workshops?)\b/i],
    ["civilian", /\b(residential|apartments?|high-rises?|blocks? of flats|homes?|houses?|buildings?|neighbou?rhoods?|villages?|markets?|schools?|universit(y|ies)|kindergartens?|shelters?|civilians?)\b/i],
  ];

  // ---------- Arabic, Russian, Ukrainian ----------
  // Same kinds of rule as above. Cyrillic words are matched by stem (case endings vary); Arabic words may carry
  // attached prefixes, so they're matched anywhere in a word. Text is normalized first (normalizeI18n).

  const CYRILLIC = /[Ѐ-ӿ]/;
  const ARABIC = /[؀-ۿ]/;

  // Arabic letter variants (أ إ آ -> ا, ى -> ي, ة -> ه), no diacritics or tatweel; Cyrillic ё -> е.
  function normalizeI18n(s) {
    return s
      .replace(/[ً-ْـ]/g, "")
      .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/ё/g, "е").replace(/Ё/g, "Е");
  }

  function langOf(text) {
    if (ARABIC.test(text)) return "ar";
    if (CYRILLIC.test(text)) return /[іїєґІЇЄҐ]/.test(text) ? "uk" : "ru";
    return "en";
  }

  // Stems, matched case-insensitively at the start of a word.
  const stems = (list) => new RegExp(`(?<![\\p{L}])(${list})`, "iu");
  const anywhere = (list) => new RegExp(`(${list})`, "u");

  const I18N = {
    ru: {
      types: [
        ["drone", stems("беспилотн|бпла|дрон|шахед|герань")],
        ["missile", stems("ракет|искандер|кинжал|калибр|баллистич|пво сбил")],
        ["airstrike", stems("авиаудар|авиабомб|бомбардир|бомбов")],
        ["shelling", stems("обстрел|артиллер|артобстрел|миномет|рсзо")],
        ["explosion", stems("взрыв|детонац")],
        ["wildfire", stems("лесн[а-я]* пожар|природн[а-я]* пожар|пожар[а-я]* в лес")],
        ["environment", stems("разлив нефт|утечк[а-я]* (газа|аммиака|хлора)|прорыв дамб|обрушени[а-я]* шахт")],
        ["fire", stems("пожар|возгоран|горит|загорел")],
        ["other", stems("удар|атак")],
      ],
      action: stems("удар|атак|сбит|сбил|попал|поражен|уничтож|погиб|ранен|пострада|пожар|взрыв|обстрел|обломк|прилет|возгоран|загорел|горит|авиаудар|бомбардир"),
      negative: stems("учени|испытан|парад|контракт|закуп|поставк|выставк|годовщин|год назад|лет назад|может|возможн|угроз"),
      targets: [
        ["hospital", stems("больниц|госпитал|поликлиник")],
        ["airport", stems("аэропорт|аэродром|авиабаз")],
        ["fuel", stems("нпз|нефтебаз|нефтеперераб|нефтехранилищ|топлив|нефтяно|газопровод|нефтепровод")],
        ["power", stems("подстанц|электростанц|тэц|тэс|гэс|аэс|энергетич|энергообъект|электроснабж")],
        ["rail", stems("железнодорож|жд |вокзал|поезд|локомотив")],
        ["bridge", stems("мост")],
        ["ship", stems("порт|судн|танкер|корабл|катер")],
        ["military", stems("военн[а-я]* (часть|объект|аэродром|баз)|казарм|склад[а-я]* боеприпас|арсенал|штаб")],
        ["industry", stems("завод|предприят|склад|комбинат|фабрик")],
        ["civilian", stems("жил[а-я]* дом|многоэтаж|многоквартир|частн[а-я]* дом|дом[а-я]* |школ|детск[а-я]* сад|рынок|торгов[а-я]* центр")],
      ],
      cues: new Set(["в", "во", "на", "по", "над", "под", "у", "около", "близ", "возле", "районе"]),
      speaker: /^\s*(заявил|сообщил|заявила|сообщило|сообщили|заявляет|утверждает|обвинил|обвиняет)/i,
      when: [
        ["overnight", stems("ночью|этой ночью|в ночь на|ночная атак")],
        ["yesterday", stems("вчера")],
        ["earlier today", stems("утром|сегодня утром")],
      ],
    },
    uk: {
      types: [
        ["drone", stems("безпілотн|бпла|дрон|шахед|ударн[а-яіїєґ]* бпла")],
        ["missile", stems("ракет|балістичн|іскандер|кинджал|калібр")],
        ["airstrike", stems("авіаудар|авіабомб|кабами|каб ")],
        ["shelling", stems("обстріл|артилер|міномет|рсзв")],
        ["explosion", stems("вибух|детонац")],
        ["wildfire", stems("лісов[а-яіїєґ]* пожеж|природн[а-яіїєґ]* пожеж")],
        ["environment", stems("розлив нафт|витік газу|витік аміаку|прорив дамб|обвал[а-яіїєґ]* шахт")],
        ["fire", stems("пожеж|загоран|горить|займан")],
        ["other", stems("удар|атак")],
      ],
      action: stems("удар|атак|збит|збил|влуч|уражен|знищ|загин|поранен|постражд|пожеж|вибух|обстріл|уламк|приліт|займан|горить|авіаудар"),
      negative: stems("навчан|випробуван|парад|контракт|закупів|постач|виставк|річниц|рік тому|років тому|може|можлив|загроз"),
      targets: [
        ["hospital", stems("лікарн|госпітал|поліклінік")],
        ["airport", stems("аеропорт|аеродром|авіабаз")],
        ["fuel", stems("нпз|нафтобаз|нафтопереробн|нафтосховищ|палив|газопровід|нафтопровід")],
        ["power", stems("підстанц|електростанц|тец|тес|гес|аес|енергетич|енергооб'єкт|енергооб’єкт|енергопостач")],
        ["rail", stems("залізнич|вокзал|потяг|локомотив")],
        ["bridge", stems("міст|мосту")],
        ["ship", stems("порт|судн|танкер|корабл")],
        ["military", stems("військов[а-яіїєґ]* (частин|об|аеродром|баз)|казарм|склад[а-яіїєґ]* боєприпас|арсенал|штаб")],
        ["industry", stems("завод|підприєм|склад|комбінат|фабрик")],
        ["civilian", stems("житлов|багатоповерх|багатоквартир|приватн[а-яіїєґ]* будин|будин|школ|дитяч[а-яіїєґ]* садок|ринок|торгов[а-яіїєґ]* центр")],
      ],
      cues: new Set(["в", "у", "на", "по", "над", "під", "біля", "поблизу", "районі"]),
      speaker: /^\s*(заявив|повідомив|заявила|повідомила|повідомили|стверджує|звинуватив)/i,
      when: [
        ["overnight", stems("вночі|цієї ночі|у ніч на|в ніч на|нічна атак")],
        ["yesterday", stems("вчора|учора")],
        ["earlier today", stems("вранці|зранку|сьогодні вранці")],
      ],
    },
    ar: {
      types: [
        ["drone", anywhere("مسير|مسيره|طائره مسيره|طائرات مسيره|درون")],
        ["missile", anywhere("صاروخ|صواريخ|باليستي")],
        ["airstrike", anywhere("غاره|غارات|قصف جوي|الطيران الحربي|طيران حربي")],
        ["shelling", anywhere("قصف مدفعي|قذائف|مدفعيه|قصف")],
        ["explosion", anywhere("انفجار|تفجير|عبوه ناسفه|سياره مفخخه")],
        ["wildfire", anywhere("حرائق الغابات|حريق غابات|حرائق غابات|حريق في غابه")],
        ["environment", anywhere("تسرب نفطي|تسرب الغاز|تسرب غاز|انهيار سد|انهيار منجم|تلوث")],
        ["fire", anywhere("حريق|حرائق|اشتعال|النيران")],
        ["other", anywhere("هجوم|استهداف|ضربه|ضربات")],
      ],
      action: anywhere("هجوم|استهداف|سقوط|اسقاط|اعتراض|مقتل|اصابه|قتلي|جرحي|انفجار|حريق|قصف|ضرب|تدمير|استهدف|شن|غاره|غارات"),
      negative: anywhere("مناورات|تجربه|استعراض|صفقه|ذكري|قبل عام|قبل سنوات|محتمل|قد "),
      targets: [
        ["hospital", anywhere("مستشفي|مشفي|مستوصف")],
        ["airport", anywhere("مطار|قاعده جويه")],
        ["fuel", anywhere("مصفاه|مستودع وقود|خزانات وقود|منشاه نفطيه|حقل نفط|خط انابيب")],
        ["power", anywhere("محطه كهرباء|محطه طاقه|محطه توليد|الكهرباء")],
        ["rail", anywhere("سكه حديد|قطار|محطه قطار")],
        ["bridge", anywhere("جسر")],
        ["ship", anywhere("ميناء|سفينه|ناقله|مرفا|زورق")],
        ["military", anywhere("قاعده عسكريه|موقع عسكري|ثكنه|مقر عسكري|مخزن اسلحه|مستودع ذخيره")],
        ["industry", anywhere("مصنع|مستودع|منشاه صناعيه")],
        ["civilian", anywhere("منزل|منازل|مبني سكني|سكني|مدرسه|سوق|خيام|مخيم")],
      ],
      cues: new Set(["في", "علي", "قرب", "شمال", "جنوب", "شرق", "غرب", "وسط", "مدينه", "بلده", "محيط"]),
      speaker: /^\s*(يقول|تقول|اعلن|اعلنت|تعلن|يعلن|تتهم|يتهم)/,
      when: [
        ["overnight", anywhere("الليله الماضيه|ليلا|خلال الليل|فجر اليوم|فجرا")],
        ["yesterday", anywhere("امس")],
        ["earlier today", anywhere("صباح اليوم")],
      ],
    },
  };

  // English time words for estimating when it happened (see whenOf).
  const EN_WHEN = [
    ["overnight", /\b(overnight|last night|night attack|during the night)\b/i],
    ["yesterday", /\byesterday\b/i],
    ["earlier today", /\b(this morning|earlier today|early today|early on \w+day)\b/i],
  ];
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  // { label, from, to } (ISO): when the headline implies it happened, or null for "around when reported".
  function whenOf(title, published, lang) {
    const t = Date.parse(published);
    const day = 24 * 3600e3;
    const startOfDay = (ms) => ms - (ms % day);
    const span = (label, from, to) => ({ label, from: new Date(from).toISOString(), to: new Date(Math.min(to, t)).toISOString() });
    const rules = lang === "en" ? EN_WHEN : I18N[lang].when;
    for (const [label, re] of rules) {
      if (!re.test(title)) continue;
      // A night is about 10 hours; the reader's or the place's time zone isn't known, so it's the 10 before the report.
      if (label === "overnight") return span(label, t - 10 * 3600e3, t);
      if (label === "yesterday") return span(label, startOfDay(t) - day, startOfDay(t));
      if (label === "earlier today") return span(label, startOfDay(t), t);
    }
    if (lang === "en") {
      const ago = title.match(/\b(\d{1,2}) hours? ago\b/i);
      if (ago) { const at = t - Number(ago[1]) * 3600e3; return span(`${ago[1]} hours before the report`, at - 3600e3, at + 3600e3); }
      const wd = title.match(/\bon (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i);
      if (wd) {
        const target = WEEKDAYS.indexOf(wd[1].toLowerCase());
        const back = (new Date(t).getUTCDay() - target + 7) % 7;
        if (back > 0) return span(`on ${wd[1][0].toUpperCase()}${wd[1].slice(1).toLowerCase()}`, startOfDay(t) - back * day, startOfDay(t) - (back - 1) * day);
      }
    }
    return null;
  }

  // Explainers and features ("How children in Yemen go to school...", "What we know about..."), by their opening.
  const I18N_RETRO = /^\s*(как |почему |что известно|что произошло|як |чому |що відомо|що сталося|كيف |لماذا |ماذا نعرف|ما الذي نعرفه)/i;

  function classifyI18n(text, lang, category, target) {
    const rules = I18N[lang];
    if (rules.negative.test(text) || I18N_RETRO.test(text.replace(/^[^.:!?]{0,60}[.:!?]\s+/, "")) || I18N_RETRO.test(text)) return null;
    const acted = rules.action.test(text);
    for (const [type, re] of rules.types) {
      const m = text.match(re);
      if (!m) continue;
      if (!acted && type !== "wildfire" && type !== "environment") continue;
      if (type === "fire" && !FIRE_TARGETS.has(target)) continue;
      if (type === "other" && !OTHER_CATEGORIES.has(category)) return null;
      return { type, term: m[1] || m[0] };
    }
    return null;
  }

  function matchTargetI18n(text, lang) {
    for (const [key, re] of I18N[lang].targets) {
      const m = text.match(re);
      if (m) return { key, term: (m[1] || m[0]).trim() };
    }
    return null;
  }

  // Like locate, for Arabic or Cyrillic text (already normalized).
  function locateI18n(matcher, text, lang) {
    const re = lang === "ar" ? matcher.araRegex : matcher.cyrRegex;
    if (!re) return null;
    const rules = I18N[lang];
    let best = null;
    for (const m of text.matchAll(re)) {
      const prefix = lang === "ar" ? m[1] : "";
      const name = lang === "ar" ? m[2] : m[1];
      const entry = matcher.i18n.get(name);
      if (!entry) continue;
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
      if (rules.speaker.test(after)) continue;
      const before = text.slice(Math.max(0, m.index - 24), m.index).toLowerCase().match(/([\p{L}]+)[\s,]*$/u);
      const cued = (before && rules.cues.has(before[1])) || /ب/.test(prefix);
      if (entry.precision === "country" && !cued) continue;
      const score = RANK[entry.precision] * 10 + (cued ? 4 : 0) - m.index / 10000;
      if (!best || score > best.score) best = { ...entry, score, term: m[0].trim(), cue: cued && before ? before[1] : null };
    }
    return best;
  }

  const RANK = { city: 3, region: 2, country: 1 };
  const RADIUS_KM = { city: 10, region: 100, country: 300 };

  function mainCentroid(feature) {
    const g = feature.geometry;
    if (!g) return null;
    if (g.type !== "MultiPolygon") return d3.geoCentroid(feature);
    let best = null;
    let bestArea = -1;
    for (const coordinates of g.coordinates) {
      const poly = { type: "Polygon", coordinates };
      const area = d3.geoArea(poly);
      if (area > bestArea) { bestArea = area; best = poly; }
    }
    return d3.geoCentroid(best);
  }

  // countries: GeoJSON features from world-atlas (the map's country shapes).
  function buildMatcher(countries) {
    const entries = new Map();
    for (const feature of countries) {
      const mapName = feature.properties && feature.properties.name;
      if (!mapName) continue;
      const aliases = COUNTRY_ALIASES[mapName] || [mapName];
      const display = aliases[0];
      let lat, lng;
      if (COUNTRY_CENTER[mapName]) [lat, lng] = COUNTRY_CENTER[mapName];
      else {
        const c = mainCentroid(feature);
        if (!c) continue;
        [lng, lat] = c;
      }
      for (const name of new Set([...aliases, mapName])) {
        if (COUNTRY_SKIP.has(name) || name.includes(". ")) continue;
        entries.set(name, { display, country: display, lat, lng, precision: "country" });
      }
    }
    // Provinces (provinces.js): every name also goes in `regions`, used when the headline adds "region",
    // "Oblast", "Province"... A "~" name counts only with such a suffix. A province never replaces a country.
    const regions = new Map();
    for (const raw of (typeof PROVINCE_LINES === "string" ? PROVINCE_LINES : "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const [names, country, lat, lng] = line.split("|");
      const list = names.split(";").map((n) => n.trim()).filter(Boolean);
      const entry = { display: list[0].replace(/^~/, ""), country, lat: Number(lat), lng: Number(lng), precision: "region" };
      for (const n of list) {
        const name = n.replace(/^~/, "");
        regions.set(name, entry);
        const existing = entries.get(name);
        if (existing && existing.precision === "country") continue;
        entries.set(name, n.startsWith("~") ? { ...entry, suffixOnly: true } : entry);
      }
    }
    // Capitals and large cities next, so the hand-picked places in places.js win any shared name.
    const lines = (typeof CITY_LINES === "string" ? CITY_LINES : "") + "\n" + PLACE_LINES;
    for (const raw of lines.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const [names, country, lat, lng, flag] = line.split("|");
      const list = names.split(";").map((n) => n.trim()).filter(Boolean);
      const entry = { display: list[0], country, lat: Number(lat), lng: Number(lng), precision: flag === "r" ? "region" : "city" };
      for (const name of list) entries.set(name, entry);
    }
    const alternation = [...entries.keys()]
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    // Arabic, Russian and Ukrainian names (names-i18n.js) point at the entries above.
    const i18n = new Map();
    const missing = [];
    for (const raw of (typeof I18N_NAMES === "string" ? I18N_NAMES : "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const [english, names] = line.split("|");
      const entry = entries.get(english);
      if (!entry) { missing.push(english); continue; }
      for (const n of names.split(";").map((s) => s.trim()).filter(Boolean)) i18n.set(normalizeI18n(n), entry);
    }
    const escape = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const byLength = (a, b) => b.length - a.length;
    const cyr = [...i18n.keys()].filter((n) => CYRILLIC.test(n)).sort(byLength).map(escape).join("|");
    const ara = [...i18n.keys()].filter((n) => ARABIC.test(n)).sort(byLength).map(escape).join("|");
    return {
      regex: new RegExp(`(?<![\\p{L}\\p{N}])(${alternation})(?![\\p{L}\\p{N}])`, "gu"),
      entries,
      regions,
      i18n,
      missingI18n: missing,
      // A stem plus up to 3 more letters (case endings); a name with an attached و ف ب ل ك in front.
      cyrRegex: cyr ? new RegExp(`(?<![\\p{L}])(${cyr})[\\p{L}'’]{0,3}(?![\\p{L}])`, "gu") : null,
      araRegex: ara ? new RegExp(`(?<![\\p{L}])([وفبلك]{0,2})(${ara})(?![\\p{L}])`, "gu") : null,
    };
  }

  // A place followed by one of these is the speaker ("Russia says", "Moscow warns"), not where it happened.
  // Also "Russia's army says": a possessive and one word, then the verb.
  const SPEAKER = /^(['’]s\s+\w+)?\s+(says?|said|claims?|claimed|accuses?|accused|warns?|warned|denies|denied|vows?|vowed|threatens?|threatened|condemns?|condemned|blames?|blamed|responds?|responded|announces?|announced|confirms?|confirmed|reports?|reported|insists?|urges?|urged|demands?|retaliates?|launch(es|ed)?|fired)\b/i;
  // Words after a name that make it the province rather than the city: "Kursk region", "Fars province".
  const REGION_SUFFIX = /^\s+(oblast|region|province|governorate|state|krai|district|prefecture|territory)\b/i;
  // Words that can sit between a cue and the place: "over southwestern Saudi Arabia", "in the occupied West Bank".
  const BETWEEN = /\s+(the|northern|southern|eastern|western|north-?eastern|north-?western|south-?eastern|south-?western|central|occupied|coastal|far)\s*$/;

  // The most specific place wins; among equals, one after a cue word ("in", "hits"...), then the first.
  // A whole country only counts with a cue ("in Russia", "hits Russia") or as "Russia's ...", so a country
  // named as the actor ("Russia says...", "Russia-Ukraine war") doesn't pin a marker to its middle.
  function locate(matcher, text) {
    if (!text || !matcher) return null;
    let best = null;
    for (const m of text.matchAll(matcher.regex)) {
      let entry = matcher.entries.get(m[1]);
      if (!entry) continue;
      const after = text.slice(m.index + m[1].length, m.index + m[1].length + 30);
      if (SPEAKER.test(after)) continue;
      // "Kursk region", "Kharkiv Oblast", "Rivers State": the province, even where the name is also a city.
      const suffix = after.match(REGION_SUFFIX);
      let term = m[1];
      if (suffix && matcher.regions && matcher.regions.has(m[1])) {
        entry = matcher.regions.get(m[1]);
        term = m[1] + suffix[0];
      } else if (entry.suffixOnly) continue;
      const prevChar = text[m.index - 1];
      const nextChar = after[0];
      if (entry.precision === "country" && (prevChar === "-" || nextChar === "-")) continue; // "Russia-Ukraine"
      let pre = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
      while (BETWEEN.test(pre)) pre = pre.replace(BETWEEN, " ");
      const before = pre.match(/([a-z]+)[\s,'’]*$/);
      const cued = before && PLACE_CUES.has(before[1]);
      const possessive = /^['’]s\b/.test(after);
      if (entry.precision === "country" && !cued && !possessive) continue;
      const score = RANK[entry.precision] * 10 + (cued ? 4 : 0) - m.index / 10000;
      if (!best || score > best.score) best = { ...entry, score, term, cue: cued ? before[1] : possessive ? "'s" : null };
    }
    return best;
  }

  // target: what the headline says was hit (detectTarget), needed to decide whether a fire counts.
  function classify(title, category, target) {
    if (NEGATIVE.test(title)) return null;
    const acted = ACTION.test(title);
    for (const [type, re] of TYPE_RULES) {
      const m = title.match(re);
      if (!m) continue;
      // A wildfire or a spill is itself the incident; everything else also needs a word saying something happened.
      if (!acted && type !== "wildfire" && type !== "environment") continue;
      if (type === "fire" && !FIRE_TARGETS.has(target)) continue;
      if (type === "other" && !OTHER_CATEGORIES.has(category)) return null;
      return { type, term: m[0] };
    }
    return null;
  }

  // { key, term }: the target and the words that named it.
  function matchTarget(text) {
    if (!text) return null;
    for (const [key, re] of TARGET_RULES) {
      const m = text.match(re);
      if (m) return { key, term: m[0] };
    }
    return null;
  }

  function detectTarget(text) {
    const hit = matchTarget(text);
    return hit ? hit.key : null;
  }

  // A wire agency the item credits ("Source: Reuters", "according to AP", "Reuters reports"), so reprints of
  // one wire story count as one source. Case-sensitive: "AP" must be the agency, not a word.
  const WIRE = /(?:[Aa]ccording to|[Cc]iting|[Cc]ites|[Vv]ia|[Ss]ource:|[Ss]ources:|\(|\s[-–—])\s*(Reuters|AP|Associated Press|AFP|Agence France-Presse)\b|\b(Reuters|AP|Associated Press|AFP)\s+(?:reports?|reported|says|said|news agency)\b/;

  function wireOf(text) {
    const m = text && text.match(WIRE);
    if (!m) return null;
    const name = m[1] || m[2];
    return name === "Associated Press" ? "AP" : name === "Agence France-Presse" ? "AFP" : name;
  }

  // About 100 m: plenty for a map pin.
  function round3(x) {
    return Math.round(x * 1000) / 1000;
  }

  function normalize(item) {
    let title = (item.title || "").replace(/\s+/g, " ").trim();
    let source = item.source || "Unknown";
    // Google News titles end in " - Outlet": count the outlet as the source.
    if (source === "Google News") {
      const m = title.match(/\s[-–—]\s([^-–—]{2,60})$/);
      if (m) { source = m[1].trim(); title = title.slice(0, m.index).trim(); }
    }
    return { ...item, title, source };
  }

  // One feed item -> a mention, or null when it isn't a strike report with a known place.
  function toMention(matcher, raw) {
    if (SKIP_CATEGORIES.has(raw.category)) return null;
    const t = Date.parse(raw.published);
    if (!Number.isFinite(t)) return null;
    const item = normalize(raw);
    const lang = langOf(item.title);
    if (lang !== "en") return toMentionI18n(matcher, item, t, lang);
    if (RETRO.test(item.title) || namesOtherMonth(item.title, t)) return null;
    // Headline only: summaries mention too much else (a surgery story is not a hospital strike).
    let hit = matchTarget(item.title);
    const kind = classify(item.title, item.category, hit && hit.key);
    if (!kind) return null;
    // Telegram summaries often carry ads, so only news summaries help find the place, and only when they
    // name a city or region: a country in a summary is often a ship's flag or a side note.
    // If the headline names a place but only as the actor ("Pakistan launches strikes"), don't go looking in
    // the summary: it would find the same actor's capital.
    let place = locate(matcher, item.title);
    if (!place && !item.social && !item.title.match(matcher.regex)) {
      const fromSummary = locate(matcher, item.summary || "");
      if (fromSummary && fromSummary.precision !== "country") place = fromSummary;
    }
    if (!place) return null;
    // Leave out place names that start with "Port" (Port Sudan, Port Said) so they don't read as a port.
    if (/^Port\b/.test(place.term)) hit = matchTarget(item.title.replace(place.term, ""));
    return {
      target: hit ? hit.key : null,
      // The words behind each decision, shown in the info card ("Why this is on the map").
      why: { type: kind.term, place: place.term, cue: place.cue, target: hit ? hit.term : null },
      // Wire agency the item credits, if any; the source itself when it is one.
      wire: wireOf(`${item.title} ${item.summary || ""}`),
      when: whenOf(item.title, new Date(t).toISOString(), "en"),
      lang: "en",
      id: item.id,
      published: new Date(t).toISOString(),
      title: item.title,
      url: item.url,
      source: item.source,
      social: !!item.social,
      type: kind.type,
      place: { name: place.display, country: place.country, lat: round3(place.lat), lng: round3(place.lng), precision: place.precision },
    };
  }

  // toMention for Arabic, Russian or Ukrainian items.
  function toMentionI18n(matcher, item, t, lang) {
    const text = normalizeI18n(item.title);
    const hit = matchTargetI18n(text, lang);
    const kind = classifyI18n(text, lang, item.category, hit && hit.key);
    if (!kind) return null;
    let place = locateI18n(matcher, text, lang);
    if (!place && !item.social && item.summary && langOf(item.summary) === lang) {
      const fromSummary = locateI18n(matcher, normalizeI18n(item.summary), lang);
      if (fromSummary && fromSummary.precision !== "country") place = fromSummary;
    }
    if (!place) return null;
    const published = new Date(t).toISOString();
    return {
      target: hit ? hit.key : null,
      why: { type: kind.term, place: place.term, cue: place.cue, target: hit ? hit.term : null },
      wire: wireOf(`${item.title} ${item.summary || ""}`),
      when: whenOf(text, published, lang),
      lang,
      id: item.id,
      published,
      title: item.title,
      url: item.url,
      source: item.source,
      social: !!item.social,
      type: kind.type,
      place: { name: place.display, country: place.country, lat: round3(place.lat), lng: round3(place.lng), precision: place.precision },
    };
  }

  return { RANK, RADIUS_KM, buildMatcher, locate, classify, detectTarget, wireOf, whenOf, langOf, toMention };
})();
