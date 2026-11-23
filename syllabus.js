/* =====================================================================
   syllabus.js  -  "Make a syllabus" for the Westminster Standards Platform

   Plain JavaScript (no Babel needed). Load it with a normal <script src="syllabus.js"> tag
   AFTER the React scripts and BEFORE the main text/babel script. It adds to window:

     window.SyllabusBuilder   React component shown on the Course Outline page
     window.SyllabusLogic     pure helper functions (used for testing)

   What it does:
     1. Once every standard in a course is submitted for approval (or approved), the outline
        shows "Make a syllabus".
     2. Claude drafts the course description, the faith integration paragraph and a short
        summary of each unit (Worker mode "draft_syllabus"). The teacher edits them and adds
        their name, room, key texts and culminating assessments.
     3. The school's class policies and academic integrity sections are filled in, in full.
        A teacher can edit them (for example, to say they do not offer extra credit) or leave
        a section out.
     4. "Download as Word" makes a .docx the teacher can edit further, upload to Canvas, or
        send home. "Copy for Canvas" copies it as formatted text for the Canvas Syllabus page.

   To change the school's policy wording for every course, edit POLICY_SECTIONS below.
   The syllabus draft is kept in this browser only (localStorage), like the pilot checklists.
   ===================================================================== */
(function () {
  "use strict";

  var h = React.createElement;
  var useState = React.useState;
  var useEffect = React.useEffect;

  /* ---------------------------------------------------------------
     The school's policy sections. Copied from the principal's syllabus format.
     A line that starts with "- " prints as a bullet. A blank line starts a new paragraph.
     --------------------------------------------------------------- */
  var POLICY_SECTIONS = [
    { group: "Class Policies", key: "culture", title: "Culture", text:
      "You will be expected to initiate and participate effectively in a range of collaborative discussions (one-on-one, in groups, and teacher-led) with different partners on topics, texts, and issues, building on others’ ideas and expressing your own clearly and persuasively. Therefore, it is important that you…\n" +
      "- Come to discussions prepared, having thoroughly read and marked the texts.\n" +
      "- Explicitly draw on that preparation by referring to evidence from texts and other research on the topic or issue to stimulate a thoughtful, well-reasoned exchange of ideas.\n" +
      "- Work with peers to promote civil discussions.\n" +
      "- Propel conversations by asking questions and responding to questions.\n" +
      "- Remain open to hearing a full range of positions on a topic or issue.\n" +
      "- Respond thoughtfully to diverse perspectives." },
    { group: "Class Policies", key: "late", title: "Late Work", text:
      "Assigned work is used to assess prior learning or prepare for future learning; therefore, timelines and due dates matter in this process. If a student is unable to complete an assignment on time:\n" +
      "- Students will receive a maximum of 50 percent (half credit) for late work that is not a major assessment.\n" +
      "- Students will receive a 10 percent reduction per day for any major assignments (as defined by the teacher) for the first five school days after the initial due date. After that, students may complete the major assignment before the end of the grading period for a maximum of 50% of the total points.\n" +
      "- Major assignments submitted late on the actual due date (a student in second hour turns in a paper after school, for example) will receive a 5 percent reduction.\n" +
      "- Conferenced paper revisions are not optional. Failure to submit a revision will result in the revision grade equaling the original conferenced paper grade minus 40 points.\n" +
      "- Teachers will communicate when assignments can no longer be completed/accepted at the end of a unit or grading period." },
    { group: "Class Policies", key: "extra", title: "Extra Credit", text:
      "Consistently completing one’s best work throughout the semester is important and offers an accurate reflection of learning. Extra credit is not offered to recover from missed learning or poor habits. Instead, limited extra credit may be offered as an enrichment opportunity at the discretion of the Department." },
    { group: "Academic Integrity", key: "community", title: "Community Standards", text:
      "As a Westminster community, we strive to live a life of integrity while valuing learning. It is essential for students to engage in the learning process and create work that represents their understanding and growth. This not only allows students to celebrate their accomplishments but helps teachers assess learning.\n\n" +
      "Independent learning and collaboration are both valuable in the classroom. There are specific times to collaborate and work together on assignments/projects; however, unless directly stated by a teacher, all assignments should be created independently and represent personal knowledge, and learning and should not be shared with other students.\n\n" +
      "Because we value learning, students should know that these actions limit the depth of learning and are not allowed:\n" +
      "- Sharing one’s work on homework, tests, or papers (outside of teacher-directed peer review).\n" +
      "- Asking for others’ work with the intention to copy all or specific portions.\n" +
      "- Turning in work that is not one’s own (plagiarism, not contributing to a group project, utilizing artificial intelligence (AI) to produce text that is not one’s own).\n" +
      "- Using extra materials that are not permitted during a test.\n" +
      "- Strategically missing a class with a test, quiz, paper, or project due." },
    { group: "Academic Integrity", key: "plagiarism", title: "Plagiarism", text:
      "Plagiarism occurs when you have stolen ideas that are not your own or lifted words, phrases, or entire sentences that you did not write. Drawing from the Modern Language Association (MLA) Handbook, plagiarism includes the following:\n" +
      "- Failure to give appropriate acknowledgment when repeating another’s wording.\n" +
      "- Paraphrasing another person’s argument and presenting it as your own.\n" +
      "- Presenting another person’s line of thinking and presenting it as your own.\n" +
      "- Utilizing artificial intelligence to produce words, phrases, full sentences, and ideas that are not your own.\n\n" +
      "When in doubt, cite your work. If you do not know how, ask your teacher for help and consult Essentials of Writing Across the Curriculum. Failure to use proper citations is plagiarism.\n\n" +
      "Turning in a paper already written for another class is self-plagiarism and is considered cheating. Even if the paper is moderately reworked, chances are you have not done enough analytical thinking and writing to qualify as a new assignment. If you would like to expand on an assignment you completed in another class, speak to your teacher.\n\n" +
      "Assistance on papers by parents, friends, tutors, or siblings is common, but it is inappropriate for these individuals to do any form of writing or rewriting of the text. Peer review, copyediting, and seeking advice on grammar, spelling, and common errors is acceptable when the student is a part of the process." }
  ];
  var POLICY_GROUPS = ["Class Policies", "Academic Integrity"];
  var STORE_PREFIX = "wca-syllabus:";

  /* ---------------------------------------------------------------
     Pure helpers
     --------------------------------------------------------------- */
  function words(s) { return String(s || "").split(/\s+/).filter(Boolean).length; }

  // The course's standards grouped the way the outline shows them: each named unit in order, then any not in a unit.
  function unitGroups(standards, unitList) {
    var list = unitList || [];
    var groups = list.map(function (u) {
      return { name: u, standards: standards.filter(function (s) { return s.unit === u; }) };
    }).filter(function (g) { return g.standards.length > 0; });
    var loose = standards.filter(function (s) { return list.indexOf(s.unit) === -1; });
    if (loose.length) groups.push({ name: list.length ? "Other standards" : "Standards", standards: loose });
    return groups;
  }

  // Ready when there is at least one standard and none is a private draft.
  function readiness(standards) {
    var priv = standards.filter(function (s) { return s.status === "draft" && !s.submitted; }).length;
    var waiting = standards.filter(function (s) { return s.status === "draft" && s.submitted; }).length;
    return { ok: standards.length > 0 && priv === 0, total: standards.length, priv: priv, waiting: waiting };
  }

  function defaultPolicies() {
    var p = {};
    POLICY_SECTIONS.forEach(function (s) { p[s.key] = { on: true, text: s.text }; });
    return p;
  }

  function emptyState() {
    return { v: 1, teachers: "", room: "", email: "", description: "", faith: "", growth: "",
             showStandards: true, ai: { description: "", faith: "", summaries: {} }, units: {}, policies: defaultPolicies() };
  }

  function unitEntry(st, name) {
    var u = st.units[name] || {};
    return { title: u.title != null ? u.title : name, summary: u.summary || "", texts: u.texts || "", assessment: u.assessment || "" };
  }

  // "Students will analyze ..." -> "analyze ...", shown under a "Students will:" line.
  function standardPhrase(text) {
    var t = String(text || "").trim();
    var m = t.match(/^students will\s+(.*)$/i);
    return m ? m[1] : t;
  }

  // Paragraphs and "- " bullets from a text box.
  function textBlocks(text) {
    var out = [];
    String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach(function (line) {
      var l = line.trim();
      if (!l) return;
      var b = l.match(/^[-•*]\s+(.*)$/);
      if (b) out.push({ t: "li", runs: [{ text: b[1] }] });
      else out.push({ t: "p", runs: [{ text: l }] });
    });
    return out;
  }

  // Everything the syllabus says, as a list of simple blocks. Word, Canvas and the preview are all made from this.
  function buildBlocks(st, ctx) {
    var B = [];
    var push = function (t, runs) { B.push({ t: t, runs: runs }); };
    push("title", [{ text: ctx.course.name }]);
    var grade = /not set/i.test(ctx.gradeLabel || "") ? "" : ctx.gradeLabel;
    var meta = [ctx.course.school, ctx.course.department, grade].filter(Boolean).join(" · ");
    if (meta) push("meta", [{ text: meta }]);
    var who = [st.teachers.trim() ? "Taught by " + st.teachers.trim() : "", st.room.trim() ? "Room " + st.room.trim() : "", st.email.trim()].filter(Boolean).join(" · ");
    if (who) push("meta", [{ text: who }]);

    push("h1", [{ text: "Course Description" }]);
    [st.description, st.faith, st.growth].forEach(function (t) { B = B.concat(textBlocks(t)); });

    if (ctx.groups.length) push("h1", [{ text: "Scope & Sequence of Units" }]);
    ctx.groups.forEach(function (g) {
      var u = unitEntry(st, g.name);
      push("h2", [{ text: u.title.trim() || g.name }]);
      B = B.concat(textBlocks(u.summary));
      if (u.texts.trim()) push("p", [{ text: "Key texts: ", b: true }, { text: u.texts.trim() }]);
      if (st.showStandards) {
        push("p", [{ text: "Students will:", b: true }]);
        g.standards.forEach(function (s) { push("li", [{ text: standardPhrase(s.description) }]); });
      }
      if (u.assessment.trim()) push("p", [{ text: "Culminating assessment: ", b: true }, { text: u.assessment.trim() }]);
    });

    POLICY_GROUPS.forEach(function (grp) {
      var secs = POLICY_SECTIONS.filter(function (s) { return s.group === grp && st.policies[s.key] && st.policies[s.key].on && st.policies[s.key].text.trim(); });
      if (!secs.length) return;
      push("h1", [{ text: grp }]);
      secs.forEach(function (s) { push("h2", [{ text: s.title }]); B = B.concat(textBlocks(st.policies[s.key].text)); });
    });
    return B;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Simple HTML that Canvas's editor keeps when pasted (headings, paragraphs, bold, bullet lists).
  function blocksToHtml(B) {
    var tag = { title: "h2", meta: "p", h1: "h3", h2: "h4", p: "p" };
    var out = [], inList = false;
    B.forEach(function (b) {
      var inner = b.runs.map(function (r) { return r.b ? "<strong>" + esc(r.text) + "</strong>" : esc(r.text); }).join("");
      if (b.t === "li") {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push("<li>" + inner + "</li>");
        return;
      }
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(b.t === "meta" ? "<p><em>" + inner + "</em></p>" : "<" + tag[b.t] + ">" + inner + "</" + tag[b.t] + ">");
    });
    if (inList) out.push("</ul>");
    return out.join("\n");
  }

  function blocksToText(B) {
    return B.map(function (b) {
      var t = b.runs.map(function (r) { return r.text; }).join("");
      if (b.t === "li") return "• " + t;
      if (b.t === "h1") return "\n" + t.toUpperCase();
      if (b.t === "h2") return "\n" + t;
      return t;
    }).join("\n").trim() + "\n";
  }

  /* ---------- Word (.docx) without any library: a few XML files in an uncompressed zip ---------- */
  function xmlEsc(s) { return esc(s).replace(/'/g, "&apos;"); }

  function docxDocument(B) {
    var style = { title: "Title", meta: "Subtitle", h1: "Heading1", h2: "Heading2", li: "ListBullet" };
    var body = B.map(function (b) {
      var pPr = style[b.t] ? '<w:pPr><w:pStyle w:val="' + style[b.t] + '"/>' + (b.t === "li" ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : "") + "</w:pPr>" : "";
      var runs = b.runs.map(function (r) {
        return "<w:r>" + (r.b ? "<w:rPr><w:b/></w:rPr>" : "") + '<w:t xml:space="preserve">' + xmlEsc(r.text) + "</w:t></w:r>";
      }).join("");
      return "<w:p>" + pPr + runs + "</w:p>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
  }

  var DOCX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3F73"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="255AA8"/></w:pBdr><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="255AA8"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3F73"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>' +
    '</w:styles>';

  var DOCX_NUMBERING = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

  function docxParts(B, title) {
    var now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    return [
      ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
      ["docProps/core.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        "<dc:title>" + xmlEsc(title) + "</dc:title><dc:creator>Westminster Christian Academy</dc:creator>" +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + "</dcterms:modified></cp:coreProperties>"],
      ["word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'],
      ["word/document.xml", docxDocument(B)],
      ["word/styles.xml", DOCX_STYLES],
      ["word/numbering.xml", DOCX_NUMBERING]
    ];
  }

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // A zip with every file stored as is (no compression). Word opens these normally.
  function makeZip(files) {
    var enc = new TextEncoder();
    var d = new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var locals = [], centrals = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f[0]), data = typeof f[1] === "string" ? enc.encode(f[1]) : f[1];
      var crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      locals.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      centrals.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = centrals.reduce(function (n, a) { return n + a.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(locals.concat(centrals, [new Uint8Array(end.buffer)]), { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  function safeName(name) { return String(name).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "course"; }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  // Copies formatted text (Canvas keeps headings, bold and bullets) with a plain-text copy alongside.
  function copyRich(html, text) {
    if (navigator.clipboard && window.ClipboardItem && navigator.clipboard.write) {
      return navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      })]).then(function () { return true; }, function () { return copyFallback(html); });
    }
    return Promise.resolve(copyFallback(html));
  }
  function copyFallback(html) {
    var div = document.createElement("div");
    div.contentEditable = "true";
    div.style.position = "fixed"; div.style.left = "-9999px"; div.style.top = "0";
    div.innerHTML = html;
    document.body.appendChild(div);
    var range = document.createRange(); range.selectNodeContents(div);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    sel.removeAllRanges(); div.remove();
    return ok;
  }

  function loadState(key) {
    try {
      var raw = localStorage.getItem(STORE_PREFIX + key);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.v !== 1) return null;
      var base = emptyState();
      Object.keys(base).forEach(function (k) { if (s[k] == null) s[k] = base[k]; });
      POLICY_SECTIONS.forEach(function (p) { if (!s.policies[p.key]) s.policies[p.key] = { on: true, text: p.text }; });
      return s;
    } catch (e) { return null; }
  }
  function saveState(key, s) { try { localStorage.setItem(STORE_PREFIX + key, JSON.stringify(s)); } catch (e) {} }
  function clearState(key) { try { localStorage.removeItem(STORE_PREFIX + key); } catch (e) {} }

  /* ---------------------------------------------------------------
     Screen
     --------------------------------------------------------------- */
  function Chip(props) {
    return h("span", { className: "ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-300 align-middle" }, props.children);
  }

  function Field(props) {
    var rows = props.rows || Math.min(14, Math.max(3, Math.ceil(String(props.value || "").length / 95) + 1));
    var isAi = props.ai != null && props.ai !== "" && props.value === props.ai;
    return h("label", { className: "block" },
      h("span", { className: "block text-sm font-semibold text-gray-800" }, props.label,
        isAi ? h(Chip, null, "Claude’s draft: read and edit") : null,
        props.busy ? h("span", { className: "ml-2 text-xs font-normal text-indigo-700 animate-pulse" }, "Claude is writing…") : null),
      props.hint ? h("span", { className: "block text-xs text-gray-500 mb-1" }, props.hint) : null,
      props.single
        ? h("input", { type: props.type || "text", value: props.value, placeholder: props.placeholder || "", onChange: function (e) { props.onChange(e.target.value); },
            className: "w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" })
        : h("textarea", { value: props.value, rows: rows, placeholder: props.placeholder || "", onChange: function (e) { props.onChange(e.target.value); },
            className: "w-full mt-1 px-3 py-2 border rounded-lg text-sm " + (isAi ? "border-purple-300 bg-purple-50/40" : "border-gray-300") }));
  }

  function SyllabusEditor(props) {
    var course = props.course, groups = props.groups, key = props.storeKey;
    var _s = useState(function () { return loadState(key) || emptyState(); }), st = _s[0], setSt = _s[1];
    var _b = useState(false), busy = _b[0], setBusy = _b[1];
    var _e = useState(""), error = _e[0], setError = _e[1];
    var _m = useState(""), msg = _m[0], setMsg = _m[1];
    var _p = useState(false), preview = _p[0], setPreview = _p[1];

    useEffect(function () { saveState(key, st); }, [st]);
    var set = function (patch) { setSt(function (prev) { return Object.assign({}, prev, patch); }); };
    var setUnit = function (name, patch) {
      setSt(function (prev) {
        var u = Object.assign({}, prev.units[name] || {}, patch);
        var units = Object.assign({}, prev.units); units[name] = u;
        return Object.assign({}, prev, { units: units });
      });
    };
    var setPolicy = function (k, patch) {
      setSt(function (prev) {
        var p = Object.assign({}, prev.policies); p[k] = Object.assign({}, p[k], patch);
        return Object.assign({}, prev, { policies: p });
      });
    };

    var draft = function () {
      setError(""); setMsg("");
      if (!props.workerUrl) { setError("The AI service isn't connected, so Claude can't draft this. You can still write it yourself below."); return; }
      setBusy(true);
      var alignCodes = {};
      props.standards.forEach(function (s) { (s.alignsTo || []).forEach(function (c) { alignCodes[c] = 1; }); });
      var portrait = (props.portrait && props.portrait.standards ? props.portrait.standards : [])
        .filter(function (p) { return alignCodes[p.code]; }).map(function (p) { return p.description; });
      var correctives = props.standards.map(function (s) {
        var c = s.learning && s.learning.corrective;
        return c && c.keep ? c.text : "";
      }).filter(Boolean);
      var body = {
        mode: "draft_syllabus", course: course.name, department: course.department, gradeLabel: props.gradeLabel,
        level: course.level || (/\(AP\)/.test(course.name) ? "AP" : ""),
        portrait: portrait, correctives: correctives,
        units: groups.map(function (g) {
          var u = unitEntry(st, g.name);
          return { name: u.title || g.name, texts: u.texts, assessment: u.assessment, standards: g.standards.map(function (s) { return s.description; }) };
        })
      };
      fetch(props.workerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (res) { return res.json().then(function (d) { if (!res.ok) throw new Error(d.error || "Request failed"); return d; }); })
        .then(function (d) {
          setSt(function (prev) {
            var units = Object.assign({}, prev.units), summaries = {};
            groups.forEach(function (g, i) {
              var s = d.units && d.units[i] ? d.units[i].summary : "";
              if (s) { summaries[g.name] = s; units[g.name] = Object.assign({}, units[g.name] || {}, { summary: s }); }
            });
            return Object.assign({}, prev, {
              description: d.description || prev.description, faith: d.faith || prev.faith, units: units,
              ai: { description: d.description || "", faith: d.faith || "", summaries: summaries }
            });
          });
          var missing = groups.filter(function (g, i) { return !(d.units && d.units[i] && d.units[i].summary); }).length;
          setMsg("Claude drafted the description, the faith integration paragraph and " + (groups.length - missing) + " of " + groups.length + " unit summaries. Read each one and make it yours." +
            (missing ? " Write the " + missing + " missing summar" + (missing === 1 ? "y" : "ies") + " yourself, or choose Draft again." : ""));
        })
        .catch(function (e) { setError("Claude couldn't draft it (" + e.message + "). Try Draft again in a moment, or write those parts yourself."); })
        .then(function () { setBusy(false); });
    };

    // Claude's draft is the starting point: draft as soon as the syllabus opens for the first time.
    useEffect(function () { if (!st.description && !st.faith && !Object.keys(st.ai.summaries).length) draft(); }, []);

    var redraft = function () {
      var edited = (st.description && st.description !== st.ai.description) || (st.faith && st.faith !== st.ai.faith) ||
        groups.some(function (g) { var s = unitEntry(st, g.name).summary; return s && s !== st.ai.summaries[g.name]; });
      if (edited && !window.confirm("Draft again? Claude will replace the course description, the faith integration paragraph and the unit summaries, including your edits to them. Your name, room, key texts, assessments and policies stay as they are.")) return;
      draft();
    };
    var startOver = function () {
      if (!window.confirm("Start over? This clears everything on this syllabus, including your edits, and Claude drafts it fresh.")) return;
      clearState(key);
      setSt(emptyState());
      setTimeout(draft, 0);
    };

    var ctx = { course: course, gradeLabel: props.gradeLabel, groups: groups };
    var blocks = buildBlocks(st, ctx);
    var html = blocksToHtml(blocks);
    var text = blocksToText(blocks);
    var total = words(text);
    var pages = Math.max(1, Math.round(total / 550));

    var toWord = function () {
      download(makeZip(docxParts(blocks, course.name + " Syllabus")), safeName(course.name) + "-syllabus.docx");
      setMsg("Downloaded " + safeName(course.name) + "-syllabus.docx. Open it in Word or Google Docs to make further changes, then upload it to Canvas or send it home.");
    };
    var toCanvas = function () {
      copyRich(html, text).then(function (ok) {
        setMsg(ok ? "Copied. In Canvas, open your course’s Syllabus page, choose Edit, click in the editor and paste. Headings, bold text and bullets come along."
                  : "Your browser would not copy it. Open the preview below, select it all, and copy it by hand.");
        if (!ok) setPreview(true);
      });
    };

    var waiting = props.ready.waiting;
    return h("div", { className: "space-y-5" },
      h("div", { className: "flex items-center gap-2 flex-wrap" },
        h("button", { type: "button", onClick: toWord, className: "px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm" }, "Download as Word"),
        h("button", { type: "button", onClick: toCanvas, className: "px-4 py-2 border border-blue-600 text-blue-700 bg-white rounded-lg hover:bg-blue-50 font-semibold text-sm" }, "Copy for Canvas"),
        h("button", { type: "button", onClick: function () { setPreview(!preview); }, "aria-expanded": preview, className: "px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50" }, preview ? "Hide preview" : "Preview"),
        h("span", { className: "text-xs text-gray-600 ml-auto" }, "About " + total.toLocaleString() + " words, roughly " + pages + " page" + (pages === 1 ? "" : "s"))),
      msg ? h("p", { role: "status", className: "text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2" }, msg) : null,
      error ? h("p", { role: "alert", className: "text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2" }, error) : null,
      waiting ? h("p", { className: "text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded px-3 py-2" },
        waiting + " of this course’s standards " + (waiting === 1 ? "is" : "are") + " still waiting for approval. They are included, but the syllabus may change if your chair sends any back.") : null,

      preview ? h("div", { className: "bg-white border border-gray-300 rounded-lg p-6 syllabus-preview", dangerouslySetInnerHTML: { __html: html } }) : null,

      h("section", { className: "space-y-3" },
        h("h4", { className: "font-bold text-gray-800" }, "Who teaches it"),
        h("div", { className: "grid gap-3 md:grid-cols-3" },
          h(Field, { single: true, label: "Teacher(s)", value: st.teachers, placeholder: "e.g., Mr. Dan Burke and Mr. Josh Yergler", onChange: function (v) { set({ teachers: v }); } }),
          h(Field, { single: true, label: "Room", value: st.room, placeholder: "e.g., B202", onChange: function (v) { set({ room: v }); } }),
          h(Field, { single: true, label: "Email (optional)", value: st.email, placeholder: "name@wcastl.org", onChange: function (v) { set({ email: v }); } }))),

      h("section", { className: "space-y-3" },
        h("div", { className: "flex items-center justify-between gap-2 flex-wrap" },
          h("h4", { className: "font-bold text-gray-800" }, "Course description"),
          h("span", { className: "flex gap-3" },
            h("button", { type: "button", onClick: redraft, disabled: busy, className: "text-sm text-indigo-800 underline disabled:text-gray-400" }, busy ? "Claude is writing…" : "Draft again with Claude"),
            h("button", { type: "button", onClick: startOver, disabled: busy, className: "text-sm text-gray-600 underline disabled:text-gray-400" }, "Start over"))),
        h(Field, { label: "What the course is about", hint: "One paragraph for parents and students. Add anything Claude couldn’t know, such as a required exam.", value: st.description, ai: st.ai.description, busy: busy, onChange: function (v) { set({ description: v }); } }),
        h(Field, { label: "Faith integration", hint: "How students discover, embrace and integrate. Drafted from your department portrait and any Corrective connections you kept.", value: st.faith, ai: st.ai.faith, busy: busy, onChange: function (v) { set({ faith: v }); } }),
        h(Field, { label: "How students grow (optional)", hint: "Say once how feedback works in your course, instead of in every unit. Leave it empty to skip it.",
          placeholder: "e.g., Students meet individually with the teacher to strengthen their essays and revise several of them for a second grade.", value: st.growth, onChange: function (v) { set({ growth: v }); } })),

      h("section", { className: "space-y-3" },
        h("div", { className: "flex items-center justify-between gap-2 flex-wrap" },
          h("h4", { className: "font-bold text-gray-800" }, "Units"),
          h("label", { className: "flex items-center gap-2 text-sm text-gray-700" },
            h("input", { type: "checkbox", checked: st.showStandards, onChange: function (e) { set({ showStandards: e.target.checked }); } }),
            "List each unit’s standards (“Students will…”)")),
        h("p", { className: "text-xs text-gray-600" }, "Units and standards come from your outline. To change a standard, change it in the outline; the syllabus follows."),
        groups.map(function (g, i) {
          var u = unitEntry(st, g.name);
          return h("div", { key: g.name, className: "border border-gray-200 rounded-lg p-4 bg-white space-y-3" },
            h(Field, { single: true, label: "Unit " + (i + 1) + " title", value: u.title, onChange: function (v) { setUnit(g.name, { title: v }); } }),
            h(Field, { label: "What we study", value: u.summary, ai: st.ai.summaries[g.name], busy: busy, rows: 3, onChange: function (v) { setUnit(g.name, { summary: v }); } }),
            h(Field, { single: true, label: "Key texts (optional)", value: u.texts, placeholder: "e.g., Unbroken by Laura Hillenbrand; Man's Search for Meaning by Viktor Frankl", onChange: function (v) { setUnit(g.name, { texts: v }); } }),
            st.showStandards ? h("div", { className: "text-sm text-gray-700" },
              h("span", { className: "font-semibold" }, "Students will:"),
              h("ul", { className: "list-disc ml-6 mt-1 space-y-0.5" }, g.standards.map(function (s) { return h("li", { key: s.id }, standardPhrase(s.description)); }))) : null,
            h(Field, { single: true, label: "Culminating assessment (optional)", value: u.assessment, placeholder: "e.g., A thesis-driven synthesis essay, revised after a conference", onChange: function (v) { setUnit(g.name, { assessment: v }); } }));
        })),

      POLICY_GROUPS.map(function (grp) {
        return h("section", { key: grp, className: "space-y-3" },
          h("h4", { className: "font-bold text-gray-800" }, grp),
          h("p", { className: "text-xs text-gray-600" }, "The school’s wording, in full. Change anything that is different in your class (for example, if you don’t offer extra credit), or untick a section to leave it out. A line that starts with “- ” prints as a bullet."),
          POLICY_SECTIONS.filter(function (p) { return p.group === grp; }).map(function (p) {
            var cur = st.policies[p.key];
            var changed = cur.text !== p.text;
            return h("div", { key: p.key, className: "border border-gray-200 rounded-lg p-4 bg-white space-y-2" },
              h("div", { className: "flex items-center gap-3 flex-wrap" },
                h("label", { className: "flex items-center gap-2 font-semibold text-sm text-gray-800" },
                  h("input", { type: "checkbox", checked: cur.on, onChange: function (e) { setPolicy(p.key, { on: e.target.checked }); } }), p.title),
                changed ? h("span", { className: "text-xs text-amber-800" }, "You changed the school’s wording.") : null,
                changed ? h("button", { type: "button", onClick: function () { setPolicy(p.key, { text: p.text }); }, className: "text-xs text-blue-700 underline" }, "Put back the school’s wording") : null),
              cur.on ? h("textarea", { value: cur.text, rows: Math.min(16, cur.text.split("\n").length + Math.ceil(cur.text.length / 160)), "aria-label": p.title,
                onChange: function (e) { setPolicy(p.key, { text: e.target.value }); },
                className: "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" }) : h("p", { className: "text-xs text-gray-500 italic" }, "Left out of this syllabus."));
          }));
      }),

      h("p", { className: "text-xs text-gray-500" }, "Your syllabus edits are kept in this browser on this computer until you choose Start over. To keep a copy anywhere else, download it."));
  }

  function SyllabusBuilder(props) {
    var _o = useState(false), open = _o[0], setOpen = _o[1];
    var standards = props.standards || [];
    var ready = readiness(standards);
    var groups = unitGroups(standards, props.unitList);
    var key = [props.course.school, props.course.department, props.course.name].join("|");
    var why = ready.total === 0 ? "Add standards to this course first. The syllabus is built from the outline."
      : ready.priv ? ready.priv + " standard" + (ready.priv === 1 ? " is a private draft" : "s are private drafts") + ". Submit " + (ready.priv === 1 ? "it" : "them") + " for approval (Browse Standards › My Drafts) and the syllabus opens."
      : "";

    return h("section", { className: "no-print bg-white rounded-lg border-2 border-blue-200 p-5 space-y-3" },
      h("div", { className: "flex items-start justify-between gap-3 flex-wrap" },
        h("div", null,
          h("h3", { className: "text-xl font-bold text-gray-800" }, "Syllabus"),
          h("p", { className: "text-sm text-gray-600 mt-1" }, "A short syllabus in the school’s format, built from this outline: Claude drafts the description, faith integration and unit summaries, you edit them, and the school’s policies are filled in. Download it for Word, or copy it into Canvas.")),
        ready.ok ? h("button", { type: "button", onClick: function () { setOpen(!open); }, "aria-expanded": open,
          className: "px-4 py-2 rounded-lg font-semibold text-sm " + (open ? "border border-gray-300 text-gray-700 hover:bg-gray-50" : "bg-blue-600 text-white hover:bg-blue-700") },
          open ? "Close the syllabus" : "Make a syllabus") : null),
      !ready.ok ? h("p", { className: "text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2" }, why) : null,
      ready.ok && open ? h(SyllabusEditor, { key: key, storeKey: key, course: props.course, gradeLabel: props.gradeLabel, portrait: props.portrait,
        standards: standards, groups: groups, workerUrl: props.workerUrl, ready: ready }) : null);
  }

  // The page's CSS reset removes heading sizes and bullets, so the preview gets its own few rules.
  (function addPreviewStyles() {
    var css = ".syllabus-preview{font-size:14px;line-height:1.5;color:#1f2937}" +
      ".syllabus-preview h2{font-size:24px;font-weight:700;color:#1F3F73;margin:0 0 4px}" +
      ".syllabus-preview h3{font-size:18px;font-weight:700;color:#255AA8;border-bottom:1px solid #255AA8;margin:20px 0 8px;padding-bottom:2px}" +
      ".syllabus-preview h4{font-size:15px;font-weight:700;color:#1F3F73;margin:14px 0 4px}" +
      ".syllabus-preview p{margin:0 0 8px}.syllabus-preview em{color:#555}" +
      ".syllabus-preview ul{list-style:disc;margin:0 0 8px 24px}.syllabus-preview li{margin:0 0 2px}";
    var el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
  })();

  window.SyllabusBuilder = SyllabusBuilder;
  window.SyllabusLogic = {
    POLICY_SECTIONS: POLICY_SECTIONS, unitGroups: unitGroups, readiness: readiness, emptyState: emptyState, buildBlocks: buildBlocks,
    blocksToHtml: blocksToHtml, blocksToText: blocksToText, docxParts: docxParts, makeZip: makeZip, crc32: crc32, standardPhrase: standardPhrase, textBlocks: textBlocks
  };
})();
