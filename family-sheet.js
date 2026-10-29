/* =====================================================================
   family-sheet.js  -  the one-page family overview

   A principal presses one button; this builds a page (or a stack of different
   pages) for a department. Load it with a normal <script src="family-sheet.js">
   tag. It adds window.FamilySheet.

   HOW "DIFFERENT EACH TIME" WORKS
   Nothing here writes new wording. Each sheet is ASSEMBLED from approved records
   using a seeded random choice: which Portrait statement is the pull-quote, which
   three ideas are followed into a classroom, which approved standard stands for
   each, the color scheme, and the arrangement. Because the words only ever come
   from approved records, every variant is as trustworthy as the tool itself, and
   the small sheet ID in the footer says exactly which variant a family received.

   WHAT IT WILL NOT DO (it refuses rather than print something unapproved)
     - a department whose portrait is not complete, or is only prompts
     - a department whose portrait does not have the seven statements that line up
       with Westminster's seven (its chair has to set the connections first)
     - a class example that is not approved, or does not trace to the statement above it

   PERSONALIZING (real, not pretend): a family name, and the grade the student
   starts in, which highlights where they begin on the pathway chart.
   ===================================================================== */
(function () {
  "use strict";

  var SIGNER = { name: "Micah Gall", title: "Head of Academic Development" };

  var ABBR = { Fundamentals: "Fund", Traditional: "Trad", Honors: "Hon", AP: "AP" };
  var LEVEL_ORDER = ["Fundamentals", "Traditional", "Honors", "AP"];
  /* The bold phrase inside each of the seven statements, found verbatim. */
  var KEYS = [/Love of the Lord/, /Know God Created Them/i, /Understand the World/i, /Value Learning/i,
              /Find Joy/i, /Honor the Lord/i, /Cultivate their experience/i];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function boldKey(text) {
    var t = esc(text), head = t.slice(0, 80);
    for (var k = 0; k < KEYS.length; k++) {
      var m = head.match(KEYS[k]);
      if (m) return t.replace(m[0], "<b>" + m[0] + "</b>");
    }
    return t;
  }
  function tidyEllipsis(s) { return String(s || "").replace(/\.\.\./g, "\u2026"); }

  /* ---------- connections to the Westminster Portrait ----------
     A function from a department statement code to a list of Westminster codes ("WCA-POG-3").
     The app supplies the real one (by number unless a chair has set it differently, and only
     approved connections count). This is the by-number fallback for use on its own. */
  function numberConnect(code) {
    var m = String(code).match(/^([A-Z]+)-POG-(\d+)$/);
    if (!m || m[1] === "ENG" || m[1] === "ART") return [];
    var n = parseInt(m[2], 10);
    return n >= 1 && n <= 7 ? ["WCA-POG-" + n] : [];
  }
  function westNum(code) { return parseInt(String(code).split("-").pop(), 10); }

  /* ---------- who may have a sheet ---------- */
  function eligibility(name, portrait, connect) {
    connect = connect || numberConnect;
    if (!portrait) return { ok: false, reason: "No portrait on file." };
    var st = portrait.status;
    if (st === "empty") return { ok: false, reason: "Its portrait has not been written yet." };
    if (st === "placeholder") return { ok: false, reason: "Its portrait is a placeholder, not an approved one." };
    if (st === "partial") return { ok: false, reason: portrait.partialNote || "Its portrait is only partly written." };
    if (st !== "complete") return { ok: false, reason: "Its portrait is not marked complete." };
    var stmts = portrait.standards || [];
    if (stmts.length < 3) return { ok: false, reason: "It has only " + stmts.length + " portrait statements." };
    var open = stmts.filter(function (s) { return /\.\.\.|\u2026/.test(s.description); });
    if (open.length) return { ok: false, reason: "Some of its portrait statements are unfinished (they still contain \u201C...\u201D)." };
    var none = stmts.filter(function (s) { return !(connect(s.code) || []).length; });
    if (none.length) {
      return { ok: false, reason: (none.length === stmts.length ? "None of its portrait statements are" :
        none.length + " of its " + stmts.length + " portrait statements are not") +
        " connected to the Westminster Portrait yet. Its chair can set them on the Set Connections screen." };
    }
    return { ok: true, reason: "" };
  }
  function eligibleDepartments(portraits, connect) {
    return Object.keys(portraits).map(function (name) {
      var e = eligibility(name, portraits[name], connect);
      return { name: name, ok: e.ok, reason: e.reason };
    });
  }

  /* ---------- seeded randomness ---------- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* The sheet ID IS the seed (31 bits, six base-36 characters), so a printed ID is enough to
     rebuild exactly that sheet, and two sheets in a stack can never share one. */
  function sheetId(seed) {
    var t = (seed >>> 0).toString(36).toUpperCase();
    while (t.length < 6) t = "0" + t;
    return t.slice(0, 3) + "-" + t.slice(3);
  }
  function seedFromId(id) { return parseInt(String(id).replace(/[^0-9A-Za-z]/g, ""), 36); }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function shuffle(r, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---------- pathway rows from the course list ---------- */
  function stripLevel(name) {
    var m = String(name).match(/^(.*?)\s*\((Fundamentals|Honors|AP)\)\s*$/);
    return m ? { base: m[1], level: m[2] } : { base: name, level: null };
  }
  function pathRows(courses) {
    var rows = {};
    courses.forEach(function (c) {
      var s = stripLevel(c.name), key = c.family || s.base;
      var r = rows[key] || (rows[key] = { name: key, grades: {}, levels: {}, plain: false });
      (c.grades || []).forEach(function (g) { r.grades[g] = 1; });
      var lv = s.level || ((c.level === "Traditional" || c.level === "Honors" || c.level === "Fundamentals" || c.level === "AP") ? c.level : null);
      if (lv) r.levels[lv] = 1; else r.plain = true;
    });
    return Object.keys(rows).map(function (k) {
      var r = rows[k];
      if (r.plain && Object.keys(r.levels).length && !r.levels.Traditional) r.levels.Traditional = 1;
      var lv = LEVEL_ORDER.filter(function (l) { return r.levels[l]; });
      return { name: r.name, grades: Object.keys(r.grades).map(Number).sort(function (a, b) { return a - b; }),
               lv: lv.map(function (l) { return { k: l, t: ABBR[l] }; }) };
    });
  }

  /* ---------- plan one sheet (pure: same seed, same sheet) ---------- */
  function plan(o, seed) {
    var r = rng(seed), connect = o.connect || numberConnect;
    var portrait = o.portrait, stmts = portrait.standards, N = stmts.length;
    var westText = function (c) {
      var t = o.west.traits.filter(function (x) { return x.code === c; })[0];
      return t ? t.description : "";
    };
    var wests = function (i) {
      return connect(stmts[i].code).slice().sort(function (a, b) { return westNum(a) - westNum(b); }).slice(0, 2)
        .map(function (c) { return { num: westNum(c), text: westText(c) }; });
    };

    /* approved standards of this department, and which statements they trace to */
    var approved = (o.standards || []).filter(function (s) {
      return s.department === o.department && s.status === "approved";
    });
    var byStmt = [], all = [];
    for (var i = 0; i < N; i++) {
      all.push(i);
      byStmt.push(approved.filter(function (s) { return (s.alignsTo || []).indexOf(stmts[i].code) !== -1; }));
    }
    var haveClass = []; byStmt.forEach(function (list, i) { if (list.length) haveClass.push(i); });

    var threads = [], mode = "pairs";
    if (haveClass.length >= 2) {
      /* never show the same example twice, or two examples from the same course if there is a choice */
      var usedStd = {}, usedCourse = {};
      shuffle(r, haveClass).forEach(function (i) {
        if (threads.length >= 3) return;
        var pool = byStmt[i].filter(function (s) { return !usedStd[s.id]; });
        if (!pool.length) return;
        var fresh = pool.filter(function (s) { return !usedCourse[s.course]; });
        var s = pick(r, fresh.length ? fresh : pool);
        usedStd[s.id] = 1; usedCourse[s.course] = 1;
        threads.push({ n: i + 1, wests: wests(i), dept: stmts[i].description,
                       course: s.course, std: s.description, sid: s.id });
      });
      threads.sort(function (a, b) { return a.n - b.n; });
      if (threads.length >= 2) mode = "class";
    }
    if (mode === "pairs") {
      threads = [];
      shuffle(r, all).slice(0, 3).sort(function (a, b) { return a - b; }).forEach(function (i) {
        threads.push({ n: i + 1, wests: wests(i), dept: stmts[i].description });
      });
    }

    var hero = Math.floor(r() * N);
    return {
      seed: seed >>> 0,
      id: sheetId(seed),
      theme: pick(r, ["a", "b", "c"]),
      hero: hero,
      mode: mode, threads: threads,
      pathFirst: r() < 0.5,           // pathway before the threads
      noteFirst: r() < 0.5,           // "how to read this" tile at the start
      heroLeft: r() < 0.5,
      solidIcons: r() < 0.5,
      key: null
    };
  }
  function variantKey(p) {
    return [p.theme, p.hero, p.mode, p.threads.map(function (t) { return t.n + ":" + (t.sid || ""); }).join(","),
            p.pathFirst, p.noteFirst, p.heroLeft, p.solidIcons].join("|");
  }

  /* ---------- the page ---------- */
  var ICONS = {
    1: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    2: '<path d="m12 3 1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    3: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    4: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    5: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    6: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    7: '<path d="M7 21h10M12 21v-9"/><path d="M12 12c0-3.4-2.2-5.6-6.5-5.6 0 3.4 2.2 5.6 6.5 5.6zM12 14c0-3.4 2.2-5.6 6.5-5.6 0 3.4-2.2 5.6-6.5 5.6z"/>'
  };
  function icon(n) {
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[n] + "</svg>";
  }
  var ARROW = '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function westNode(wests) {
    if (wests.length === 1) return esc(wests[0].text);
    return wests.map(function (w) { return '<div class="w"><b class="wn">' + w.num + "</b> " + esc(w.text) + "</div>"; }).join("");
  }
  function titleSize(name) { return name.length > 24 ? 22 : name.length > 15 ? 28 : 35; }

  function pageHtml(o, p) {
    var d = o.department, stmts = o.portrait.standards;
    var famName = String(o.family || "").trim().slice(0, 40);
    var g = parseInt(o.grade, 10); if (!(g >= 7 && g <= 12)) g = 0;
    var tag = tidyEllipsis(o.portrait.tagline);
    var today = new Date(o.today || Date.now()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    /* header */
    var kicker = famName ? "Prepared for the " + esc(famName) + " family &middot; " + esc(today)
                         : "Westminster Christian Academy";
    var head =
      '<div class="head' + (p.heroLeft ? " hl" : "") + '"><div class="hd-l">' +
        '<div class="brand"><img class="crest" src="logo.png" alt="" onerror="this.style.display=\'none\'">' +
        '<div class="kicker">' + kicker + "</div></div>" +
        '<div class="title" style="font-size:calc(' + titleSize(d) + 'pt * var(--s))">' + esc(d) + "</div>" +
        '<div class="tag"><i>' + esc(tag) + "</i></div></div>" +
      '<div class="hero"><div class="q">\u201C</div><p>' + boldKey(stmts[p.hero].description) + "</p>" +
      '<div class="src">' + esc(d) + " Portrait of a Graduate</div></div></div>";

    /* the seven statements */
    var connect = o.connect || numberConnect;
    var nums = function (i) {
      var n = connect(stmts[i].code).map(westNum).filter(function (x) { return x >= 1 && x <= 7; })
        .sort(function (a, b) { return a - b; });
      return n.length ? n : [Math.min(i + 1, 7)];
    };
    var tiles = stmts.map(function (s, i) {
      var nm = nums(i);
      return '<div class="tile' + (i === p.hero ? " hot" : "") + '"><div class="n">' + nm.join("\u00b7") + "</div>" +
             '<div class="icw' + (p.solidIcons ? " solid" : "") + '">' + icon(nm[0]) + "</div><p>" +
             boldKey(s.description) + "</p></div>";
    });
    var noteText = "Westminster\u2019s Portrait of a Graduate describes the person we hope every student becomes. " +
      "Each statement here grows from one or more of its seven statements, shown by number.";
    var showNote = stmts.length + 1 <= 8;      // a ninth tile would cost a whole row
    var note = '<div class="tile note"><div class="label">How to read this</div><p>' + noteText + "</p></div>";
    if (showNote) { if (p.noteFirst) tiles.unshift(note); else tiles.push(note); }
    var secTiles = '<div class="sec s-tiles"><h2>Who our ' + esc(d) + " graduates become</h2>" +
      (showNote ? "" : '<div class="sub">' + noteText + "</div>") +
      '<div class="tiles">' + tiles.join("") + "</div></div>";

    /* threads */
    var cls = p.mode === "class";
    var cols = cls ? "c3" : "c2";
    var thr = '<div class="sec s-threads"><h2>From the Portrait to the ' + (cls ? "classroom" : "department") + "</h2>" +
      '<div class="sub">One idea, followed from Westminster\u2019s Portrait of a Graduate ' +
      (cls ? "all the way into a class." : "into " + esc(d) + ".") + "</div>" +
      '<div class="cols ' + cols + '"><div class="col-l"><span class="dot" style="background:var(--blue)"></span><span class="label">Who they become</span></div><span></span>' +
      '<div class="col-l"><span class="dot" style="background:var(--sky)"></span><span class="label">In ' + esc(d) + "</span></div>" +
      (cls ? '<span></span><div class="col-l"><span class="dot" style="background:var(--navy)"></span><span class="label">What they do in class</span></div>' : "") +
      "</div>" +
      p.threads.map(function (t) {
        return '<div class="thread ' + cols + '"><div class="node n1">' + westNode(t.wests) + '</div><div class="arrow">' + ARROW + "</div>" +
               '<div class="node n2">' + esc(t.dept) + "</div>" +
               (cls ? '<div class="arrow">' + ARROW + '</div><div class="node n3"><span class="course">' + esc(t.course) + "</span><br>" + esc(t.std) + "</div>" : "") +
               "</div>";
      }).join("") + "</div>";

    /* pathway */
    var courses = (o.courses || []).filter(function (c) { return c.department === d; });
    var ms = pathRows(courses.filter(function (c) { return c.school === "Middle School"; }));
    var us = pathRows(courses.filter(function (c) { return c.school === "Upper School"; })).filter(function (r) { return r.grades.length; });
    var msOrder = ["Math 7", "Pre-Algebra", "Math 8", "Algebra 1", "Algebra 2"];
    ms.sort(function (a, b) {
      var x = msOrder.indexOf(a.name), y = msOrder.indexOf(b.name);
      return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.name.localeCompare(b.name);
    });
    us.sort(function (a, b) { return a.grades[0] - b.grades[0] || a.grades[a.grades.length - 1] - b.grades[b.grades.length - 1] || a.name.localeCompare(b.name); });
    var chips = function (r) { return r.lv.map(function (l) { return '<span class="lv ' + l.k + '">' + l.t + "</span>"; }).join(""); };
    var path = "";
    if (ms.length || us.length) {
      path = '<div class="sec s-path"><h2>The path through ' + esc(d) + "</h2>";
      if (ms.length) {
        path += '<div class="ms' + (g && g <= 8 ? " here" : (g >= 9 ? " before" : "")) + '"><span class="label">Middle School</span>' +
          ms.map(function (r) { return '<span class="pill">' + esc(r.name) + chips(r) + "</span>"; }).join("") + "</div>";
      }
      if (us.length && us.length > 12) {
        /* many courses: list each once, under the first grade it is offered */
        var chip = function (r) {
          var past = g >= 9 && r.grades[r.grades.length - 1] < g;
          return '<span class="cchip' + (past ? " past" : "") + '">' + esc(r.name) + chips(r) + "</span>";
        };
        path += '<div class="cpath">' + [9, 10, 11, 12].map(function (n) {
          return '<div class="cp-col"><div class="cp-h' + (g === n ? " start" : "") + '">Open from grade ' + n + (g === n ? " &middot; start" : "") + "</div>" +
                 us.filter(function (r) { return r.grades[0] === n; }).map(chip).join("") + "</div>";
        }).join("") + "</div>" +
        '<div class="sub" style="margin-top:.04in; font-size:calc(6.8pt * var(--s))">Each course is listed in the first grade it is offered. Fund = Fundamentals &middot; Trad = Traditional &middot; Hon = Honors &middot; AP = Advanced Placement</div>';
      } else if (us.length) {
        path += '<div class="chart"><div class="row h"><span>Upper School</span>' +
          [9, 10, 11, 12].map(function (n) { return "<span" + (g === n ? ' class="start"' : "") + ">Grade " + n + (g === n ? " &middot; start" : "") + "</span>"; }).join("") + "</div>" +
          us.map(function (r) {
            var past = g >= 9 && r.grades[r.grades.length - 1] < g;
            var start = r.grades[0] - 9, span = r.grades[r.grades.length - 1] - r.grades[0] + 1;
            return '<div class="row' + (past ? " past" : "") + '"><div class="nm">' + esc(r.name) + '</div><div class="bar" style="grid-column:' + (start + 2) + " / span " + span + '">' + chips(r) + "</div></div>";
          }).join("") + "</div>" +
          '<div class="sub" style="margin-top:.04in; font-size:calc(6.8pt * var(--s))">Fund = Fundamentals &middot; Trad = Traditional &middot; Hon = Honors &middot; AP = Advanced Placement</div>';
      }
      path += "</div>";
    }

    var foot = '<div class="foot"><div class="fl"><span class="wm">Westminster Christian Academy</span>' +
      '<span class="vid">Sheet ' + esc(p.id) + "</span></div>" +
      '<div class="sig"><div class="sline">Reviewed by <i></i> &nbsp; Date <i class="short"></i></div>' +
      '<div class="sname">' + esc(o.signer.name) + ", " + esc(o.signer.title) + "</div></div></div>";

    var demo = o.demo ? '<div class="proto">Prototype \u00b7 sample standards</div>' : "";
    return '<div class="page t-' + p.theme + (p.pathFirst ? " path-first" : "") + (p.solidIcons ? " solid-icons" : "") +
           '" data-sheet="' + esc(p.id) + '" style="--s:1">' + demo + head + secTiles + thr + path + foot + "</div>";
  }

  /* ---------- CSS (sizes scale with --s so a long page can shrink to fit) ---------- */
  function pt(n) { return "calc(" + n + "pt * var(--s))"; }
  var CSS = [
    ":root{--blue:#255AA8;--navy:#002E5D;--paper:#F3F8FD;--line:#CFE0F1;--muted:#4E6683;--sky:#5BC2E7;--sky-soft:#E6F6FD;--sky-line:#AEE2F6;--sky-deep:#1F6E94;--blue-soft:#EEF5FC;--blue-line:#BFD6F0;--steel:#2C5482;--steel-soft:#E3EBF5}",
    "@page{size:8.5in 11in;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#dfe8f3}",
    'body{font-family:"Avenir Next",Avenir,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--navy);-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    ".page{--hero-bg:var(--navy);--hero-key:var(--sky);--num:var(--blue);--ic:var(--sky-deep);width:8.5in;height:11in;margin:0 auto .2in;background:#fff;position:relative;overflow:hidden;padding:.4in .45in .32in;display:flex;flex-direction:column;gap:.15in;break-after:page;page-break-after:always}",
    ".page.t-b{--hero-bg:var(--blue);--hero-key:#fff;--num:var(--navy);--ic:var(--blue)}",
    ".page.t-c{--hero-bg:var(--sky-deep);--hero-key:#E6F6FD;--num:var(--sky-deep);--ic:var(--sky-deep)}",
    "@media print{html,body{background:#fff}.page{margin:0}.page:last-child{break-after:auto;page-break-after:auto}}",
    ".kicker{font-size:" + pt(6.8) + ";font-weight:700;letter-spacing:.17em;text-transform:uppercase;color:var(--muted)}",
    ".label{font-size:" + pt(7) + ";font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}",
    "h2{margin:0;font-size:" + pt(13.5) + ";letter-spacing:-.01em;color:var(--navy)}",
    ".sub{margin:2px 0 0;font-size:" + pt(7.8) + ";color:var(--muted);line-height:1.4}",
    "b{font-weight:700;color:var(--blue)}",
    ".proto{position:absolute;top:.13in;right:.45in;font-size:" + pt(6.3) + ";font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--steel);background:var(--steel-soft);border:1px solid #C7D8EC;border-radius:99px;padding:2px 9px}",
    ".sec{display:block}.s-tiles{order:1}.s-threads{order:2}.s-path{order:3}.path-first .s-path{order:2}.path-first .s-threads{order:3}.foot{order:9}.head{order:0}",
    ".head{display:grid;grid-template-columns:1fr 3.05in;gap:.28in;align-items:stretch}.head.hl{grid-template-columns:3.05in 1fr}.head.hl .hero{order:-1}",
    ".brand{display:flex;gap:.13in;align-items:center}.crest{width:.52in;height:.52in;border-radius:12px;flex:none;object-fit:contain}",
    ".title{font-weight:800;letter-spacing:-.025em;line-height:.98;margin:.07in 0 .05in;color:var(--navy)}",
    ".tag{font-size:" + pt(9.5) + ";color:var(--muted);line-height:1.4;max-width:3.6in}.tag i{font-style:normal;font-weight:700;color:var(--blue)}",
    ".hero{background:var(--hero-bg);color:#fff;border-radius:16px;padding:.16in .2in;display:flex;flex-direction:column;justify-content:center}",
    ".hero .q{font-size:" + pt(30) + ";line-height:.6;font-weight:800;color:var(--hero-key);height:.2in}",
    ".hero p{margin:.03in 0 .08in;font-size:" + pt(11.3) + ";line-height:1.3;font-weight:600}.hero b{color:var(--hero-key)}",
    ".hero .src{font-size:" + pt(6.4) + ";letter-spacing:.13em;text-transform:uppercase;color:rgba(255,255,255,.7);font-weight:700}",
    ".tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:.085in;margin-top:.07in}",
    ".tile{background:#fff;border:1px solid var(--line);border-radius:12px;padding:.09in .11in .08in;position:relative;min-height:.94in}",
    ".tile.hot{border-color:var(--num);box-shadow:0 0 0 1px var(--num) inset}",
    ".tile .n{min-width:.24in;width:fit-content;height:.24in;padding:0 .07in;border-radius:99px;background:var(--num);color:#fff;font-weight:800;font-size:" + pt(8.5) + ";display:flex;align-items:center;justify-content:center;letter-spacing:.02em}",
    ".icw{position:absolute;top:.08in;right:.09in;width:.27in;height:.27in;color:var(--ic);display:flex;align-items:center;justify-content:center}.icw .ic{width:100%;height:100%}",
    ".icw.solid{background:var(--sky-soft);border-radius:50%;padding:.045in}",
    ".tile p{margin:.05in 0 0;font-size:" + pt(7.5) + ";line-height:1.38;color:#1B3B63}",
    ".tile.note{background:var(--sky-soft);border-color:var(--sky-line);display:flex;flex-direction:column;justify-content:center}.tile.note .label{color:var(--sky-deep)}.tile.note p{margin-top:.05in;font-size:" + pt(7.4) + "}",
    ".cols{display:grid;align-items:center;margin:.05in 0 .04in}.c3{grid-template-columns:1fr .2in 1fr .2in 1fr}.c2{grid-template-columns:1fr .2in 1fr}",
    ".col-l{display:flex;align-items:center;gap:6px}.dot{width:8px;height:8px;border-radius:50%;flex:none}",
    ".thread{display:grid;align-items:stretch;margin-bottom:.05in}",
    ".node{border-radius:10px;padding:.055in .09in;font-size:" + pt(7.3) + ";line-height:1.36;border:1px solid;color:#1B3B63}",
    ".n1{background:var(--blue-soft);border-color:var(--blue-line)}.n2{background:var(--sky-soft);border-color:var(--sky-line)}.n3{background:#fff;border-color:var(--line);border-left:4px solid var(--navy)}",
    ".node .w + .w{margin-top:3px}.node .wn{display:inline-block;min-width:.15in;text-align:center;background:var(--blue);color:#fff;border-radius:99px;font-size:" + pt(6) + ";padding:0 3px;margin-right:2px}",
    ".arrow{display:flex;align-items:center;justify-content:center;color:var(--sky-deep)}.arrow svg{width:.17in;height:.17in}",
    ".course{display:inline-block;font-size:" + pt(6.3) + ";font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--navy);background:var(--steel-soft);border-radius:99px;padding:1.5px 7px;margin-bottom:3px}",
    ".ms{display:flex;align-items:center;flex-wrap:wrap;gap:.04in;margin:.05in 0 .06in}.ms .label{margin-right:.06in;color:var(--blue)}.ms.before{opacity:.45}",
    ".ms.here .label::after{content:' \\00b7  starting here';color:var(--sky-deep)}",
    ".pill{font-size:" + pt(7.2) + ";font-weight:700;color:var(--blue);background:var(--blue-soft);border:1px solid var(--blue-line);border-radius:99px;padding:2px 8px}",
    ".lv{font-size:" + pt(5.8) + ";font-weight:800;letter-spacing:.05em;text-transform:uppercase;border-radius:99px;padding:1px 5px;margin-left:3px;line-height:1.3;display:inline-block}",
    ".lv.Fundamentals{background:var(--steel-soft);color:var(--steel)}.lv.Traditional{background:#fff;color:var(--blue);border:1px solid var(--blue-line)}.lv.Honors{background:var(--blue);color:#fff}.lv.AP{background:var(--navy);color:#fff}",
    ".chart{border:1px solid var(--line);border-radius:12px;overflow:hidden}",
    ".row{display:grid;grid-template-columns:1.78in repeat(4,1fr);align-items:center;min-height:.178in;padding-right:.07in;border-top:1px solid #E4EDF8}.row:first-child{border-top:0}",
    ".row.h{background:var(--paper);min-height:.2in}.row.h span{font-size:" + pt(6.6) + ";font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:0 .08in}.row.h span.start{color:var(--blue)}",
    ".row.past{opacity:.38}.row .nm{font-size:" + pt(7.6) + ";font-weight:700;padding:0 .09in;color:var(--navy)}",
    ".bar{height:.125in;margin:0 .035in;border-radius:99px;background:var(--sky-soft);border:1px solid var(--sky-line);display:flex;align-items:center;gap:2px;padding:0 .04in;overflow:hidden;white-space:nowrap}.bar .lv{margin-left:0}",
    ".cpath{display:grid;grid-template-columns:repeat(4,1fr);gap:.07in}.cp-col{border:1px solid var(--line);border-radius:10px;padding:.06in .07in}",
    ".cp-h{font-size:" + pt(6.6) + ";font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.05in}.cp-h.start{color:var(--blue)}",
    ".cchip{display:inline-block;font-size:" + pt(7) + ";font-weight:700;color:var(--blue);background:var(--blue-soft);border:1px solid var(--blue-line);border-radius:99px;padding:1px 7px;margin:0 3px 3px 0}.cchip.past{opacity:.38}",
    ".foot{margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;padding-top:.08in;border-top:1px solid var(--line);font-size:" + pt(6.6) + ";color:var(--muted)}",
    ".fl{display:flex;flex-direction:column;gap:2px}.wm{font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--navy)}.vid{letter-spacing:.06em;font-size:" + pt(5.8) + "}",
    ".sig{display:flex;flex-direction:column;align-items:flex-start}.sline{display:flex;align-items:flex-end;gap:5px;white-space:nowrap}",
    ".sline i{display:inline-block;width:2.2in;border-bottom:1px solid var(--muted);height:.22in}.sline i.short{width:.95in}",
    ".sname{margin-top:3px;font-weight:700;color:var(--navy);letter-spacing:.02em;font-size:" + pt(6.8) + "}"
  ].join("\n");

  /* shrink a page that is too tall, then drop the last thread, until it fits */
  var FIT = "(function(){function fit(){var pgs=document.querySelectorAll('.page');for(var i=0;i<pgs.length;i++){var pg=pgs[i],s=1;" +
    "var over=function(){return pg.scrollHeight>pg.clientHeight+1};" +
    "while(over()&&s>0.86){s-=0.02;pg.style.setProperty('--s',s.toFixed(2));}" +
    "if(over()){var th=pg.querySelectorAll('.thread');if(th.length>1){th[th.length-1].remove();pg.style.setProperty('--s','1');s=1;" +
    "while(over()&&s>0.86){s-=0.02;pg.style.setProperty('--s',s.toFixed(2));}}}" +
    "pg.setAttribute('data-fit',over()?'overflow':'ok');}}" +
    "window.__fitSheets=fit;if(document.readyState==='complete')fit();else window.addEventListener('load',fit);" +
    "if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);})();";

  function documentHtml(pagesHtml) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Family overview</title><style>' + CSS +
           "</style></head><body>" + pagesHtml.join("") + "<script>" + FIT + "<\/script></body></html>";
  }

  /* ---------- build: one sheet, or a stack of different ones ---------- */
  function build(o) {
    o = Object.assign({ signer: SIGNER, count: 1, connect: numberConnect }, o);
    var elig = eligibility(o.department, o.portrait, o.connect);
    if (!elig.ok) throw new Error(elig.reason);
    if (window.FAMILY_SHEET_SIGNER) o.signer = window.FAMILY_SHEET_SIGNER;
    var n = Math.max(1, Math.min(50, parseInt(o.count, 10) || 1));
    var plans = [], seen = {};
    for (var i = 0; i < n; i++) {
      var p = null;
      for (var tries = 0; tries < 60; tries++) {
        var seed = (o.seeds && o.seeds[i] != null && tries === 0) ? o.seeds[i] : Math.floor(Math.random() * 2147483648);
        p = plan(o, seed);
        p.key = variantKey(p);
        if (!seen[p.key]) break;
      }
      seen[p.key] = 1;
      plans.push(p);
    }
    var pages = plans.map(function (p) { return pageHtml(o, p); });
    return { plans: plans, pages: pages, html: documentHtml(pages), one: function (i) { return documentHtml([pages[i]]); } };
  }

  window.FamilySheet = {
    eligibility: eligibility, eligibleDepartments: eligibleDepartments, build: build,
    plan: plan, numberConnect: numberConnect, pageHtml: pageHtml, documentHtml: documentHtml, variantKey: variantKey, sheetId: sheetId, seedFromId: seedFromId, SIGNER: SIGNER
  };
})();
