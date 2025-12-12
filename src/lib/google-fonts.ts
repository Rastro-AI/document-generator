/**
 * Popular Google Fonts for the Font Picker
 * Curated list of ~80 commonly used fonts
 */

export interface GoogleFont {
  family: string;
  category: "sans-serif" | "serif" | "display" | "handwriting" | "monospace";
  weights: string[];
}

export const GOOGLE_FONTS: GoogleFont[] = [
  // Sans-serif fonts
  { family: "Inter", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Roboto", category: "sans-serif", weights: ["400", "500", "700"] },
  { family: "Open Sans", category: "sans-serif", weights: ["400", "600", "700"] },
  { family: "Lato", category: "sans-serif", weights: ["400", "700"] },
  { family: "Montserrat", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Poppins", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Source Sans 3", category: "sans-serif", weights: ["400", "600", "700"] },
  { family: "Nunito", category: "sans-serif", weights: ["400", "600", "700"] },
  { family: "Nunito Sans", category: "sans-serif", weights: ["400", "600", "700"] },
  { family: "Raleway", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Ubuntu", category: "sans-serif", weights: ["400", "500", "700"] },
  { family: "Work Sans", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Rubik", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Noto Sans", category: "sans-serif", weights: ["400", "500", "700"] },
  { family: "Quicksand", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Mulish", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Barlow", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "DM Sans", category: "sans-serif", weights: ["400", "500", "700"] },
  { family: "Manrope", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Karla", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Cabin", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Exo 2", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Figtree", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Plus Jakarta Sans", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Space Grotesk", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Outfit", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Archivo", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Lexend", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Albert Sans", category: "sans-serif", weights: ["400", "500", "600", "700"] },
  { family: "Sora", category: "sans-serif", weights: ["400", "500", "600", "700"] },

  // Serif fonts
  { family: "Playfair Display", category: "serif", weights: ["400", "500", "600", "700"] },
  { family: "Merriweather", category: "serif", weights: ["400", "700"] },
  { family: "Lora", category: "serif", weights: ["400", "500", "600", "700"] },
  { family: "PT Serif", category: "serif", weights: ["400", "700"] },
  { family: "Libre Baskerville", category: "serif", weights: ["400", "700"] },
  { family: "Source Serif 4", category: "serif", weights: ["400", "600", "700"] },
  { family: "Crimson Text", category: "serif", weights: ["400", "600", "700"] },
  { family: "EB Garamond", category: "serif", weights: ["400", "500", "600", "700"] },
  { family: "Cormorant Garamond", category: "serif", weights: ["400", "500", "600", "700"] },
  { family: "Noto Serif", category: "serif", weights: ["400", "700"] },
  { family: "Bitter", category: "serif", weights: ["400", "500", "600", "700"] },
  { family: "Domine", category: "serif", weights: ["400", "500", "600", "700"] },
  { family: "Spectral", category: "serif", weights: ["400", "500", "600", "700"] },
  { family: "Libre Caslon Text", category: "serif", weights: ["400", "700"] },
  { family: "Cardo", category: "serif", weights: ["400", "700"] },
  { family: "Vollkorn", category: "serif", weights: ["400", "500", "600", "700"] },
  { family: "DM Serif Display", category: "serif", weights: ["400"] },
  { family: "Fraunces", category: "serif", weights: ["400", "500", "600", "700"] },

  // Display fonts
  { family: "Bebas Neue", category: "display", weights: ["400"] },
  { family: "Oswald", category: "display", weights: ["400", "500", "600", "700"] },
  { family: "Anton", category: "display", weights: ["400"] },
  { family: "Abril Fatface", category: "display", weights: ["400"] },
  { family: "Righteous", category: "display", weights: ["400"] },
  { family: "Alfa Slab One", category: "display", weights: ["400"] },
  { family: "Lobster", category: "display", weights: ["400"] },
  { family: "Permanent Marker", category: "display", weights: ["400"] },
  { family: "Archivo Black", category: "display", weights: ["400"] },
  { family: "Dela Gothic One", category: "display", weights: ["400"] },
  { family: "Big Shoulders Display", category: "display", weights: ["400", "500", "600", "700"] },
  { family: "Staatliches", category: "display", weights: ["400"] },

  // Handwriting fonts
  { family: "Dancing Script", category: "handwriting", weights: ["400", "500", "600", "700"] },
  { family: "Pacifico", category: "handwriting", weights: ["400"] },
  { family: "Caveat", category: "handwriting", weights: ["400", "500", "600", "700"] },
  { family: "Satisfy", category: "handwriting", weights: ["400"] },
  { family: "Great Vibes", category: "handwriting", weights: ["400"] },
  { family: "Sacramento", category: "handwriting", weights: ["400"] },
  { family: "Kalam", category: "handwriting", weights: ["400", "700"] },
  { family: "Shadows Into Light", category: "handwriting", weights: ["400"] },
  { family: "Indie Flower", category: "handwriting", weights: ["400"] },
  { family: "Amatic SC", category: "handwriting", weights: ["400", "700"] },

  // Monospace fonts
  { family: "Roboto Mono", category: "monospace", weights: ["400", "500", "600", "700"] },
  { family: "Source Code Pro", category: "monospace", weights: ["400", "500", "600", "700"] },
  { family: "JetBrains Mono", category: "monospace", weights: ["400", "500", "600", "700"] },
  { family: "Fira Code", category: "monospace", weights: ["400", "500", "600", "700"] },
  { family: "IBM Plex Mono", category: "monospace", weights: ["400", "500", "600", "700"] },
  { family: "Space Mono", category: "monospace", weights: ["400", "700"] },
  { family: "Inconsolata", category: "monospace", weights: ["400", "500", "600", "700"] },
  { family: "Ubuntu Mono", category: "monospace", weights: ["400", "700"] },
];

/**
 * Search fonts by name
 */
export function searchFonts(query: string): GoogleFont[] {
  if (!query.trim()) return GOOGLE_FONTS;
  const lowerQuery = query.toLowerCase();
  return GOOGLE_FONTS.filter(font =>
    font.family.toLowerCase().includes(lowerQuery) ||
    font.category.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get fonts by category
 */
export function getFontsByCategory(category: GoogleFont["category"]): GoogleFont[] {
  return GOOGLE_FONTS.filter(font => font.category === category);
}
