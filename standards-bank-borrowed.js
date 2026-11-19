/* =====================================================================
   standards-bank-borrowed.js  -  banks for departments that have no published standards of their own

   STEM and Business & Communications have no state or national standards in the Learning Commons
   Knowledge Graph (checked 2026-11-18: it holds math, English, social studies and science only).
   This file builds a bank for each one by BORROWING the rows that fit from the banks already loaded,
   the way Pathways borrows the English bank. Nothing is copied by hand except the eight NGSS
   engineering design standards below, which are added in case the Science bank does not already have them.

   Load AFTER every standards-bank*.js file and BEFORE easy-button.js. It sets:
     window.STANDARDS_BANK_STEM       department "STEM"
     window.STANDARDS_BANK_BUSINESS   department "Business & Communications"
   Each row keeps its original source key (CC, MO, NGSS, C3) and code, so credits and "Based on ..." notes
   read exactly as they do in the original bank. Row format: [source, code, grades, statement].

   To change what a department borrows, edit the BORROW lists at the bottom.
   ===================================================================== */
(function () {
  "use strict";

  // NGSS engineering design performance expectations (Learning Commons Knowledge Graph, pulled 2026-11-18).
  var ETS = [
    ["NGSS", "MS-ETS1-1", "6-8", "Define the criteria and constraints of a design problem with sufficient precision to ensure a successful solution, taking into account relevant scientific principles and potential impacts on people and the natural environment that may limit possible solutions."],
    ["NGSS", "MS-ETS1-2", "6-8", "Evaluate competing design solutions using a systematic process to determine how well they meet the criteria and constraints of the problem."],
    ["NGSS", "MS-ETS1-3", "6-8", "Analyze data from tests to determine similarities and differences among several design solutions to identify the best characteristics of each that can be combined into a new solution to better meet the criteria for success."],
    ["NGSS", "MS-ETS1-4", "6-8", "Develop a model to generate data for iterative testing and modification of a proposed object, tool, or process such that an optimal design can be achieved."],
    ["NGSS", "HS-ETS1-1", "9-12", "Analyze a major global challenge to specify qualitative and quantitative criteria and constraints for solutions that account for societal needs and wants."],
    ["NGSS", "HS-ETS1-2", "9-12", "Design a solution to a complex real-world problem by breaking it down into smaller, more manageable problems that can be solved through engineering."],
    ["NGSS", "HS-ETS1-3", "9-12", "Evaluate a solution to a complex real-world problem based on prioritized criteria and trade-offs that account for a range of constraints, including cost, safety, reliability, and aesthetics as well as possible social, cultural, and environmental impacts."],
    ["NGSS", "HS-ETS1-4", "9-12", "Use a computer simulation to model the impact of proposed solutions to a complex real-world problem with numerous criteria and constraints on interactions within and between systems relevant to the problem."]
  ];
  var ETS_SOURCE = { rows: ETS, sources: { NGSS: "NGSS" }, hideClusters: false,
                     credits: { NGSS: "NGSS is a registered trademark of WestEd. Neither WestEd nor the lead states and partners that developed the Next Generation Science Standards were involved in the production of this product, and do not endorse it." } };

  var NAMES = { CC: "Common Core", MO: "Missouri Learning Standards", NGSS: "NGSS", C3: "C3 Framework" };

  // A code segment such as W in "W.9-10.2" or "9-10.W.1.A", or LS1 in "HS-LS1-1" or "9-12.LS1.A.1".
  function seg(letters) { return new RegExp("(^|[.\\-])(" + letters + ")(?=[.\\-]|$)"); }

  // Rows from one bank whose code passes the test. Headings and fragments are left out, and so are the math
  // bank's unit-level cluster headings (codes ending in .A, .B), since the new bank shows every row it holds.
  function take(bank, test) {
    if (!bank || !Array.isArray(bank.rows)) return [];
    return bank.rows.filter(function (r) {
      var code = String(r[1] || ""), text = String(r[3] || "");
      if (text.length < 25) return false;
      if (bank.hideClusters !== false && /\.[A-Z]$/.test(code)) return false;
      return test(code, r);
    });
  }

  function build(department, subject, scopeNote, parts) {
    var rows = [], seen = {}, sources = {}, credits = {};
    parts.forEach(function (p) {
      take(p.bank, p.test).forEach(function (r) {
        var key = r[0] + "|" + r[1];
        if (seen[key]) return;                       // the same standard from two places is kept once
        seen[key] = true;
        rows.push(r);
        sources[r[0]] = NAMES[r[0]] || (p.bank.sources && p.bank.sources[r[0]]) || r[0];
        var c = p.bank.credits && p.bank.credits[r[0]];
        if (c && (credits[r[0]] || "").indexOf(c) === -1) credits[r[0]] = credits[r[0]] ? credits[r[0]] + " " + c : c;
      });
    });
    return {
      subject: subject, department: department, borrowed: true,
      sources: sources, tabLabels: Object.assign({}, sources), credits: credits,
      rows: rows, gradeFilter: true, hideClusters: false, scopeNote: scopeNote
    };
  }

  var MATH = window.STANDARDS_BANK, ENGLISH = window.STANDARDS_BANK_ENGLISH,
      HISTORY = window.STANDARDS_BANK_HISTORY, SCIENCE = window.STANDARDS_BANK_SCIENCE;

  // ---- STEM ----
  window.STANDARDS_BANK_STEM = build("STEM", "STEM",
    "STEM has no published standards of its own yet, so these are borrowed: NGSS engineering design, Common Core reading and writing for science and technical subjects, human body systems from Science (for Healthcare Exploration), and math modeling, 3-D geometry and units from Mathematics (for CAD, Robotics and Engineering). There are no computer science standards in the bank yet.",
    [
      { bank: ETS_SOURCE, test: function () { return true; } },
      { bank: SCIENCE, test: function (code) { return /ETS1/.test(code) || /^(RST|WHST)/.test(code) || seg("LS1").test(code); } },
      { bank: MATH, test: function (code) { return /^(HSG-MG|HSG-GMD|HSN-Q)/.test(code); } }
    ]);

  // ---- Business & Communications ----
  window.STANDARDS_BANK_BUSINESS = build("Business & Communications", "Business & Communications",
    "Business & Communications has no published standards of its own yet, so these are borrowed: C3 Framework economics (from History & Social Studies), financial math from Mathematics (exponential growth and geometric series), and writing, speaking and listening, and language standards from English (for the journalism and video courses). There are no personal finance, marketing or entrepreneurship standards in the bank yet.",
    [
      { bank: HISTORY, test: function (code, r) { return r[0] === "C3" && /(^|[^A-Za-z0-9])D2\.Eco/.test(code); } },
      { bank: MATH, test: function (code) { return /^(HSF-LE|HSA-SSE\.B\.3\.c|HSA-SSE\.B\.4)/.test(code); } },
      { bank: ENGLISH, test: function (code) { return seg("W|SL|L").test(code); } }
    ]);
})();
