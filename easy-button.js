/* =====================================================================
   easy-button.js  -  "Build a semester draft" for the Westminster Standards Platform

   Plain JavaScript (no Babel needed). Load it with a normal <script src="easy-button.js">
   tag AFTER the React scripts and the standards-bank*.js files, and BEFORE the main
   text/babel script. It adds two things to window:

     window.EasyButton        React component shown on the Course Outline page
     window.EasyButtonLogic   pure helper functions (used for testing)

   What it does:
     1. Teacher picks how many units, presses the button.
     2. The page sends the course (plus any matching bank standards and the department
        portrait statements) to the Cloudflare Worker, mode "build_course".
     3. The Worker returns units with standards. They are shown in a REVIEW panel where the
        teacher can edit wording, rename units, move standards, and uncheck what they don't want.
     4. Only the checked standards are added to the course outline, as drafts marked
        "AI-suggested". Nothing is added until the teacher clicks "Add to outline".
   ===================================================================== */
(function () {
  "use strict";

  var h = React.createElement;
  var useState = React.useState;

  // One bank file per department; each sets a window variable with a matching "department".
  var BANK_VARS = ["STANDARDS_BANK", "STANDARDS_BANK_ENGLISH", "STANDARDS_BANK_HISTORY", "STANDARDS_BANK_SCIENCE"];
  var MAX_SOURCES = 300;
  var MIN_UNITS = 3;
  var MAX_UNITS = 8;
  var DEFAULT_UNITS = 6;
  var MIN_ABOUT = 15;        // a unit description shorter than this is too thin to write from
  var MAX_ABOUT = 400;
  var MAX_NAME = 80;
  var MIN_PASTE = 40;
  var MAX_PASTE = 24000;     // about 8 pages; the Worker enforces the same limit
  var TOP_RANKED = 200;      // most relevant bank standards sent first when the bank is larger than MAX_SOURCES
  var MIDDLE_SCHOOL_GRADES = [7, 8];
  var HIGH_SCHOOL_GRADES = [9, 10, 11, 12];

  /* ---------------------------------------------------------------
     Pure helpers
     --------------------------------------------------------------- */
  function gradesFor(course) {
    if (!course) return HIGH_SCHOOL_GRADES;
    if (course.school === "Middle School") return MIDDLE_SCHOOL_GRADES;
    return course.grades && course.grades.length ? course.grades : HIGH_SCHOOL_GRADES;
  }

  function gradeLabelFor(course) {
    var g = gradesFor(course);
    if (!course || !course.grades || !course.grades.length) {
      return course && course.school === "Middle School" ? "Grades 7-8" : "Upper School (grade not set)";
    }
    return g.length === 1 ? "Grade " + g[0] : "Grades " + g[0] + "-" + g[g.length - 1];
  }

  // "9-12" -> [9, 12]; "7" -> [7, 7]; "K-12" -> [0, 12]; no grade info -> null (treated as "applies")
  function parseGradeRange(text) {
    var tokens = String(text || "").toUpperCase().match(/PK|K|\d+/g);
    if (!tokens) return null;
    var nums = tokens.map(function (t) { return t === "PK" || t === "K" ? 0 : parseInt(t, 10); });
    return [Math.min.apply(null, nums), Math.max.apply(null, nums)];
  }

  function gradesOverlap(rowGrades, courseGrades) {
    var range = parseGradeRange(rowGrades);
    if (!range) return true;
    return courseGrades.some(function (g) { return g >= range[0] && g <= range[1]; });
  }

  function findBank(department) {
    for (var i = 0; i < BANK_VARS.length; i++) {
      var b = window[BANK_VARS[i]];
      if (b && b.department === department && Array.isArray(b.rows)) return b;
    }
    return null;
  }

  // Words from a teacher's own unit descriptions, used to put the most relevant published standards first.
  var STOP = {};
  ("about students student will learn learning their this that with from have they them into over unit units course class " +
   "work using used make makes what when where which while also more most other such than then these those your ours " +
   "includes include including covers cover topics topic around between through during within without each both many some " +
   "real world situations skills understand understanding").split(" ").forEach(function (w) { STOP[w] = true; });
  function stem(w) {
    var t = w;
    if (t.length > 5) t = t.replace(/(ing|ed|es|s|ly)$/, "");
    if (t.length > 4) t = t.replace(/e$/, "");
    return t;
  }
  function hintWords(text) {
    var seen = {}, out = [];
    String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").forEach(function (w) {
      if (w.length < 4 || STOP[w]) return;
      var t = stem(w);
      if (!seen[t]) { seen[t] = true; out.push(t); }
    });
    return out;
  }
  function relevance(text, words) {
    var have = {}, n = 0;
    hintWords(text).forEach(function (t) { have[t] = true; });
    words.forEach(function (t) { if (have[t]) n++; });
    return n;
  }

  // Picks bank standards that fit this course's grade range. If there are more than the limit, it sends the
  // ones closest to the teacher's own words first (when there are any), then samples evenly across the rest
  // so every area is still represented.
  function collectSources(department, course, hint) {
    var bank = findBank(department);
    if (!bank) return { rows: [], total: 0, sampled: false, bankFound: false, ranked: 0, setNames: [] };
    var grades = gradesFor(course);
    var eligible = bank.rows.filter(function (r) {
      var code = String(r[1] || "");
      var text = String(r[3] || "");
      // Cluster headings (Math codes ending .A, .B). Banks whose codes legitimately end in a letter
      // (English, History) set hideClusters: false, and nothing is hidden for them.
      if (bank.hideClusters !== false && /\.[A-Z]$/.test(code)) return false;
      if (text.length < 25) return false;             // headings and fragments
      return gradesOverlap(r[2], grades);
    });
    var picked = eligible;
    var sampled = false, ranked = 0;
    if (eligible.length > MAX_SOURCES) {
      sampled = true;
      var words = hintWords(hint);
      var top = [], rest = eligible;
      if (words.length) {
        var scored = eligible.map(function (r, i) { return { r: r, i: i, s: relevance(String(r[3] || ""), words) }; });
        top = scored.filter(function (x) { return x.s > 0; })
          .sort(function (a, b) { return b.s - a.s || a.i - b.i; }).slice(0, TOP_RANKED);
        var inTop = {};
        top.forEach(function (x) { inTop[x.i] = true; });
        rest = scored.filter(function (x) { return !inTop[x.i]; }).map(function (x) { return x.r; });
        top = top.map(function (x) { return x.r; });
        ranked = top.length;
      }
      var room = MAX_SOURCES - top.length, step = rest.length / room, spread = [];
      for (var i = 0; i < room; i++) spread.push(rest[Math.floor(i * step)]);
      picked = top.concat(spread);
    }
    var names = bank.sources || {};
    var setNames = [];
    eligible.forEach(function (r) { var n = names[r[0]] || r[0]; if (setNames.indexOf(n) === -1) setNames.push(n); });
    return {
      rows: picked.map(function (r) { return { code: r[1], text: r[3], set: names[r[0]] || r[0] }; }),
      total: eligible.length,
      sampled: sampled,
      ranked: ranked,
      setNames: setNames,
      bankFound: true
    };
  }

  /* ---------------------------------------------------------------
     "Check my standards": which published standards belong to a course
     --------------------------------------------------------------- */
  // A code segment such as PS2 in "HS-PS2-1" or "9-12.PS2.A.1", or W in "W.9-10.2".
  function seg(letters) { return new RegExp("(^|[.\\-])(" + letters + ")(?=[.\\-]|$)"); }
  var SCI_LITERACY = /^(RST|WHST)/;
  // The first profile that fits a course wins.
  //   pool   codes that belong to THIS course. They are sent marked CORE, so gaps are chosen only from them.
  //   extra  related codes sent only so Claude can note matches (science literacy), never listed as gaps.
  //   none   nothing in the banks fits the course: Claude can check only within the teacher's own standards.
  //   bank   borrow another department's bank. Pathways uses English now; when Pathways math courses are
  //          added, give them a line here with bank: "Mathematics" and the matching pool.
  //   anyGrade  the codes are already course-specific, so the grade filter is skipped (Middle School Algebra 1
  //          has no grades set but should still be compared with Algebra 1).
  // If a pool finds fewer than 5 standards, the course falls back to every bank standard for its grades.
  var COURSE_PROFILES = [
    { dept: "Mathematics", name: /calculus/i, not: /pre-?calc/i, none: "The standards bank has no Calculus standards yet, so Claude can check only within your own standards." },
    { dept: "Mathematics", name: /pre-?calc/i, anyGrade: true, pool: /^(HSF-TF|HSF-BF\.B|HSF-IF\.C\.7\.[de]|HSN-CN|HSN-VM|HSN-RN|HSA-APR|HSG-SRT\.D|HSG-GPE)/ },
    { dept: "Mathematics", name: /statistic/i, anyGrade: true, pool: /^(HSS-|A1\.DS)/ },
    { dept: "Mathematics", name: /geometry/i, anyGrade: true, pool: /^(G\.|HSG-)/ },
    { dept: "Mathematics", name: /algebra 2/i, anyGrade: true, pool: /^(A2\.|HSA-|HSF-|HSN-CN|HSN-RN|HSS-IC)/ },
    { dept: "Mathematics", name: /algebra 1/i, anyGrade: true, pool: /^(A1\.|HSA-SSE|HSA-APR\.A|HSA-CED|HSA-REI|HSF-IF|HSF-BF|HSF-LE|HSN-RN|HSN-Q|HSS-ID)/ },
    { dept: "Science", name: /psychology/i, none: "The standards bank has no psychology standards, so Claude can check only within your own standards." },
    { dept: "Science", name: /anatomy/i, pool: seg("LS1"), extra: SCI_LITERACY },
    { dept: "Science", name: /environmental/i, pool: seg("ESS2|ESS3|LS2|LS4"), extra: SCI_LITERACY },
    { dept: "Science", name: /physics/i, pool: seg("PS2|PS3|PS4"), extra: SCI_LITERACY },
    { dept: "Science", name: /chemistry/i, pool: seg("PS1|PS3"), extra: SCI_LITERACY },
    { dept: "Science", name: /biology|life science/i, pool: seg("LS1|LS2|LS3|LS4"), extra: SCI_LITERACY },
    { dept: "Science", name: /physical science/i, pool: seg("PS1|PS2|PS3|PS4"), extra: SCI_LITERACY },
    { dept: "Pathways", name: /study lab/i, none: "Study Labs have no published standards to compare with, so Claude can check only within your own standards." },
    { dept: "Pathways", name: /expository writing/i, bank: "English", pool: seg("W|L") },
    { dept: "Pathways", name: /literature|western civ/i, bank: "English", pool: seg("RL|RI|R|W") },
    { dept: "Pathways", name: /./, bank: "English" }
  ];
  var MIN_POOL = 5;

  function compareProfile(course) {
    if (!course) return null;
    for (var i = 0; i < COURSE_PROFILES.length; i++) {
      var p = COURSE_PROFILES[i];
      if (p.dept === course.department && p.name.test(course.name) && !(p.not && p.not.test(course.name))) return p;
    }
    return null;
  }

  // Everything this course could be compared with, before the teacher's checkboxes are applied.
  function compareSets(course) {
    var p = compareProfile(course);
    if (p && p.none) return { available: false, why: p.none, rows: [] };
    var bank = findBank(p && p.bank ? p.bank : course && course.department);
    if (!bank) return { available: false, why: "No published standards are loaded for this department yet, so Claude can check only within your own standards.", rows: [] };
    var names = bank.sources || {};
    var grades = gradesFor(course);
    var usable = bank.rows.filter(function (r) {
      var code = String(r[1] || "");
      if (bank.hideClusters !== false && /\.[A-Z]$/.test(code)) return false;
      return String(r[3] || "").length >= 25;
    });
    var inGrade = function (r) { return gradesOverlap(r[2], grades); };
    var mk = function (core) {
      return function (r) {
        var setName = names[r[0]] || r[0];
        return { code: r[1], text: r[3], set: setName, core: core, mo: r[0] === "MO" || /missouri/i.test(setName) };
      };
    };
    var rows = [], coreOn = false;
    if (p && p.pool) {
      var pool = usable.filter(function (r) { return p.pool.test(String(r[1])) && (p.anyGrade || inGrade(r)); });
      if (pool.length >= MIN_POOL) {
        coreOn = true;
        rows = pool.map(mk(true));
        if (p.extra) rows = rows.concat(usable.filter(function (r) {
          return p.extra.test(String(r[1])) && inGrade(r) && !p.pool.test(String(r[1]));
        }).map(mk(false)));
      }
    }
    if (!coreOn) rows = usable.filter(inGrade).map(mk(false));
    if (rows.length === 0) return { available: false, why: "No published standards for this grade are loaded yet, so Claude can check only within your own standards.", rows: [] };
    var moName = "", national = [];
    rows.forEach(function (r) {
      if (r.mo) moName = moName || r.set;
      else if (national.indexOf(r.set) === -1) national.push(r.set);
    });
    return { available: true, why: "", rows: rows, coreOn: coreOn, hasMO: !!moName, moName: moName,
             hasNational: national.length > 0, nationalNames: national };
  }

  // The rows actually sent, for the sets the teacher ticked. Course standards (core) go first; if there are
  // more than the Worker takes, the ones closest to the teacher's own words go first, then a spread of the rest.
  function pickCompareSources(info, wantMO, wantNational, hint) {
    var rows = info.rows.filter(function (r) { return r.mo ? wantMO : wantNational; });
    var core = rows.filter(function (r) { return r.core; }), extra = rows.filter(function (r) { return !r.core; });
    var ordered;
    if (core.length > 0) ordered = capRows(core, hint, MAX_SOURCES).concat(extra);
    else ordered = capRows(extra, hint, MAX_SOURCES);
    return ordered.slice(0, MAX_SOURCES).map(function (r) { return { code: r.code, text: r.text, set: r.set, core: r.core }; });
  }
  function capRows(rows, hint, max) {
    if (rows.length <= max) return rows;
    var words = hintWords(hint);
    var scored = rows.map(function (r, i) { return { r: r, i: i, s: words.length ? relevance(r.text, words) : 0 }; });
    var top = scored.filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s || a.i - b.i; }).slice(0, Math.min(TOP_RANKED, max));
    var inTop = {};
    top.forEach(function (x) { inTop[x.i] = true; });
    var rest = scored.filter(function (x) { return !inTop[x.i]; });
    var room = max - top.length, step = rest.length / Math.max(1, room), spread = [];
    for (var i = 0; i < room && i < rest.length; i++) spread.push(rest[Math.floor(i * step)]);
    return top.concat(spread).sort(function (a, b) { return a.i - b.i; }).map(function (x) { return x.r; });
  }

  // Which checks will really run, given what is available for the course.
  function checksToRun(info, v) {
    var compare = !!(info.available && ((info.hasMO && v.mo) || (info.hasNational && v.national)));
    var internal = !!v.internal;
    return { compare: compare, internal: internal, suggest: !!v.suggest && (compare || internal), any: compare || internal };
  }

  // The teacher's standards as sent to the Worker: only checked ones with wording.
  function standardsForCheck(draft) {
    var units = [], list = [];
    draft.units.forEach(function (u) {
      var n = String(u.name || "").trim() || "Unnamed unit";
      units.push(n);
      u.standards.forEach(function (s) {
        if (s.include && String(s.description || "").trim()) list.push({ id: s.uid, text: String(s.description).trim(), unit: n });
      });
    });
    return { units: units, standards: list.slice(0, 200) };
  }

  // Puts Claude's matches on each standard, so the review shows them and the outline keeps a note of them.
  function applyMatches(draft, matches, lookup) {
    return Object.assign({}, draft, {
      units: draft.units.map(function (u) {
        return Object.assign({}, u, {
          standards: u.standards.map(function (s) {
            if (!s.teacher) return s;
            var codes = (matches && matches[s.uid]) || [];
            return Object.assign({}, s, {
              matched: codes.filter(function (c) { return lookup[c]; }).map(function (c) { return { code: c, set: lookup[c].set, text: lookup[c].text }; })
            });
          })
        });
      })
    });
  }

  function suggestionNote(sg, lookup) {
    var src = sg.fills && sg.fills !== "internal" ? lookup[sg.fills] : null;
    return src ? "AI-drafted to fill a gap: " + src.set + " " + sg.fills
               : "AI-drafted to fill a gap Claude found in this course's own standards";
  }

  function addToUnit(draft, unitIndex, standard) {
    return Object.assign({}, draft, {
      units: draft.units.map(function (u, i) {
        return i === unitIndex ? Object.assign({}, u, { standards: u.standards.concat([standard]) }) : u;
      })
    });
  }

  // The paste box. There is deliberately no maxLength on the box itself, because that would silently cut off
  // what a teacher pasted; instead they are told it is too long.
  function validatePaste(text) {
    var t = String(text || "").trim();
    if (t.length === 0) return { ok: false, msg: "Paste your standards into the box first." };
    if (t.length < MIN_PASTE) return { ok: false, msg: "That is too short to be a list of standards. Paste the standards themselves." };
    if (t.length > MAX_PASTE) return { ok: false, msg: "That is longer than the tool can read at once (about 8 pages). Paste half of it, then the other half." };
    return { ok: true, msg: "" };
  }
  function pageEstimate(n) { return Math.max(1, Math.round(n / 3000)); }

  // Checks the unit form. Returns the cleaned rows to send, and a message for each problem field.
  function validateUnitRows(rows) {
    var errors = [], clean = [];
    rows.forEach(function (r) {
      var name = String((r && r.name) || "").replace(/\s+/g, " ").trim();
      var about = String((r && r.about) || "").replace(/\s+/g, " ").trim();
      var e = {};
      if (name.length < 2) e.name = "Give this unit a name.";
      if (about.length === 0) e.about = "Say a little about what this unit covers.";
      else if (about.length < MIN_ABOUT) e.about = "Add a little more, such as the topics and what students will do or make.";
      else if (about.length > MAX_ABOUT) e.about = "Please shorten this to " + MAX_ABOUT + " characters or fewer.";
      errors.push(e);
      clean.push({ name: name.slice(0, MAX_NAME), about: about });
    });
    var ok = rows.length > 0 && rows.length <= MAX_UNITS && errors.every(function (e) { return !e.name && !e.about; });
    return { ok: ok, errors: errors, clean: clean };
  }

  function portraitFor(portrait) {
    if (!portrait || !Array.isArray(portrait.standards)) return [];
    return portrait.standards
      // unfinished prompts ("Express their Love of the Lord...") are not statements anyone can align to
      .filter(function (s) { return s && s.code && s.description && String(s.description).trim() && !/\.\.\.|\u2026/.test(s.description); })
      .map(function (s) { return { code: s.code, description: s.description }; });
  }

  var uidCounter = 0;
  function nextUid() { uidCounter += 1; return "eb" + uidCounter; }

  // Turns the Worker's response into editable review state.
  function toDraft(data) {
    return {
      attribution: data.attribution || "",
      // What happened to a pasted document: lines left out, items discarded, and how many got "Students will".
      report: { imported: data.mode === "import", skipped: data.skipped || [], dropped: data.dropped || 0,
                adjusted: data.adjusted || 0, unadjusted: data.unadjusted || 0 },
      units: (data.units || []).map(function (u) {
        return {
          uid: nextUid(),
          name: u.name,
          standards: (u.standards || []).map(function (s) {
            return {
              uid: nextUid(), include: true, category: s.category, description: s.description,
              sourceNote: s.sourceNote, alignsTo: s.alignsTo || [],
              original: s.original || "", adjusted: !!s.adjusted, teacher: s.source === "Teacher-written"
            };
          })
        };
      })
    };
  }

  // What gets added to the outline: only checked standards, only units that still have any.
  function selectedUnits(draft) {
    return draft.units.map(function (u) {
      var name = String(u.name || "").trim() || "Unnamed unit";
      return {
        name: name,
        standards: u.standards
          .filter(function (s) { return s.include && String(s.description || "").trim(); })
          .map(function (s) {
            var note = s.sourceNote || "";
            if (s.matched && s.matched.length) note += " Claude matched it to " + s.matched.map(function (m) { return m.code; }).join(", ") + ".";
            return { category: String(s.category || "").trim() || "General", description: String(s.description).trim(), sourceNote: note, alignsTo: s.alignsTo, teacherWritten: !!s.teacher };
          })
      };
    }).filter(function (u) { return u.standards.length > 0; });
  }

  function countSelected(draft) {
    return draft.units.reduce(function (n, u) {
      return n + u.standards.filter(function (s) { return s.include; }).length;
    }, 0);
  }

  function moveStandard(draft, fromUnit, standardUid, toUnit) {
    if (fromUnit === toUnit) return draft;
    var moving = null;
    var units = draft.units.map(function (u, i) {
      if (i !== fromUnit) return u;
      return Object.assign({}, u, {
        standards: u.standards.filter(function (s) {
          if (s.uid === standardUid) { moving = s; return false; }
          return true;
        })
      });
    });
    if (!moving) return draft;
    units = units.map(function (u, i) {
      return i === toUnit ? Object.assign({}, u, { standards: u.standards.concat([moving]) }) : u;
    });
    return Object.assign({}, draft, { units: units });
  }

  function updateStandard(draft, unitIndex, standardUid, patch) {
    return Object.assign({}, draft, {
      units: draft.units.map(function (u, i) {
        if (i !== unitIndex) return u;
        return Object.assign({}, u, {
          standards: u.standards.map(function (s) { return s.uid === standardUid ? Object.assign({}, s, patch) : s; })
        });
      })
    });
  }

  function renameUnit(draft, unitIndex, name) {
    return Object.assign({}, draft, {
      units: draft.units.map(function (u, i) { return i === unitIndex ? Object.assign({}, u, { name: name }) : u; })
    });
  }

  /* ---------------------------------------------------------------
     Components (all defined at top level so inputs keep focus)
     --------------------------------------------------------------- */
  function StandardRow(props) {
    var s = props.standard;
    var units = props.unitNames;
    var id = "eb-" + s.uid;
    var isAi = /^AI-drafted/.test(s.sourceNote || "");
    return h("div", {
      className: "border-l-4 pl-3 py-2 bg-white " + (s.include ? "" : "opacity-50"),
      style: { borderLeftColor: s.include ? "#2A8FBA" : "#CFE0F1" }
    },
      h("div", { className: "flex items-start gap-3" },
        h("input", {
          type: "checkbox", checked: s.include, id: id + "-keep", className: "mt-1.5 h-4 w-4",
          "aria-label": "Keep this standard",
          onChange: function (e) { props.onChange({ include: e.target.checked }); }
        }),
        h("div", { className: "flex-1 min-w-0" },
          h("div", { className: "flex items-center gap-2 flex-wrap text-xs mb-1" },
            h("span", { className: "font-semibold text-gray-700" }, s.category),
            h("span", { className: isAi ? "rounded-full px-2 py-0.5 bg-purple-100 text-purple-800 font-semibold" : "text-blue-700" }, s.sourceNote),
            (s.alignsTo || []).map(function (c) {
              return h("span", { key: c, className: "px-2 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200" }, c);
            })
          ),
          h("textarea", {
            value: s.description, rows: 2, id: id + "-text", "aria-label": "Standard wording",
            className: "w-full px-3 py-2 border border-gray-300 rounded text-sm",
            onChange: function (e) { props.onChange({ description: e.target.value }); }
          }),
          s.adjusted && s.original && h("div", { className: "mt-1 text-xs text-gray-600" },
            h("span", { className: "font-semibold" }, "Your original: "), "\u201C" + s.original + "\u201D",
            s.description !== s.original && h("button", {
              type: "button", className: "ml-2 text-blue-700 hover:underline font-medium",
              onClick: function () {
                props.onChange({ description: s.original, adjusted: false, sourceNote: String(s.sourceNote || "").replace(" Opening words added by Claude.", "") });
              }
            }, "Use my original wording")),
          s.matched && s.matched.length > 0 && h("div", { className: "mt-1 flex items-center gap-1 flex-wrap text-xs" },
            h("span", { className: "font-semibold text-green-800" }, "Covers:"),
            s.matched.map(function (m) {
              return h("span", { key: m.code, title: m.set + ": " + m.text, className: "px-2 py-0.5 rounded bg-green-50 text-green-900 border border-green-300" }, m.code);
            })),
          s.matched && s.matched.length === 0 && h("div", { className: "mt-1 text-xs text-gray-500" },
            "No close match among the published standards Claude was given."),
          h("div", { className: "mt-1 flex items-center gap-2" },
            h("label", { htmlFor: id + "-unit", className: "text-xs text-gray-500" }, "Move to"),
            h("select", {
              id: id + "-unit", value: props.unitIndex, className: "px-2 py-1 border border-gray-300 rounded text-xs",
              onChange: function (e) { props.onMove(parseInt(e.target.value, 10)); }
            }, units.map(function (n, i) { return h("option", { key: i, value: i }, n || "Unnamed unit"); }))
          )
        )
      )
    );
  }

  function UnitBlock(props) {
    var u = props.unit;
    var names = props.unitNames;
    return h("div", { className: "space-y-2" },
      h("input", {
        type: "text", value: u.name, "aria-label": "Unit name",
        className: "w-full px-3 py-2 border border-gray-300 rounded-lg font-semibold text-gray-800",
        onChange: function (e) { props.onRename(e.target.value); }
      }),
      u.standards.length === 0
        ? h("p", { className: "text-sm text-gray-500 italic" }, "No standards in this unit. Move one here, or leave it empty and it will be skipped.")
        : u.standards.map(function (s) {
            return h(StandardRow, {
              key: s.uid, standard: s, unitIndex: props.index, unitNames: names,
              onChange: function (patch) { props.onStandardChange(s.uid, patch); },
              onMove: function (toUnit) { props.onStandardMove(s.uid, toUnit); }
            });
          })
    );
  }

  function Tick(props) {
    return h("label", { className: "flex items-start gap-2 text-sm " + (props.disabled ? "text-gray-500" : "text-gray-800") },
      h("input", { type: "checkbox", checked: !!props.checked, disabled: props.disabled,
                   onChange: function (e) { props.onChange(e.target.checked); }, className: "mt-1 h-4 w-4" }),
      h("span", null, h("span", { className: "font-semibold" }, props.title), h("span", { className: "block text-xs text-gray-600" }, props.help)));
  }

  // The "Also check my standards" checkboxes, used on the paste screen and again in the review.
  function CheckOptions(props) {
    var info = props.info, v = props.value, off = props.disabled;
    var set = function (k) { return function (val) { var p = {}; p[k] = val; props.onChange(Object.assign({}, v, p)); }; };
    var run = checksToRun(info, v);
    return h("fieldset", { className: "bg-white border border-purple-200 rounded-lg p-3 space-y-2" },
      h("legend", { className: "px-1 text-sm font-semibold text-gray-900" }, props.legend || "Also check my standards"),
      h("p", { className: "text-xs text-gray-600" }, "After sorting, Claude reads your standards and reports what it finds. It never changes your wording, and nothing is added unless you add it."),
      info.available && info.hasMO && h(Tick, { checked: v.mo, disabled: off, onChange: set("mo"),
        title: "Compare with the " + info.moName + ".",
        help: "Shows which state standards each of yours covers, and which ones for this course none of yours cover." }),
      info.available && info.hasNational && h(Tick, { checked: v.national, disabled: off, onChange: set("national"),
        title: "Compare with national standards (" + info.nationalNames.join(", ") + ").",
        help: "The same comparison against the national standards." }),
      !info.available && h("p", { className: "text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2" }, info.why),
      h(Tick, { checked: v.internal, disabled: off, onChange: set("internal"),
        title: "Look for gaps within my own standards.",
        help: "Units with very few standards, standards that repeat each other, topics this course usually has that none of your units cover, and units where nothing asks students to apply, analyze or create." }),
      h(Tick, { checked: v.suggest && (run.compare || run.internal), disabled: off || !(run.compare || run.internal), onChange: set("suggest"),
        title: "Suggest standards to fill the gaps.",
        help: run.compare || run.internal ? "Claude drafts a few new standards, labeled as its own. You choose which to add, and to which unit." : "Choose one of the checks above first." }),
      props.children);
  }

  var FINDING_LABELS = { thin_unit: "Thin unit", overlap: "Overlap", missing_topic: "Missing topic", low_rigor: "Low rigor", unclear: "Unclear", other: "Note" };

  function shortText(t) {
    var w = String(t || "").split(/\s+/);
    return w.length > 12 ? w.slice(0, 12).join(" ") + "…" : w.join(" ");
  }

  // What Claude found. Matches are shown on each standard; this shows the totals, gaps, findings and suggestions.
  function CompareReport(props) {
    var c = props.check, r = c.result, ran = r.checked || {};
    var byUid = {};
    props.draft.units.forEach(function (u) { u.standards.forEach(function (s) { byUid[s.uid] = s; }); });
    var unitNames = props.draft.units.map(function (u) { return u.name || "Unnamed unit"; });
    var matchedCodes = {};
    Object.keys(r.matches || {}).forEach(function (id) { (r.matches[id] || []).forEach(function (code) { matchedCodes[code] = true; }); });
    var coreMatched = Object.keys(matchedCodes).filter(function (code) { return c.lookup[code] && c.lookup[code].core; }).length;
    var withMatch = Object.keys(r.matches || {}).length;

    var gapGroups = {};
    (r.gaps || []).forEach(function (g) {
      var src = c.lookup[g.code];
      if (!src) return;
      (gapGroups[src.set] = gapGroups[src.set] || []).push({ code: g.code, text: src.text, why: g.why });
    });

    var heading = function (t) { return h("h4", { className: "font-semibold text-gray-900" }, t); };
    return h("div", { className: "space-y-4" },
      ran.compare && h("div", { className: "space-y-2" },
        heading("Compared with published standards"),
        h("p", { className: "text-sm text-gray-700" },
          c.coreCount > 0
            ? "Claude compared your " + c.checkedCount + " standards with " + c.coreCount + " published standards for " + props.courseName + ". By Claude's reading, yours cover " + coreMatched + " of them. "
            : "Claude compared your " + c.checkedCount + " standards with " + c.sentCount + " published standards for this grade level. ",
          withMatch + " of your standards " + (withMatch === 1 ? "matches" : "match") + " at least one. Each match is shown under the standard as “Covers.”"),
        Object.keys(gapGroups).length === 0
          ? h("p", { className: "text-sm text-gray-700" }, "Claude didn't find any important published standards that yours leave out.")
          : h("div", { className: "space-y-3" },
              h("p", { className: "text-sm font-semibold text-gray-800" }, "Published standards none of yours cover (" + (r.gaps || []).length + ")"),
              Object.keys(gapGroups).map(function (set) {
                return h("div", { key: set, className: "space-y-1" },
                  h("div", { className: "text-xs font-semibold text-gray-600 uppercase tracking-wide" }, set),
                  h("ul", { className: "space-y-2" }, gapGroups[set].map(function (g) {
                    return h("li", { key: g.code, className: "text-sm bg-white border border-yellow-300 rounded p-2" },
                      h("span", { className: "font-semibold text-gray-900" }, g.code + " "), h("span", { className: "text-gray-800" }, g.text),
                      g.why && h("div", { className: "text-xs text-gray-600 mt-1" }, "Why it matters: " + g.why));
                  })));
              }))),
      ran.internal && h("div", { className: "space-y-2" },
        heading("Inside your own standards"),
        (r.findings || []).length === 0
          ? h("p", { className: "text-sm text-gray-700" }, "Claude didn't find gaps or repeats inside your standards.")
          : h("ul", { className: "space-y-2" }, r.findings.map(function (f, i) {
              return h("li", { key: i, className: "text-sm bg-white border border-yellow-300 rounded p-2" },
                h("span", { className: "inline-block mr-2 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-900 text-xs font-semibold" }, FINDING_LABELS[f.type] || "Note"),
                f.unit && h("span", { className: "font-semibold text-gray-800 mr-1" }, f.unit + ":"),
                h("span", { className: "text-gray-800" }, f.note),
                f.ids && f.ids.length > 0 && h("ul", { className: "mt-1 pl-4 list-disc text-xs text-gray-600" }, f.ids.map(function (id) {
                  return byUid[id] ? h("li", { key: id }, "“" + shortText(byUid[id].description) + "”") : null;
                })));
            }))),
      ran.suggest && h("div", { className: "space-y-2" },
        heading("Claude's suggested standards"),
        (r.suggestions || []).length === 0
          ? h("p", { className: "text-sm text-gray-700" }, "Claude had no standards to suggest.")
          : h("div", { className: "space-y-2" },
              h("p", { className: "text-xs text-gray-600" }, "These are Claude's drafts, not yours. Add the ones you want; each one lands in the unit you pick, marked AI-drafted, and you can edit or uncheck it there."),
              r.suggestions.map(function (sg, i) {
                var added = c.added[i];
                var src = sg.fills && sg.fills !== "internal" ? c.lookup[sg.fills] : null;
                var pick = c.picks[i] != null ? c.picks[i] : Math.max(0, unitNames.indexOf(sg.unit));
                return h("div", { key: i, className: "bg-white border border-purple-300 rounded p-3 space-y-1" },
                  h("div", { className: "flex items-center gap-2 flex-wrap text-xs" },
                    h("span", { className: "rounded-full px-2 py-0.5 bg-purple-100 text-purple-800 font-semibold" }, "Claude's suggestion"),
                    h("span", { className: "font-semibold text-gray-700" }, sg.category),
                    h("span", { className: "text-gray-600" }, src ? "Fills: " + sg.fills + " (" + src.set + ")" : "Fills: a gap inside your own standards")),
                  h("p", { className: "text-sm text-gray-900" }, sg.description),
                  sg.why && h("p", { className: "text-xs text-gray-600" }, sg.why),
                  added != null
                    ? h("p", { role: "status", className: "text-xs text-green-800 font-semibold" }, "Added to " + (unitNames[added] || "the unit") + ". Uncheck it there to leave it out.")
                    : h("div", { className: "flex items-center gap-2 flex-wrap pt-1" },
                        h("label", { htmlFor: "eb-sg-" + i, className: "text-xs text-gray-600" }, "Add to"),
                        h("select", { id: "eb-sg-" + i, value: pick, className: "px-2 py-1 border border-gray-300 rounded text-xs",
                                      onChange: function (e) { props.onPick(i, parseInt(e.target.value, 10)); } },
                          unitNames.map(function (n, j) { return h("option", { key: j, value: j }, n); })),
                        h("button", { type: "button", onClick: function () { props.onAdd(i, pick); },
                                      className: "px-3 py-1 bg-purple-700 text-white rounded text-xs font-semibold hover:bg-purple-800" }, "Add this standard")));
              }))),
      h("p", { className: "text-xs text-gray-500" }, "This is Claude's reading, not an official alignment. Check anything important before you rely on it."));
  }

  function EasyButton(props) {
    var course = props.course;
    var department = course ? course.department : "";
    var _unitCount = useState(DEFAULT_UNITS), unitCount = _unitCount[0], setUnitCount = _unitCount[1];
    var _phase = useState("idle"), phase = _phase[0], setPhase = _phase[1];
    var _error = useState(""), error = _error[0], setError = _error[1];
    var _draft = useState(null), draft = _draft[0], setDraft = _draft[1];
    var _info = useState(null), info = _info[0], setInfo = _info[1];
    var _done = useState(""), doneMsg = _done[0], setDoneMsg = _done[1];
    var _mode = useState("auto"), mode = _mode[0], setMode = _mode[1];            // "auto" (Claude plans) or "units" (teacher describes units)
    var _built = useState("auto"), builtMode = _built[0], setBuiltMode = _built[1];
    var _rows = useState([{ name: "", about: "" }]), rows = _rows[0], setRows = _rows[1];
    var _show = useState(false), showErrors = _show[0], setShowErrors = _show[1];
    var _paste = useState(""), pasteText = _paste[0], setPasteText = _paste[1];
    var _will = useState(false), addWill = _will[0], setAddWill = _will[1];        // opt in: add "Students will" to pasted standards
    var _align = useState(false), suggestAlign = _align[0], setSuggestAlign = _align[1];   // opt in: suggest Portrait alignment

    var _checks = useState({ mo: false, national: false, internal: false, suggest: false }), checks = _checks[0], setChecks = _checks[1];
    var _cphase = useState("idle"), checkPhase = _cphase[0], setCheckPhase = _cphase[1];
    var _cerr = useState(""), checkError = _cerr[0], setCheckError = _cerr[1];
    var _submit = useState(true), submitNow = _submit[0], setSubmitNow = _submit[1];   // send kept standards to the chair now
    var _report = useState(null), report = _report[0], setCheck = _report[1];   // what Claude found ("check" is the unit form)

    var existing = props.existingCount || 0;
    var bankInfo = collectSources(department, course);
    var compareInfo = compareSets(course);

    // Sends the sorted standards to the Worker for the checks the teacher chose.
    var runCheck = function (d) {
      var run = checksToRun(compareInfo, checks);
      if (!run.any) { setCheckError("Choose at least one check."); return; }
      var mine = standardsForCheck(d);
      if (mine.standards.length === 0) { setCheckError("Check at least one standard first."); return; }
      var hint = mine.standards.map(function (s) { return s.text; }).join(" ") + " " + course.name;
      var sources = run.compare ? pickCompareSources(compareInfo, checks.mo, checks.national, hint) : [];
      var lookup = {};
      sources.forEach(function (r) { lookup[r.code] = r; });
      setCheckError(""); setCheckPhase("loading");
      fetch(props.workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "compare_standards", department: department, course: course.name, gradeLabel: gradeLabelFor(course),
                               units: mine.units, standards: mine.standards, sources: sources,
                               checks: { compare: run.compare, internal: run.internal, suggest: run.suggest } })
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) { var err = new Error(data.error || "Request failed"); err.friendly = !!data.friendly; throw err; }
          return data;
        });
      }).then(function (data) {
        setDraft(function (prev) { return prev && data.checked && data.checked.compare ? applyMatches(prev, data.matches || {}, lookup) : prev; });
        setCheck({ result: data, lookup: lookup, sentCount: sources.length, checkedCount: mine.standards.length, added: {}, picks: {},
                   coreCount: sources.filter(function (r) { return r.core; }).length });
        setCheckPhase("done");
      }).catch(function (e) {
        setCheckError(e.friendly ? e.message : "The check didn't work: " + e.message + ". Your sorted standards are safe. Try the check again in a moment.");
        setCheckPhase("idle");
      });
    };

    var addSuggestion = function (i, unitIndex) {
      var sg = report.result.suggestions[i];
      setDraft(function (prev) {
        return addToUnit(prev, unitIndex, { uid: nextUid(), include: true, category: sg.category, description: sg.description,
          sourceNote: suggestionNote(sg, report.lookup), alignsTo: [], original: "", adjusted: false, teacher: false });
      });
      setCheck(function (prev) { var a = Object.assign({}, prev.added); a[i] = unitIndex; return Object.assign({}, prev, { added: a }); });
    };
    var pickSuggestionUnit = function (i, unitIndex) {
      setCheck(function (prev) { var p = Object.assign({}, prev.picks); p[i] = unitIndex; return Object.assign({}, prev, { picks: p }); });
    };
    var isFineArts = department === "Fine Arts";
    var loading = phase === "loading";

    var sourceLine;
    if (isFineArts) sourceLine = "Source: the National Core Arts Standards Anchor Standards. Anything else will be marked AI-drafted.";
    else if (bankInfo.bankFound) sourceLine = "Source: " + bankInfo.total + " published standards that fit this grade range" + (bankInfo.setNames.length ? " (" + bankInfo.setNames.join(", ") + ")" : "") + ". Anything the bank doesn't cover will be marked AI-drafted.";
    else sourceLine = "No published standards are loaded for this department yet, so every standard will be marked AI-drafted.";

    // ---- the unit form ----
    var setRow = function (i, patch) { setRows(rows.map(function (r, j) { return j === i ? Object.assign({}, r, patch) : r; })); };
    var addRow = function () { if (rows.length < MAX_UNITS) setRows(rows.concat([{ name: "", about: "" }])); };
    var removeRow = function (i) { if (rows.length > 1) setRows(rows.filter(function (_, j) { return j !== i; })); };
    var check = validateUnitRows(rows);

    var build = function () {
      if (draft && !window.confirm("Start over? Your edits to the current draft will be lost.")) return;
      setError(""); setDoneMsg("");
      if (!props.workerUrl) { setError("The AI service isn't connected yet. Set WORKER_URL at the top of the script."); return; }

      var body, used;
      if (mode === "units") {
        if (!check.ok) { setShowErrors(true); setError("Each unit needs a name and a short description before Claude can write standards for it."); return; }
        var hint = check.clean.map(function (u) { return u.name + " " + u.about; }).join(" ") + " " + course.name;
        used = isFineArts ? { rows: [], total: 0, sampled: false, ranked: 0 } : collectSources(department, course, hint);
        body = { mode: "build_units", department: department, course: course.name, gradeLabel: gradeLabelFor(course),
                 units: check.clean, sources: used.rows, portrait: portraitFor(props.portrait) };
      } else if (mode === "paste") {
        var pv = validatePaste(pasteText);
        if (!pv.ok) { setShowErrors(true); setError(pv.msg); return; }
        used = { rows: [], total: 0, sampled: false, ranked: 0 };
        body = { mode: "import_standards", department: department, course: course.name, gradeLabel: gradeLabelFor(course),
                 text: pasteText, addStudentsWill: addWill, suggestAlignment: suggestAlign,
                 portrait: suggestAlign ? portraitFor(props.portrait) : [] };
      } else {
        used = bankInfo;
        body = { mode: "build_course", department: department, course: course.name, gradeLabel: gradeLabelFor(course),
                 unitCount: unitCount, sources: isFineArts ? [] : bankInfo.rows, portrait: portraitFor(props.portrait) };
      }
      var sentMode = mode;
      setPhase("loading");
      fetch(props.workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) { var err = new Error(data.error || "Request failed"); err.friendly = !!data.friendly; throw err; }
          return data;
        });
      }).then(function (data) {
        var fresh = toDraft(data);
        setDraft(fresh);
        setBuiltMode(sentMode);
        setInfo({ sampled: used.sampled, total: used.total, used: used.rows.length, ranked: used.ranked || 0 });
        setPhase("review");
        setCheck(null); setCheckError(""); setCheckPhase("idle");
        if (sentMode === "paste" && checksToRun(compareInfo, checks).any) runCheck(fresh);   // the checks chosen before sorting
      }).catch(function (e) {
        // a problem the teacher can fix (too long, nothing found) is shown as it is; anything else is a generic retry
        setError(e.friendly ? e.message : "The draft didn't work: " + e.message + ". Try again in a moment.");
        setPhase(draft ? "review" : "idle");
      });
    };

    var discard = function () { setDraft(null); setPhase("idle"); setError(""); setCheck(null); setCheckPhase("idle"); setCheckError(""); };

    var apply = function () {
      var units = selectedUnits(draft);
      var n = units.reduce(function (sum, u) { return sum + u.standards.length; }, 0);
      if (n === 0) { setError("Check at least one standard to add."); return; }
      props.onApply(units, draft.attribution, { submit: submitNow });
      var fromClaude = units.reduce(function (sum, u) { return sum + u.standards.filter(function (s) { return !s.teacherWritten; }).length; }, 0);
      setDoneMsg(builtMode === "paste"
        ? "Added " + n + " standards in " + units.length + " units" + (fromClaude
            ? ": " + (n - fromClaude) + " in your own words and " + fromClaude + " of Claude's suggestions, marked AI-suggested."
            : ", in your own words.") + " "
        : "Added " + n + " draft standards in " + units.length + " units. They are marked AI-suggested. ");
      setDoneMsg(function (m) {
        return m + (submitNow
          ? "They were sent for approval and now wait in the department chair's \u201CPending My Approval\u201D list."
          : "They are private drafts. To send them for approval later, open Browse Standards, choose this course, and click \u201CSubmit for approval\u201D on each one.");
      });
      setCheck(null); setCheckPhase("idle"); setCheckError("");
      if (builtMode === "units") { setRows([{ name: "", about: "" }]); setShowErrors(false); }
      if (builtMode === "paste") { setPasteText(""); setShowErrors(false); }
      setDraft(null); setPhase("idle"); setError("");
    };

    var title = h("h3", { className: "text-lg font-bold text-gray-900" }, "Build a semester draft");
    var reviewIntro = builtMode === "paste"
      ? "These are your own standards, sorted into units. Claude didn't write them. Check that each one landed in the right unit, move any that didn't, and only what you keep is added to the outline."
      : builtMode === "units"
      ? "These are your units, with standards Claude drafted for each one. You review the draft, edit or uncheck anything you don't want, and only what you keep is added to the outline."
      : "Claude drafts units and standards for " + course.name + ". You review the draft, edit or uncheck anything you don't want, and only what you keep is added to the outline.";
    var reviewSource = builtMode === "paste" ? "Your standards stay in your own words." : sourceLine;

    // ---- Review panel ----
    if (phase === "review" && draft) {
      var names = draft.units.map(function (u) { return u.name; });
      var selected = countSelected(draft);
      var total = draft.units.reduce(function (n, u) { return n + u.standards.length; }, 0);
      var empty = draft.units.filter(function (u) { return u.standards.length === 0; }).map(function (u) { return u.name; });
      var sampledLine = !info || !info.sampled ? null
        : info.ranked > 0 ? "The bank had " + info.total + " matching standards. The ones closest to your descriptions were sent first, plus a spread of the rest (" + info.used + " in all)."
        : "The bank had " + info.total + " matching standards, so a spread of " + info.used + " was used.";
      return h("section", { className: "no-print border-2 border-purple-300 bg-purple-50 rounded-lg p-5 space-y-5" },
        h("div", null, title,
          h("p", { className: "text-sm text-gray-700 mt-1" }, reviewIntro),
          h("p", { className: "text-xs text-gray-500 mt-1" }, reviewSource)),
        builtMode !== "paste" && sampledLine && h("p", { className: "text-xs text-gray-600" }, sampledLine),
        h("div", { className: "bg-white border border-purple-200 rounded p-3 text-sm text-gray-700" },
          (builtMode === "paste" ? "These are your own words. Read through them, then keep what you want. " : "These are AI-written drafts. Read each one before you keep it. ") +
          selected + " of " + total + " are checked."),
        builtMode === "paste" && draft.report && draft.report.adjusted > 0 && h("div", { role: "status", className: "p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded text-sm" },
          "Claude added \u201CStudents will\u201D to " + draft.report.adjusted + " standard" + (draft.report.adjusted === 1 ? "" : "s") + ". Your original wording is shown under each one, and you can switch back."),
        builtMode === "paste" && draft.report && draft.report.unadjusted > 0 && h("div", { role: "status", className: "p-3 bg-yellow-50 border border-yellow-300 text-yellow-900 rounded text-sm" },
          "Claude kept " + draft.report.unadjusted + " standard" + (draft.report.unadjusted === 1 ? "" : "s") + " exactly as you wrote " + (draft.report.unadjusted === 1 ? "it" : "them") + ", because adding \u201CStudents will\u201D would have changed what " + (draft.report.unadjusted === 1 ? "it asks" : "they ask") + " of students."),
        builtMode === "paste" && draft.report && draft.report.skipped.length > 0 && h("div", { role: "status", className: "p-3 bg-yellow-50 border border-yellow-300 text-yellow-900 rounded text-sm space-y-1" },
          h("div", { className: "font-semibold" }, "Claude left these lines out because they didn't look like standards:"),
          h("ul", { className: "list-disc pl-5" }, draft.report.skipped.slice(0, 8).map(function (k, i) {
            return h("li", { key: i }, "\u201C" + k.text + "\u201D" + (k.why ? " (" + k.why + ")" : ""));
          })),
          draft.report.skipped.length > 8 && h("div", { className: "text-xs" }, "and " + (draft.report.skipped.length - 8) + " more")),
        builtMode === "paste" && draft.report && draft.report.dropped > 0 && h("div", { role: "status", className: "p-3 bg-yellow-50 border border-yellow-300 text-yellow-900 rounded text-sm" },
          draft.report.dropped + " item" + (draft.report.dropped === 1 ? "" : "s") + " Claude returned didn't match your document word for word, so " + (draft.report.dropped === 1 ? "it was" : "they were") + " left out. If a standard of yours is missing, add it with Create Standard."),
        builtMode === "paste" && h("div", { className: "border border-purple-300 bg-purple-100/40 rounded-lg p-4 space-y-4" },
          h("h4", { className: "text-base font-bold text-gray-900" }, "Check these standards"),
          checkPhase === "loading"
            ? h("p", { role: "status", className: "text-sm text-gray-700" }, "Claude is checking your standards. This usually takes under a minute; a long list can take two.")
            : h(CheckOptions, { info: compareInfo, value: checks, onChange: setChecks, legend: report ? "Run the checks again" : "Choose the checks" },
                h("div", { className: "pt-1" },
                  h("button", { type: "button", onClick: function () { runCheck(draft); }, disabled: !checksToRun(compareInfo, checks).any,
                                className: "px-4 py-2 bg-purple-700 text-white rounded-lg hover:bg-purple-800 font-semibold text-sm disabled:bg-gray-300 disabled:cursor-not-allowed" },
                    report ? "Run the checks again" : "Run the checks"),
                  report && h("span", { className: "ml-2 text-xs text-gray-600" }, "Use this after you edit, move or uncheck standards."))),
          checkError && h("div", { role: "alert", className: "p-3 bg-red-50 border border-red-300 text-red-800 rounded text-sm" }, checkError),
          report && checkPhase !== "loading" && h(CompareReport, { check: report, draft: draft, courseName: course.name,
                                                              onAdd: addSuggestion, onPick: pickSuggestionUnit })),
        empty.length > 0 && h("div", { role: "status", className: "p-3 bg-yellow-50 border border-yellow-300 text-yellow-900 rounded text-sm" },
          "Claude couldn't write standards for " + empty.join(", ") + ". You can move a standard into it, leave it empty, or start over with a fuller description."),
        error && h("div", { role: "alert", className: "p-3 bg-red-50 border border-red-300 text-red-800 rounded text-sm" }, error),
        h("div", { className: "space-y-6" }, draft.units.map(function (u, i) {
          return h(UnitBlock, {
            key: u.uid, unit: u, index: i, unitNames: names,
            onRename: function (name) { setDraft(renameUnit(draft, i, name)); },
            onStandardChange: function (uid, patch) { setDraft(updateStandard(draft, i, uid, patch)); },
            onStandardMove: function (uid, toUnit) { setDraft(moveStandard(draft, i, uid, toUnit)); }
          });
        })),
        draft.attribution && h("p", { className: "text-xs text-gray-500" }, draft.attribution),
        existing > 0 && h("p", { className: "text-xs text-gray-600" }, "This course already has " + existing + " standards. The ones you keep are added alongside them."),
        h(Tick, { checked: submitNow, onChange: setSubmitNow,
          title: "Send these for approval when I add them.",
          help: submitNow ? "They go straight to the department chair's \u201CPending My Approval\u201D list (for a chair, that is your own list)."
                          : "They stay private drafts. You can submit each one later from Browse Standards." }),
        h("div", { className: "flex gap-3 flex-wrap items-center" },
          h("button", {
            onClick: apply, disabled: selected === 0,
            className: "px-5 py-3 bg-purple-700 text-white rounded-lg hover:bg-purple-800 font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed"
          }, "Add " + selected + " selected to outline"),
          h("button", { onClick: build, className: "px-4 py-3 border border-gray-300 bg-white rounded-lg hover:bg-gray-50" }, "Start over with a new draft"),
          h("button", { onClick: discard, className: "px-4 py-3 text-gray-600 hover:text-gray-800" }, "Discard")
        )
      );
    }

    // ---- Idle / loading ----
    var tab = function (key, heading, text) {
      var on = mode === key;
      return h("button", {
        type: "button", "aria-pressed": on, disabled: loading,
        onClick: function () { setMode(key); setError(""); },
        className: "text-left px-4 py-3 rounded-lg border-2 flex-1 min-w-[14rem] " + (on ? "border-purple-500 bg-white" : "border-purple-200 bg-purple-50 hover:bg-white")
      }, h("div", { className: "font-semibold text-gray-900" }, heading), h("div", { className: "text-xs text-gray-600 mt-0.5" }, text));
    };

    var autoControls = h("div", { className: "flex items-end gap-4 flex-wrap" },
      h("div", null,
        h("label", { htmlFor: "eb-unit-count", className: "block text-xs font-medium text-gray-600 mb-1" }, "Number of units"),
        h("select", {
          id: "eb-unit-count", value: unitCount, disabled: loading,
          className: "px-3 py-2 border border-gray-300 rounded-lg",
          onChange: function (e) { setUnitCount(parseInt(e.target.value, 10)); }
        }, range(MIN_UNITS, MAX_UNITS).map(function (n) { return h("option", { key: n, value: n }, n); }))
      ),
      h("button", {
        onClick: build, disabled: loading,
        className: "px-5 py-3 bg-purple-700 text-white rounded-lg hover:bg-purple-800 font-semibold disabled:bg-gray-400 disabled:cursor-wait"
      }, loading ? "Building your draft..." : "Build a semester draft")
    );

    var pv2 = validatePaste(pasteText), plen = pasteText.trim().length;
    var noPortrait = portraitFor(props.portrait).length === 0;
    var tickbox = function (checked, set, disabled, title, help) {
      return h("label", { className: "flex items-start gap-2 text-sm text-gray-800" },
        h("input", { type: "checkbox", checked: checked, disabled: disabled, onChange: function (e) { set(e.target.checked); }, className: "mt-1 h-4 w-4" }),
        h("span", null, h("span", { className: "font-semibold" }, title), h("span", { className: "block text-xs text-gray-600" }, help)));
    };
    var pasteControls = h("div", { className: "space-y-3" },
      h("p", { className: "text-sm text-gray-700" },
        "Copy your standards from your document and paste them below, units and all. Claude finds your units and standards and sorts them. It copies your words exactly. It doesn't write anything of its own."),
      h("textarea", {
        id: "eb-paste", "aria-label": "Your standards", rows: 10, disabled: loading, value: pasteText,
        placeholder: "Paste your standards here, with your unit headings.",
        "aria-invalid": showErrors && !pv2.ok,
        className: "w-full px-3 py-2 border rounded-lg text-sm " + (showErrors && !pv2.ok ? "border-red-400" : "border-gray-300"),
        onChange: function (e) { setPasteText(e.target.value); }
      }),
      h("div", { className: "flex justify-between gap-3 text-xs" },
        h("span", { className: "text-gray-500" }, "Up to about 8 pages at a time. Longer than that? Paste half, then the other half."),
        h("span", { className: plen > MAX_PASTE ? "text-red-700 font-semibold" : plen > MAX_PASTE * 0.9 ? "text-yellow-800" : "text-gray-500" },
          plen.toLocaleString("en-US") + " of " + MAX_PASTE.toLocaleString("en-US") + " characters" + (plen > 0 ? " (about " + pageEstimate(plen) + (pageEstimate(plen) === 1 ? " page)" : " pages)") : ""))),
      tickbox(addWill, setAddWill, loading, "Start my standards with \u201CStudents will\u201D where they don't already.",
        "Claude adds the opening words and changes the verb to fit. It doesn't change what your standard asks of students. You'll see your original wording under any change and can switch back."),
      tickbox(suggestAlign && !noPortrait, setSuggestAlign, loading || noPortrait, "Also suggest which Portrait statements each standard supports.",
        noPortrait ? "No portrait statements are written for this department yet." : "Claude's suggestions are labeled as its own, and you can ignore them."),
      h(CheckOptions, { info: compareInfo, value: checks, onChange: setChecks, disabled: loading }),
      h("div", { className: "flex gap-3 flex-wrap items-center" },
        h("button", {
          onClick: build, disabled: loading,
          className: "px-5 py-3 bg-purple-700 text-white rounded-lg hover:bg-purple-800 font-semibold disabled:bg-gray-400 disabled:cursor-wait"
        }, loading ? "Sorting your standards..." : checksToRun(compareInfo, checks).any ? "Sort and check my standards" : "Sort my standards"))
    );

    var unitControls = h("div", { className: "space-y-3" },
      h("p", { className: "text-sm text-gray-700" },
        "List the units you plan for this semester and say what each one covers: the topics, and what students will do or make. Claude then writes standards for each unit. Your unit names stay exactly as you type them."),
      rows.map(function (r, i) {
        var e = showErrors ? check.errors[i] || {} : {};
        var len = r.about.length;
        return h("div", { key: i, className: "bg-white border border-purple-200 rounded-lg p-3 space-y-2" },
          h("div", { className: "flex items-center gap-2" },
            h("span", { className: "text-xs font-semibold text-purple-700" }, "Unit " + (i + 1)),
            rows.length > 1 && h("button", {
              type: "button", disabled: loading, onClick: function () { removeRow(i); }, "aria-label": "Remove unit " + (i + 1),
              className: "ml-auto text-xs text-gray-500 hover:text-red-700"
            }, "Remove")),
          h("input", {
            type: "text", id: "eb-un-name-" + i, "aria-label": "Unit " + (i + 1) + " name", maxLength: MAX_NAME, disabled: loading,
            value: r.name, placeholder: i === 0 ? "e.g., Linear Equations" : "Unit name", "aria-invalid": !!e.name,
            className: "w-full px-3 py-2 border rounded-lg font-semibold " + (e.name ? "border-red-400" : "border-gray-300"),
            onChange: function (ev) { setRow(i, { name: ev.target.value }); }
          }),
          e.name && h("p", { role: "alert", className: "text-xs text-red-700" }, e.name),
          h("textarea", {
            id: "eb-un-about-" + i, "aria-label": "Unit " + (i + 1) + " description", maxLength: MAX_ABOUT, rows: 3, disabled: loading,
            value: r.about, "aria-invalid": !!e.about,
            placeholder: i === 0 ? "Topics covered, and what students will do or make. Example: solving and graphing linear equations from word problems." : "Topics covered, and what students will do or make.",
            className: "w-full px-3 py-2 border rounded-lg text-sm " + (e.about ? "border-red-400" : "border-gray-300"),
            onChange: function (ev) { setRow(i, { about: ev.target.value }); }
          }),
          h("div", { className: "flex justify-between gap-3 text-xs" },
            h("span", { role: e.about ? "alert" : undefined, className: e.about ? "text-red-700" : "text-gray-500" },
              e.about || (len > 0 && len < MIN_ABOUT ? "A sentence or two works best." : "")),
            h("span", { className: len > MAX_ABOUT - 40 ? "text-yellow-800" : "text-gray-500" }, len + "/" + MAX_ABOUT))
        );
      }),
      h("div", { className: "flex gap-3 flex-wrap items-center" },
        h("button", {
          type: "button", onClick: addRow, disabled: loading || rows.length >= MAX_UNITS,
          className: "px-3 py-2 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50"
        }, rows.length >= MAX_UNITS ? "Eight units is the most" : "+ Add another unit"),
        h("button", {
          onClick: build, disabled: loading,
          className: "px-5 py-3 bg-purple-700 text-white rounded-lg hover:bg-purple-800 font-semibold disabled:bg-gray-400 disabled:cursor-wait"
        }, loading ? "Building your draft..." : "Build standards for my units"))
    );

    return h("section", { className: "no-print border border-purple-200 bg-purple-50 rounded-lg p-5 space-y-4" },
      h("div", null, title,
        h("p", { className: "text-sm text-gray-700 mt-1" }, "Choose how much help you want. Either way, you review everything, and only what you keep is added to the outline.")),
      h("div", { className: "flex gap-3 flex-wrap", role: "group", "aria-label": "How much help do you want?" },
        tab("auto", "Plan it for me", "Claude proposes the units and writes the standards."),
        tab("units", "I'll describe my units", "You list your units. Claude writes the standards."),
        tab("paste", "I already have my standards", "Paste them in. Claude sorts them into units. Your wording stays yours.")),
      h("p", { className: "text-xs text-gray-500" }, mode === "paste" ? "Your standards stay in your own words." : sourceLine),
      doneMsg && h("div", { role: "status", className: "p-3 bg-green-50 border border-green-300 text-green-800 rounded text-sm" }, doneMsg),
      error && h("div", { role: "alert", className: "p-3 bg-red-50 border border-red-300 text-red-800 rounded text-sm" }, error),
      existing > 0 && h("p", { className: "text-xs text-gray-600" }, "This course already has " + existing + " standards. A new draft is reviewed first and added alongside them."),
      mode === "units" ? unitControls : mode === "paste" ? pasteControls : autoControls,
      loading && h("p", { className: "text-sm text-gray-600" }, mode === "paste" ? "This usually takes under a minute. A long document can take two." : "This usually takes 20 to 40 seconds.")
    );
  }

  function range(lo, hi) {
    var out = [];
    for (var i = lo; i <= hi; i++) out.push(i);
    return out;
  }

  window.EasyButton = EasyButton;
  window.EasyButtonLogic = {
    gradesFor: gradesFor, gradeLabelFor: gradeLabelFor, parseGradeRange: parseGradeRange, gradesOverlap: gradesOverlap,
    collectSources: collectSources, hintWords: hintWords, validateUnitRows: validateUnitRows, validatePaste: validatePaste, pageEstimate: pageEstimate, portraitFor: portraitFor, toDraft: toDraft, selectedUnits: selectedUnits,
    countSelected: countSelected, StandardRow: StandardRow, moveStandard: moveStandard, updateStandard: updateStandard, renameUnit: renameUnit,
    compareProfile: compareProfile, compareSets: compareSets, pickCompareSources: pickCompareSources, checksToRun: checksToRun,
    standardsForCheck: standardsForCheck, applyMatches: applyMatches, suggestionNote: suggestionNote, addToUnit: addToUnit
  };
})();