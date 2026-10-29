/* =====================================================================
   theme-config.js

   The Westminster look, taken from Connect Passport: pale-blue paper, white
   cards with a hairline blue edge, navy text, one blue, one sky-blue accent,
   and red only for things that need attention.

   How it works: the page is built from Tailwind utility classes like
   "bg-blue-600" and "text-gray-800". Rather than rewrite hundreds of them,
   this file changes what those names MEAN. "gray" becomes the school's
   blue-grey ramp, "blue" becomes the school's blue, and so on. Nothing in the
   page logic has to know.

   Load it right after the Tailwind script:
       <script src="https://cdn.tailwindcss.com/3.4.17"></script>
       <script src="theme-config.js"></script>

   It also works as a normal Tailwind config file (module.exports), which is how
   the preview screenshots are built.
   ===================================================================== */
(function (root) {
  "use strict";

  /* Ramps, light to dark. 600 is the "main" shade of each family. */
  var ink = {                      // was gray: neutrals, now blue-tinted
    50:  "#F3F8FD",                // the page paper
    100: "#EAF2FB",
    200: "#E1ECF8",
    300: "#CFE0F1",                // the hairline
    400: "#8AA2BF",
    500: "#4E6683",                // muted text
    600: "#3D5675",
    700: "#2A4468",
    800: "#002E5D",                // navy: headings and body text
    900: "#00244A"
  };
  var blue = {                     // the one blue
    50:  "#EEF5FC", 100: "#DDEAF8", 200: "#BFD6F0", 300: "#93B8E3", 400: "#5E92CF",
    500: "#3B74BA", 600: "#255AA8", 700: "#1D4A8C", 800: "#163A70", 900: "#002E5D"
  };
  var sky = {                      // the accent: department items and the easy button
    50:  "#EAF7FD", 100: "#D5F0FB", 200: "#AEE2F6", 300: "#7FD0F0", 400: "#5BC2E7",
    500: "#3AAAD5", 600: "#2A8FBA", 700: "#1F6E94", 800: "#175774", 900: "#0F3F57"
  };
  var steel = {                    // drafts and cautions: a calm, grey-blue
    50:  "#F1F5FA", 100: "#E3EBF5", 200: "#C7D8EC", 300: "#A9C2E0", 400: "#7FA8D4",
    500: "#5A8BC0", 600: "#44709F", 700: "#2C5482", 800: "#243F66", 900: "#1D3557"
  };
  var red = {                      // alerts only
    50:  "#FDECEC", 100: "#FAD9D8", 200: "#F3C5C2", 300: "#EBA09C", 400: "#E1706B",
    500: "#DB5752", 600: "#D64541", 700: "#B93A36", 800: "#8C2320", 900: "#6E1D1A"
  };
  var mint = {                     // approved: a quiet green-teal, distinct from sky
    50:  "#EAF7F4", 100: "#D3EFE8", 200: "#AEE0D4", 300: "#82CDBD", 400: "#55B8A4",
    500: "#34A08B", 600: "#238573", 700: "#1C6B5D", 800: "#165348", 900: "#103D35"
  };

  var ring = "0 0 0 1px #CFE0F1";   // a hairline drawn as a shadow, so a card keeps its size

  var config = {
    theme: {
      extend: {
        colors: {
          gray: ink, slate: ink, zinc: ink,
          blue: blue, indigo: blue,
          purple: sky, violet: sky, pink: sky,
          yellow: steel, amber: steel, orange: steel,
          red: red,
          green: mint, emerald: mint, teal: mint
        },
        fontFamily: {
          sans: ['"Avenir Next"', "Avenir", "-apple-system", '"Segoe UI"', "Roboto", "Helvetica", "Arial", "sans-serif"]
        },
        borderRadius: {
          DEFAULT: "10px", md: "10px", lg: "14px", xl: "18px", "2xl": "22px"
        },
        boxShadow: {
          DEFAULT: ring, sm: ring, md: ring,
          lg: ring + ", 0 14px 34px rgba(22,35,59,.10)",
          xl: ring + ", 0 18px 44px rgba(22,35,59,.14)"
        }
      }
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = config;
  else if (root.tailwind) root.tailwind.config = config;
})(typeof window !== "undefined" ? window : this);
