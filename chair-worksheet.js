/* =====================================================================
   chair-worksheet.js  -  a one-page worksheet for each department chair

   For a department whose family sheet is not yet possible, this prints exactly
   what is missing and gives the chair room to fill it in by hand. It works from
   the live data, so a worksheet is only made for a department that still has a gap,
   and what it asks for shrinks as the gaps are filled.

   What can be missing (and what the worksheet asks):
     - portrait not written yet     finish seven started statements
     - portrait is a placeholder    keep or rewrite each of seven draft statements
     - portrait missing statements  confirm what is there, write the rest
     - portrait unfinished / not    finish it, then answer any open question
       in Westminster's order
     - not connected                a grid: which Westminster statements does each
                                    of your statements grow from?

   Load with <script src="chair-worksheet.js">. It adds window.ChairWorksheet.
   ===================================================================== */
(function () {
  "use strict";

  var RETURN_TO = { name: "Micah Gall", title: "Head of Academic Development" };

  /* The school's own opening words for the seven statements. */
  var STEMS = ["Express their \u201CLove of the Lord\u201D\u2026", "\u201CKnow God Created Them\u201D\u2026",
               "\u201CUnderstand the World\u201D\u2026", "\u201CValue Learning\u201D\u2026", "\u201CFind Joy\u201D\u2026",
               "Honor the Lord\u2026", "Cultivate their experience\u2026"];

  /* Questions the data cannot answer, asked on the worksheet. Keyed by department. */
  var QUESTIONS = {
    "Fine Arts": [{ q: "Does Visual Arts have a portrait of its own, separate from Performing Arts?",
                    opts: ["Yes. We will write one (use another copy of this page for it).",
                           "No. This portrait covers all of Fine Arts."] }]
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function westNum(code) { return parseInt(String(code).split("-").pop(), 10); }
  function isOpen(text) { return /\.\.\.|\u2026/.test(text); }
  /* print-quality punctuation: a true ellipsis and curly quotes (the school's text uses straight ones) */
  function tidy(text) { return String(text || "").replace(/\.\.\./g, "\u2026").replace(/"([^"]*)"/g, "\u201C$1\u201D"); }

  /* Are the statements simply Westminster's seven in order (1, 2, 3 ...)? Then the connections
     follow by number and only the missing ones need writing. English and Fine Arts do not. */
  function isNumbered(stmts) {
    if (!stmts.length || stmts.length > 7) return false;
    return stmts.every(function (s, i) {
      var m = String(s.code).match(/^([A-Z]+)-POG-(\d+)$/);
      return m && m[1] !== "ENG" && m[1] !== "ART" && parseInt(m[2], 10) === i + 1;
    });
  }

  /* ---------- what is missing for this department? ---------- */
  function needs(name, portrait, connect) {
    if (!portrait) return { ready: false, tasks: [], note: "" };
    var stmts = portrait.standards || [], st = portrait.status, tasks = [];
    var unconnected = stmts.filter(function (s) { return !(connect(s.code) || []).length; });
    var open = stmts.filter(function (s) { return isOpen(s.description); });

    if (st === "empty") tasks.push({ kind: "stems" });
    else if (st === "placeholder") tasks.push({ kind: "placeholder" });
    else if (st === "partial") {
      if (isNumbered(stmts)) tasks.push({ kind: "missing" });
      else { tasks.push({ kind: "finish" }); tasks.push({ kind: "connect" }); }
    } else {
      if (open.length) tasks.push({ kind: "finish" });
      if (unconnected.length) tasks.push({ kind: "connect" });
    }
    if (st === "complete" && stmts.length < 3) tasks.push({ kind: "finish" });
    return { ready: tasks.length === 0, tasks: tasks, note: portrait.partialNote || "" };
  }
  function departmentsWithGaps(portraits, connect) {
    return Object.keys(portraits).filter(function (d) { return !needs(d, portraits[d], connect).ready; });
  }

  /* ---------- pieces ---------- */
  var rule = '<div class="rule"></div>';
  function rules(n) { var o = ""; for (var i = 0; i < n; i++) o += rule; return o; }
  function box(label) { return '<span class="ck"><i class="bx"></i>' + label + "</span>"; }

  function westLeft(i, o) {
    return '<div class="wl"><span class="n">' + (i + 1) + "</span><span>" + esc(o.west.traits[i].description) + "</span></div>";
  }
  function rowWrap(inner) { return '<div class="wrow">' + inner + "</div>"; }

  function taskHead(num, title, sub) {
    return '<div class="th"><span class="tn">' + num + "</span><div><h2>" + esc(title) + "</h2>" +
           (sub ? '<div class="sub">' + sub + "</div>" : "") + "</div></div>";
  }

  function exampleStrip(o) {
    var ex = o.example;
    if (!ex) return "";
    return '<div class="ex"><span class="label">An example from ' + esc(ex.name) + "</span>" +
      '<div class="exr"><div class="exa">' + esc(ex.west) + '</div><span class="arr">\u203A</span><div class="exb">' + esc(ex.dept) + "</div></div></div>";
  }

  function taskStems(num, dept, portrait, o) {
    var rows = portrait.standards.map(function (s, i) {
      return rowWrap(westLeft(i, o) + '<div class="wr"><div class="stem">' + esc(tidy(s.description)) + "</div>" + rules(2) + "</div>");
    }).join("");
    return taskHead(num, "Finish your seven statements",
        "Write one for each Westminster statement, in the same order, finishing the opening words. Each one completes \u201C" + esc(tidy(portrait.tagline)) + "\u201D One sentence each: what does a graduate of " + esc(dept) + " do or become?") +
      exampleStrip(o) + rows;
  }

  function taskPlaceholder(num, dept, portrait, o) {
    var rows = portrait.standards.map(function (s, i) {
      return rowWrap(westLeft(i, o) + '<div class="wr"><div class="cur"><span class="tagp">Current wording \u00B7 placeholder</span>' + esc(tidy(s.description)) + "</div>" +
        '<div class="ckrow">' + box("Keep as written") + box("Change to:") + "</div>" + rules(1) + "</div>");
    }).join("");
    return taskHead(num, "Keep or rewrite these seven statements",
      "These are placeholders, not approved wording. For each one, decide whether it says what " + esc(dept) + " means, and rewrite it if not.") + rows;
  }

  function taskMissing(num, dept, portrait, o) {
    var have = portrait.standards.length, rows = "";
    portrait.standards.forEach(function (s, i) {
      rows += rowWrap(westLeft(i, o) + '<div class="wr"><div class="cur plain">' + esc(tidy(s.description)) + "</div>" +
        '<div class="ckrow">' + box("OK as written") + box("Change it to:") + "</div>" + rules(1) + "</div>");
    });
    for (var i = have; i < 7; i++) {
      rows += rowWrap(westLeft(i, o) + '<div class="wr"><div class="stem">' + esc(STEMS[i]) + "</div>" + rules(2) + "</div>");
    }
    return taskHead(num, "Write what is missing",
      "Your statements follow Westminster\u2019s in order, so they connect by number. " + (7 - have === 1 ? "One is" : (7 - have) + " are") + " still to write, completing \u201C" + esc(tidy(portrait.tagline)) + "\u201D") + exampleStrip(o) + rows;
  }

  function taskFinish(num, dept, portrait, o) {
    var list = portrait.standards.map(function (s) {
      var open = isOpen(s.description);
      return '<div class="mine' + (open ? " warn" : "") + '"><span class="code">' + esc(s.code) + "</span>" + esc(tidy(s.description)) +
        (open ? '<div class="flag">This one ends with \u201C\u2026\u201D. Please finish it:</div>' + rules(1) : "") + "</div>";
    }).join("");
    var qs = (QUESTIONS[dept] || []).map(function (q) {
      return '<div class="qa"><div class="q">' + esc(q.q) + "</div>" + q.opts.map(function (t) { return '<div class="ckl">' + box(esc(t)) + "</div>"; }).join("") + "</div>";
    }).join("");
    return taskHead(num, "Finish your portrait", "Your statements so far are below. Add any you still need.") +
      list + '<div class="more"><span class="label">More statements to add</span>' + rules(2) + "</div>" + qs;
  }

  function taskConnect(num, dept, portrait, o) {
    var stmts = portrait.standards, extra = portrait.status === "partial" ? 2 : 0;   // room for statements the chair is about to add
    var key = o.west.traits.map(function (t, i) {
      return '<div class="kr"><span class="n">' + (i + 1) + "</span><span>" + esc(t.description) + "</span></div>";
    }).join("");
    var head = '<div class="mh"><span></span>' + [1, 2, 3, 4, 5, 6, 7].map(function (n) { return '<span class="n">' + n + "</span>"; }).join("") + "</div>";
    var circs = function (code) {
      var on = o.connect(code) || [];
      return [1, 2, 3, 4, 5, 6, 7].map(function (n) { return '<span class="circ' + (on.indexOf("WCA-POG-" + n) !== -1 ? " on" : "") + '"></span>'; }).join("");
    };
    var rows = stmts.map(function (s) {
      return '<div class="mr"><div class="mt"><span class="code">' + esc(s.code) + "</span>" + esc(tidy(s.description)) + "</div>" + circs(s.code) + "</div>";
    }).join("");
    var blanks = "";
    for (var i = 0; i < extra; i++) blanks += '<div class="mr"><div class="mt"><span class="code">New statement</span><div class="rule short"></div></div>' + circs("") + "</div>";
    var gap = '<div class="gapln">Westminster statements that none of your statements grow from: <i></i> <span>(That can be right. Note why if so.)</span></div>';
    return taskHead(num, "Connect your statements to Westminster\u2019s",
        "For each of your statements, fill in the circle for every Westminster statement it grows from. One statement can grow from more than one.") +
      '<div class="key">' + key + "</div>" + '<div class="matrix">' + head + rows + blanks + "</div>" + gap;
  }

  /* ---------- one page ---------- */
  function statusChip(label, value, tone) {
    return '<div class="chip ' + tone + '"><span class="cl">' + esc(label) + '</span><span class="cv">' + esc(value) + "</span></div>";
  }

  function pageHtml(dept, o) {
    var portrait = o.portraits[dept], n = needs(dept, portrait, o.connect), stmts = portrait.standards;
    var words = { complete: "Written", partial: "Partly written", empty: "Not written yet", placeholder: "Placeholder, not approved" };
    var done = stmts.filter(function (s) { return (o.connect(s.code) || []).length; }).length;
    var portraitOk = portrait.status === "complete" && !stmts.some(function (s) { return isOpen(s.description); });
    var c2 = portrait.status === "empty" ? ["Follows once it is written", "todo"]
           : done === stmts.length && stmts.length ? ["Connected", "ok"]
           : [done + " of " + stmts.length + " connected", "todo"];
    var strip = '<div class="strip">' + statusChip("Portrait", words[portrait.status] || portrait.status, portraitOk ? "ok" : "todo") +
      statusChip("Connected to Westminster\u2019s", c2[0], c2[1]) + statusChip("Family sheet", "Not yet", "todo") + "</div>";

    var taskFns = { stems: taskStems, placeholder: taskPlaceholder, missing: taskMissing, finish: taskFinish, connect: taskConnect };
    var body = n.tasks.map(function (t, i) { return '<div class="task">' + taskFns[t.kind](i + 1, dept, portrait, o) + "</div>"; }).join("");

    var note = n.note ? '<div class="know"><span class="label">What the tool knows</span>' + esc(n.note) + "</div>" : "";
    var today = new Date(o.today || Date.now()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    var ts = dept.length > 24 ? 22 : dept.length > 15 ? 26 : 30;

    var roomy = n.tasks.length === 1 && n.tasks[0].kind !== "placeholder";   // one task: there is space to write big
    return '<div class="page' + (roomy ? " roomy" : "") + '" style="--s:1">' +
      '<div class="head"><div class="kicker">Westminster Christian Academy &middot; Chair worksheet</div>' +
      '<div class="title" style="font-size:calc(' + ts + 'pt * var(--s))">' + esc(dept) + "</div>" +
      '<div class="lead">What we need so ' + esc(dept) + " can have a one-page family overview for tours.</div></div>" +
      '<div class="why">Families on a tour take home a one-page overview of each department they are interested in. A department can have one once its portrait is written and each statement is connected to Westminster\u2019s Portrait of a Graduate. Here is what is left for ' + esc(dept) + ".</div>" +
      strip + note + body +
      '<div class="notes"><span class="label">Notes</span></div>' +
      '<div class="ret"><div class="rl">Return this page to <b>' + esc(o.returnTo.name) + "</b>, " + esc(o.returnTo.title) + '.</div>' +
      '<div class="rr">Chair <i></i> &nbsp; Date <i class="short"></i></div></div>' +
      '<div class="foot"><span class="wm">Westminster Christian Academy</span><span>Printed ' + esc(today) + "</span></div></div>";
  }

  /* ---------- CSS ---------- */
  function pt(n) { return "calc(" + n + "pt * var(--s))"; }
  var CSS = [
    ":root{--blue:#255AA8;--navy:#002E5D;--paper:#F3F8FD;--line:#CFE0F1;--muted:#4E6683;--sky:#5BC2E7;--sky-soft:#E6F6FD;--sky-line:#AEE2F6;--sky-deep:#1F6E94;--blue-soft:#EEF5FC;--blue-line:#BFD6F0;--steel:#2C5482;--steel-soft:#E3EBF5;--ink:#8AA2BF}",
    "@page{size:8.5in 11in;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#dfe8f3}",
    'body{font-family:"Avenir Next",Avenir,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--navy);-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    ".page{width:8.5in;height:11in;margin:0 auto .2in;background:#fff;position:relative;overflow:hidden;padding:.4in .5in .3in;display:flex;flex-direction:column;gap:.1in;break-after:page;page-break-after:always}",
    "@media print{html,body{background:#fff}.page{margin:0}.page:last-child{break-after:auto;page-break-after:auto}}",
    ".kicker,.label{font-size:" + pt(6.8) + ";font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--muted)}",
    ".title{font-weight:800;letter-spacing:-.025em;line-height:1;margin:.05in 0 .03in;color:var(--navy)}",
    ".lead{font-size:" + pt(10) + ";color:var(--blue);font-weight:700}",
    ".why{font-size:" + pt(7.6) + ";line-height:1.45;color:var(--muted)}",
    "h2{margin:0;font-size:" + pt(11) + ";letter-spacing:-.01em}",
    ".sub{font-size:" + pt(7.6) + ";line-height:1.42;color:var(--muted);margin-top:1px}",
    ".strip{display:grid;grid-template-columns:repeat(3,1fr);gap:.08in}",
    ".chip{border-radius:10px;padding:.05in .09in;border:1px solid;display:flex;flex-direction:column;gap:1px}.chip .cl{font-size:" + pt(6.2) + ";font-weight:700;letter-spacing:.1em;text-transform:uppercase}.chip .cv{font-size:" + pt(9) + ";font-weight:800}",
    ".chip.ok{background:var(--sky-soft);border-color:var(--sky-line);color:var(--sky-deep)}.chip.todo{background:var(--steel-soft);border-color:#C7D8EC;color:var(--steel)}",
    ".know{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:.05in .09in;font-size:" + pt(7.6) + ";line-height:1.4;color:var(--navy)}.know .label{display:block;margin-bottom:1px}",
    ".task{display:flex;flex-direction:column;gap:.05in;border-top:1px solid var(--line);padding-top:.09in}",
    ".th{display:flex;gap:.09in;align-items:flex-start}.tn{flex:none;width:.24in;height:.24in;border-radius:50%;background:var(--blue);color:#fff;font-weight:800;font-size:" + pt(8.5) + ";display:flex;align-items:center;justify-content:center}",
    ".n{flex:none;min-width:.2in;height:.2in;border-radius:99px;background:var(--navy);color:#fff;font-weight:800;font-size:" + pt(7) + ";display:inline-flex;align-items:center;justify-content:center;padding:0 .04in}",
    ".wrow{display:grid;grid-template-columns:2.35in 1fr;gap:.12in;align-items:start;padding:.03in 0;border-bottom:1px solid #E4EDF8}",
    ".wl{display:flex;gap:.06in;font-size:" + pt(7.2) + ";line-height:1.35;color:#1B3B63;background:var(--blue-soft);border:1px solid var(--blue-line);border-radius:9px;padding:.045in .07in}",
    ".stem{font-size:" + pt(8.4) + ";font-weight:800;color:var(--blue);line-height:1.3}",
    ".cur{font-size:" + pt(7.6) + ";line-height:1.35;color:#1B3B63;background:var(--paper);border-radius:8px;padding:.035in .07in}.cur.plain{background:none;padding:0}",
    ".tagp{display:block;font-size:" + pt(5.8) + ";font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--steel);margin-bottom:1px}",
    ".rule{height:.25in;border-bottom:1px solid var(--ink)}.rule.short{height:.18in;margin-top:2px}",
    ".ckrow{display:flex;gap:.18in;margin-top:3px;font-size:" + pt(7) + ";color:var(--muted)}.ck{display:inline-flex;align-items:center;gap:4px}.bx{display:inline-block;width:.13in;height:.13in;border:1.5px solid var(--ink);border-radius:3px}",
    ".ckl{margin:2px 0}",
    ".ex{background:var(--sky-soft);border:1px solid var(--sky-line);border-radius:10px;padding:.045in .09in}.ex .label{color:var(--sky-deep)}",
    ".exr{display:grid;grid-template-columns:1fr .16in 1fr;align-items:center;gap:.04in;font-size:" + pt(7) + ";line-height:1.35;margin-top:2px}.exa{color:#1B3B63}.exb{color:var(--blue);font-weight:700}.arr{color:var(--sky-deep);font-weight:800;text-align:center}",
    ".mine{font-size:" + pt(7.8) + ";line-height:1.4;padding:.03in 0;border-bottom:1px solid #E4EDF8}.mine.warn{background:#FDF6E9}.mine .flag{font-size:" + pt(7) + ";color:#8A5A08;font-weight:700;margin-top:2px}",
    ".code{display:inline-block;font-size:" + pt(6.2) + ";font-weight:800;letter-spacing:.05em;color:var(--sky-deep);margin-right:.06in}",
    ".more{padding-top:.04in}.qa{margin-top:.05in;font-size:" + pt(7.8) + ";background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:.05in .09in}.qa .q{font-weight:800;margin-bottom:2px}",
    ".key{display:grid;grid-template-columns:1fr 1fr;gap:.02in .16in;font-size:" + pt(6.8) + ";line-height:1.3;color:#1B3B63}.kr{display:flex;gap:.05in;align-items:flex-start}",
    ".matrix{border:1px solid var(--line);border-radius:10px;overflow:hidden}",
    ".mh,.mr{display:grid;grid-template-columns:1fr repeat(7,.34in);align-items:center;padding:0 .06in}.mh{background:var(--paper);height:.26in;justify-items:center}",
    ".mr{border-top:1px solid #E4EDF8;min-height:.4in;justify-items:center}.mt{justify-self:start;font-size:" + pt(7.4) + ";line-height:1.33;padding:.04in .06in .04in 0}",
    ".circ{width:.2in;height:.2in;border:1.5px solid var(--ink);border-radius:50%}.circ.on{background:var(--blue);border-color:var(--blue)}",
    ".gapln{display:flex;align-items:flex-end;gap:5px;font-size:" + pt(7.4) + ";color:var(--navy);margin-top:.04in}.gapln i{flex:1;border-bottom:1px solid var(--ink);height:.2in}.gapln span{color:var(--muted)}",
    ".roomy .rule{height:.31in}.roomy .mr{min-height:.46in}",
    ".notes{flex:1 1 0;min-height:0;border:1px solid var(--line);border-radius:10px;padding:.05in .09in;overflow:hidden;background:repeating-linear-gradient(to bottom,transparent 0,transparent .29in,#E4EDF8 .29in,#E4EDF8 calc(.29in + 1px));background-position:0 .22in}",
    ".ret{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:.2in;padding:.07in .1in;background:var(--paper);border:1px solid var(--line);border-radius:10px;font-size:" + pt(7.6) + "}.ret b{color:var(--navy)}",
    ".rr{display:flex;align-items:flex-end;gap:5px;white-space:nowrap}.rr i{display:inline-block;width:1.7in;border-bottom:1px solid var(--ink);height:.2in}.rr i.short{width:.8in}",
    ".foot{display:flex;justify-content:space-between;font-size:" + pt(6.4) + ";color:var(--muted);padding-top:.04in}.foot .wm{font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--navy)}"
  ].join("\n");

  var FIT = "(function(){function fit(){var pgs=document.querySelectorAll('.page');for(var i=0;i<pgs.length;i++){var pg=pgs[i],s=1;" +
    "var over=function(){return pg.scrollHeight>pg.clientHeight+1};" +
    "while(over()&&s>0.84){s-=0.02;pg.style.setProperty('--s',s.toFixed(2));}var nt=pg.querySelector('.notes');if(nt&&nt.clientHeight<44)nt.style.display='none';pg.setAttribute('data-fit',over()?'overflow':'ok');}}" +
    "window.__fitSheets=fit;if(document.readyState==='complete')fit();else window.addEventListener('load',fit);" +
    "if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);})();";

  function documentHtml(pages) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Chair worksheets</title><style>' + CSS +
           "</style></head><body>" + pages.join("") + "<script>" + FIT + "<\/script></body></html>";
  }

  /* ---------- build: one worksheet per department that still has a gap ---------- */
  function build(depts, o) {
    var west = o.west, portraits = o.portraits;
    var math = portraits.Mathematics;
    var example = (math && math.status === "complete" && math.standards[3]) ?
      { name: "Mathematics", west: west.traits[3].description, dept: math.standards[3].description } : null;
    o = Object.assign({ returnTo: RETURN_TO, example: example }, o);
    var names = depts.filter(function (d) { return !needs(d, portraits[d], o.connect).ready; });
    if (window.CHAIR_WORKSHEET_RETURN_TO) o.returnTo = window.CHAIR_WORKSHEET_RETURN_TO;
    var pages = names.map(function (d) { return pageHtml(d, o); });
    return { names: names, pages: pages, html: documentHtml(pages) };
  }

  window.ChairWorksheet = { needs: needs, departmentsWithGaps: departmentsWithGaps, build: build, pageHtml: pageHtml, documentHtml: documentHtml, RETURN_TO: RETURN_TO };
})();
