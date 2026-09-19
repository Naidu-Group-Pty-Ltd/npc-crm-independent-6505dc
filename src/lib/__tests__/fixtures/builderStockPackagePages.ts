/**
 * Builder stock — the page text of the builder's OWN package covers, verbatim.
 *
 * Every string here was extracted from a document in the live "Complete Package
 * Pack" Drive libraries the stock rows link to. They are fixtures rather than
 * paraphrases because the defect they pin is entirely about WORDING: the rule
 * they exercise refused twenty-five live properties for the difference between
 * "Tweed Heads South NSW 2486" in the stock list and "Tweed Heads NSW" on the
 * builder's own cover for the same house.
 *
 * Two things in here look like mistakes and are not. The letter-spaced heading
 * — "L O T 5 1 · S A N D P I P E R  E S T A T E" — is what PDF extraction
 * returns for tracked type, and it is why a matcher cannot rely on the heading
 * alone. And `covella_lot914` is the EMPTY STRING: that document is three pages
 * of designed brochure exported as images, and its every page yields no text at
 * all. It is here so a reader that learns nothing is never mistaken for a
 * document that says nothing.
 */

/** Page 1 of "Lot 51 - Miami 190 - Property Package.pdf". */
export const LOT_51_MIAMI_190_PAGE_1 = "PROPLAUNCH\nL O T 5 1 · S A N D P I P E R E S T A T E\nFour bedroom home, 190 m².\nFixed price. Fully turnkey.\nLot 51, Sandpiper Estate, Tweed Heads NSW · Miami 190, Spectral façade · 623 m² lot,\nregistering Q1 2027 · Four bedrooms, two bathrooms, study nook, walk-in pantry, under-\nroof alfresco and a double garage. Full turnkey specification listed in the accompanying\nSandpiper Estate Inclusions — Single Dwelling document.\nT O T A L P A C K A G E · L A N D + B U I L D · I N C . G S T\n$1,386,407\nLand $839,000\nBuild $547,407\nRental appraisal $1,250–$1,300 /wk\nFixed price site costs included\nL A N D\n623 m²\nT O T A L H O M E\n190 m²\nB E D / B A T H\n4 / 2\nG A R A G E\n2\nE S T A T E · L O C A T I O N\nSandpiper Estate · Tweed Heads\nNSW\nR E G I S T R A T I O N\nQ1 2027\nD E S I G N · F A Ç A D E\nMiami 190 · Spectral\nA R T I S T I M P R E S S I O N O N L Y\n0 1 / 0 7\nF I X E D P R I C E , F I X E D S I T E C O S T S\n";

/** Page 1 of "Lot 51 - Miami 196 - Property Package.pdf" — same lot, next design. */
export const LOT_51_MIAMI_196_PAGE_1 = "PROPLAUNCH\nL O T 5 1 · S A N D P I P E R E S T A T E\nFour bedroom home, 197 m².\nFixed price. Fully turnkey.\nLot 51, Sandpiper Estate, Tweed Heads NSW · Miami 196, Spectral façade · 623 m² lot,\nregistering Q1 2027 · Four bedrooms plus a separate lounge and study, two bathrooms,\nwalk-in pantry, under-roof alfresco and a double garage. Full turnkey specification listed in\nthe accompanying Sandpiper Estate Inclusions — Single Dwelling document.\nT O T A L P A C K A G E · L A N D + B U I L D · I N C . G S T\n$1,401,306\nLand $839,000\nBuild $562,306\nRental appraisal $1,300–$1,350 /wk\nFixed price site costs included\nL A N D\n623 m²\nT O T A L H O M E\n197 m²\nB E D / B A T H\n4 / 2\nG A R A G E\n2\nE S T A T E · L O C A T I O N\nSandpiper Estate · Tweed Heads\nNSW\nR E G I S T R A T I O N\nQ1 2027\nD E S I G N · F A Ç A D E\nMiami 196 · Spectral\nA R T I S T I M P R E S S I O N O N L Y\n0 1 / 0 7\nF I X E D P R I C E , F I X E D S I T E C O S T S\n";

/** Page 1 of "Lot 52 - Miami 190 - Property Package.pdf" — same design, next lot. */
export const LOT_52_MIAMI_190_PAGE_1 = "PROPLAUNCH\nL O T 5 2 · S A N D P I P E R E S T A T E\nFour bedroom home, 190 m².\nFixed price. Fully turnkey.\nLot 52, Sandpiper Estate, Tweed Heads NSW · Miami 190, Spectral façade · 623 m² lot,\nregistering Q1 2027 · Four bedrooms, two bathrooms, study nook, walk-in pantry, under-\nroof alfresco and a double garage. Full turnkey specification listed in the accompanying\nSandpiper Estate Inclusions — Single Dwelling document.\nT O T A L P A C K A G E · L A N D + B U I L D · I N C . G S T\n$1,386,407\nLand $839,000\nBuild $547,407\nRental appraisal $1,250–$1,300 /wk\nFixed price site costs included\nL A N D\n623 m²\nT O T A L H O M E\n190 m²\nB E D / B A T H\n4 / 2\nG A R A G E\n2\nE S T A T E · L O C A T I O N\nSandpiper Estate · Tweed Heads\nNSW\nR E G I S T R A T I O N\nQ1 2027\nD E S I G N · F A Ç A D E\nMiami 190 · Spectral\nA R T I S T I M P R E S S I O N O N L Y\n0 1 / 0 7\nF I X E D P R I C E , F I X E D S I T E C O S T S\n";

/** Page 1 of "LOT 914 • COVELLA • GREENBANK QLD.pdf". Drawn, not set. */
/**
 * And Lot 51's BISHOP 258, whose stock row reads "[Bishop 258 Dual Occ]".
 *
 * The row's word for how the house is held is "Dual Occ". The builder's is
 * "Dual key home" and "DUAL KEY · TWO DWELLINGS, TWO INCOMES", and the file is
 * "Lot 51 - Bishop 258 - Property Package.pdf". The two spellings share no
 * token, and the letters "occ" appear nowhere on the page — which is what
 * refused this cover and eighteen like it.
 */
export const LOT_51_BISHOP_258_PAGE_1 = "PROPLAUNCH L O T 5 1 \u00b7 S A N D P I P E R E S T A T E\nDual key home, 4 + 2.\nFixed price. Fully turnkey.\nLot 51, Sandpiper Estate, Tweed Heads NSW \u00b7 Bishop 258, Mira fa\u00e7ade \u00b7 623 m\u00b2 lot,\nregistering Q1 2027 \u00b7 A four bedroom primary dwelling and a self-contained two bedroom\nsecondary dwelling side by side under one roof, each with its own entry, kitchen, laundry,\ngarage and alfresco. Full turnkey specification listed in the accompanying Sandpiper\nEstate Inclusions \u2014 Primary & Secondary Dwellings document.\nT O T A L P A C K A G E \u00b7 L A N D + B U I L D \u00b7 I N C . G S T\n$1,556,964\nLand $839,000\nBuild $717,964\nRental appraisal $1,900\u2013$2,000 /wk combined\nFixed price site costs included\nL A N D\n623m\u00b2\nT O T A L H O M E\n258m\u00b2\nP R I M A R Y\n165m\u00b2\nS E C O N D A R Y\n93m\u00b2\nE S T A T E \u00b7 R E G I S T R A T I O N\nSandpiper Estate \u00b7 Q1 2027\nB E D / B A T H / C A R\n6 / 3 / 2\nD E S I G N \u00b7 F A \u00c7 A D E\nBishop 258 \u00b7 Mira\nA R T I S T I M P R E S S I O N O N L Y 0 1 / 0 7\nD U A L K E Y \u00b7 T W O D W E L L I N G S , T W O I N C O M E S";

export const COVELLA_LOT_914_PAGE_1 = "";

/** The stock list's own wording for those rows, verbatim from `address_line`. */
export const SANDPIPER_ADDRESS =
  'Tringa Street, Sandpiper Estate, Tweed Heads South NSW 2486';
export const COVELLA_ADDRESS = 'Lot 914 - Covella Estate, Greenbank QLD 4124';
