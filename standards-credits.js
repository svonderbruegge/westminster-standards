/* =====================================================================
   standards-credits.js

   One place for the attribution lines the standards sources require.
   Load it with a normal <script src="standards-credits.js"> tag.

   Adds to window:
     STANDARDS_CREDITS      list of { key, text, match }   (all credits, shown in the site footer)
     creditsForNotes(notes) given a list of "source note" strings (for example
                            "Based on NGSS: HS-LS1-5"), returns just the credits that apply,
                            so a printed course outline carries only the credits it needs.
   ===================================================================== */
(function () {
  "use strict";

  var credits = [
    {
      key: "CC",
      match: /Common Core/i,
      text: "Common Core State Standards \u00A9 2010 National Governors Association Center for Best Practices and Council of Chief State School Officers. All rights reserved."
    },
    {
      key: "MO",
      match: /Missouri/i,
      text: "Missouri Learning Standards, Missouri Department of Elementary and Secondary Education."
    },
    {
      key: "NGSS",
      match: /NGSS/,
      text: "NGSS Lead States. 2013. Next Generation Science Standards: For States, By States. Washington, DC: The National Academies Press. *NGSS is a registered trademark of WestEd. Neither WestEd nor the lead states and partners that developed the Next Generation Science Standards were involved in the production of this product, and do not endorse it."
    },
    {
      key: "C3",
      match: /C3/,
      text: "College, Career, and Civic Life (C3) Framework for Social Studies State Standards: Guidance for Enhancing the Rigor of K-12 Civics, Economics, Geography, and History (Silver Spring, MD: National Council for the Social Studies, 2013)."
    },
    {
      key: "NCAS",
      match: /NCAS/,
      text: "National Core Arts Standards \u00A9 2014 National Coalition for Arts Standards. Rights administered by Young Audiences, Inc. New York, NY. All rights reserved. https://www.nationalartsstandards.org"
    },
    {
      key: "LC",
      match: /Common Core|Missouri|NGSS|C3/,
      text: "Standards data provided by the Learning Commons Knowledge Graph under the CC BY 4.0 license (https://creativecommons.org/licenses/by/4.0/)."
    }
  ];

  window.STANDARDS_CREDITS = credits;

  window.creditsForNotes = function (notes) {
    var list = (notes || []).filter(function (n) { return typeof n === "string" && n; });
    return credits.filter(function (c) {
      return list.some(function (n) { return c.match.test(n); });
    });
  };
})();
