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
      .filter(function (s) { return s && s.code && s.description && String(s.description).trim(); })
      .map(function (s) { return { code: s.code, description: s.description }; });
  }

  var uidCounter = 0;
  function nextUid() { uidCounter += 1; return "eb" + uidCounter; }

  // Turns the Worker's response into editable review state.
  function toDraft(data) {
    return {
      attribution: data.attribution || "",
      units: (data.units || []).map(function (u) {
        return {
          uid: nextUid(),
          name: u.name,
          standards: (u.standards || []).map(function (s) {
            return {
              uid: nextUid(), include: true, category: s.category, description: s.description,
              sourceNote: s.sourceNote, alignsTo: s.alignsTo || []
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
            return { category: String(s.category || "").trim() || "General", description: String(s.description).trim(), sourceNote: s.sourceNote, alignsTo: s.alignsTo };
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

    var existing = props.existingCount || 0;
    var bankInfo = collectSources(department, course);
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
          if (!res.ok) throw new Error(data.error || "Request failed");
          return data;
        });
      }).then(function (data) {
        setDraft(toDraft(data));
        setBuiltMode(sentMode);
        setInfo({ sampled: used.sampled, total: used.total, used: used.rows.length, ranked: used.ranked || 0 });
        setPhase("review");
      }).catch(function (e) {
        setError("The draft didn't work: " + e.message + ". Try again in a moment.");
        setPhase(draft ? "review" : "idle");
      });
    };

    var discard = function () { setDraft(null); setPhase("idle"); setError(""); };

    var apply = function () {
      var units = selectedUnits(draft);
      var n = units.reduce(function (sum, u) { return sum + u.standards.length; }, 0);
      if (n === 0) { setError("Check at least one standard to add."); return; }
      props.onApply(units, draft.attribution);
      setDoneMsg("Added " + n + " draft standards in " + units.length + " units. They are marked AI-suggested and still need a chair's approval.");
      if (builtMode === "units") { setRows([{ name: "", about: "" }]); setShowErrors(false); }
      setDraft(null); setPhase("idle"); setError("");
    };

    var title = h("h3", { className: "text-lg font-bold text-gray-900" }, "Build a semester draft");
    var reviewIntro = builtMode === "units"
      ? "These are your units, with standards Claude drafted for each one. You review the draft, edit or uncheck anything you don't want, and only what you keep is added to the outline."
      : "Claude drafts units and standards for " + course.name + ". You review the draft, edit or uncheck anything you don't want, and only what you keep is added to the outline.";

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
          h("p", { className: "text-xs text-gray-500 mt-1" }, sourceLine)),
        sampledLine && h("p", { className: "text-xs text-gray-600" }, sampledLine),
        h("div", { className: "bg-white border border-purple-200 rounded p-3 text-sm text-gray-700" },
          "These are AI-written drafts. Read each one before you keep it. " + selected + " of " + total + " are checked."),
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
        tab("units", "I'll describe my units", "You list your units. Claude writes the standards.")),
      h("p", { className: "text-xs text-gray-500" }, sourceLine),
      doneMsg && h("div", { role: "status", className: "p-3 bg-green-50 border border-green-300 text-green-800 rounded text-sm" }, doneMsg),
      error && h("div", { role: "alert", className: "p-3 bg-red-50 border border-red-300 text-red-800 rounded text-sm" }, error),
      existing > 0 && h("p", { className: "text-xs text-gray-600" }, "This course already has " + existing + " standards. A new draft is reviewed first and added alongside them."),
      mode === "units" ? unitControls : autoControls,
      loading && h("p", { className: "text-sm text-gray-600" }, "This usually takes 20 to 40 seconds.")
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
    collectSources: collectSources, hintWords: hintWords, validateUnitRows: validateUnitRows, portraitFor: portraitFor, toDraft: toDraft, selectedUnits: selectedUnits,
    countSelected: countSelected, moveStandard: moveStandard, updateStandard: updateStandard, renameUnit: renameUnit
  };
})();
