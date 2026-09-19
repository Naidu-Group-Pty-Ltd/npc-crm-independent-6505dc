/**
 * Investment Compass colourways — GENERATED, do not hand-edit.
 *
 * Emitted by `scripts/template-library/investmentCompass/generate.ts` from
 * `source.json`, which is a verbatim evaluation of `COLOURWAYS` in the
 * approved Claude Design catalogue. Its own key order is declared there as
 * `CW_KEYS = ['colourway','paper','ink','accent','rule','muted','ground']`.
 *
 * Every value here is a design decision taken in Claude Design. Editing one to
 * fix a contrast problem is a design change made by an engineer — take it to
 * the Design source instead. `investmentCompassSource.spec.ts` compares this
 * file against `source.json` and fails if they disagree.
 *
 * The derivations that turn these six values into every colour role a block can
 * address live in `templateColourways.pure.ts`.
 */
/* eslint-disable no-restricted-syntax --
 * Token DEFINITIONS. These hexes are what `token:*` resolves to; see the
 * contract note in templateColourways.pure.ts.
 */
import type { ApprovedColourway } from './templateColourways.pure.ts';

/**
 * 01 — Private Banking. Gold on obsidian, editorial ledger, restrained accent.
 *
 * 6 light grounds and 4 dark. Index 0 is the family default.
 */
export const PRIVATE_BANKING_COLOURWAYS: readonly ApprovedColourway[] = [
  { id: 'pb-gold-on-obsidian', name: 'Gold on Obsidian', paper: '#FAF7EF', ink: '#251F18', accent: '#8E6C15', rule: '#DDD1C0', muted: '#6E6253', ground: 'light' },
  { id: 'pb-oxblood', name: 'Oxblood', paper: '#FAF7EF', ink: '#241819', accent: '#7B2230', rule: '#DED0CE', muted: '#6E5A5C', ground: 'light' },
  { id: 'pb-verde', name: 'Verde', paper: '#F7F6EF', ink: '#1C241D', accent: '#2F5D45', rule: '#D5DCD3', muted: '#64705F', ground: 'light' },
  { id: 'pb-navy-signet', name: 'Navy Signet', paper: '#F8F8F4', ink: '#1B2130', accent: '#22406E', rule: '#D8DCE2', muted: '#636A76', ground: 'light' },
  { id: 'pb-slate-bronze', name: 'Slate Bronze', paper: '#F6F5F2', ink: '#23211E', accent: '#8A6A3A', rule: '#DBD8D1', muted: '#6B675F', ground: 'light' },
  { id: 'pb-platinum', name: 'Platinum', paper: '#F7F7F5', ink: '#1E1E1C', accent: '#4A4A46', rule: '#DCDCD8', muted: '#6A6A66', ground: 'light' },
  { id: 'pb-obsidian-reverse', name: 'Obsidian Reverse', paper: '#1E1A15', ink: '#F2EBDE', accent: '#D9A520', rule: '#3A332A', muted: '#A2957F', ground: 'dark' },
  { id: 'pb-oxblood-night', name: 'Oxblood Night', paper: '#1C1416', ink: '#F0E6E4', accent: '#C0565F', rule: '#332628', muted: '#A2908E', ground: 'dark' },
  { id: 'pb-deep-verde', name: 'Deep Verde', paper: '#141A16', ink: '#E8EFE8', accent: '#6FA98A', rule: '#26302A', muted: '#92A196', ground: 'dark' },
  { id: 'pb-midnight-navy', name: 'Midnight Navy', paper: '#131720', ink: '#E9EDF4', accent: '#7FA3D8', rule: '#262C38', muted: '#93A0B2', ground: 'dark' },
];

/**
 * 02 — Institutional Research. Numbered exhibits, masthead, coverage-note discipline.
 *
 * 6 light grounds and 4 dark. Index 0 is the family default.
 */
export const INSTITUTIONAL_RESEARCH_COLOURWAYS: readonly ApprovedColourway[] = [
  { id: 'ir-research-blue', name: 'Research Blue', paper: '#FFFDFA', ink: '#24211C', accent: '#0270A7', rule: '#DDD1C0', muted: '#6E6253', ground: 'light' },
  { id: 'ir-graphite', name: 'Graphite', paper: '#FCFCFB', ink: '#1F2225', accent: '#3F4A52', rule: '#DCDDDE', muted: '#666E74', ground: 'light' },
  { id: 'ir-ink-and-rust', name: 'Ink and Rust', paper: '#FFFDF8', ink: '#221F1B', accent: '#A34A19', rule: '#E0D6C8', muted: '#6F6357', ground: 'light' },
  { id: 'ir-bureau-green', name: 'Bureau Green', paper: '#FBFCFA', ink: '#1D231E', accent: '#2C6E49', rule: '#D9DFD9', muted: '#646E66', ground: 'light' },
  { id: 'ir-oxford', name: 'Oxford', paper: '#FAFAFC', ink: '#1A1D2A', accent: '#2A3A7C', rule: '#D9DBE4', muted: '#656977', ground: 'light' },
  { id: 'ir-neutral-press', name: 'Neutral Press', paper: '#FCFCFC', ink: '#202020', accent: '#202020', rule: '#DCDCDC', muted: '#6C6C6C', ground: 'light' },
  { id: 'ir-terminal-blue', name: 'Terminal Blue', paper: '#12161A', ink: '#EAEFF3', accent: '#4FA8DA', rule: '#2A323A', muted: '#93A2AE', ground: 'dark' },
  { id: 'ir-slate-console', name: 'Slate Console', paper: '#16181A', ink: '#ECEDEE', accent: '#9AA7B0', rule: '#2C3033', muted: '#8F9599', ground: 'dark' },
  { id: 'ir-rust-console', name: 'Rust Console', paper: '#191512', ink: '#F0E9E3', accent: '#D0703C', rule: '#302823', muted: '#A2938A', ground: 'dark' },
  { id: 'ir-oxford-night', name: 'Oxford Night', paper: '#12141C', ink: '#E9EAF2', accent: '#7C8FE0', rule: '#262936', muted: '#9094A8', ground: 'dark' },
];

/**
 * 03 — Luxury Editorial. Serif throughout, photographic plates, justified columns.
 *
 * 6 light grounds and 4 dark. Index 0 is the family default.
 */
export const LUXURY_EDITORIAL_COLOURWAYS: readonly ApprovedColourway[] = [
  { id: 'le-ivory-and-gold', name: 'Ivory and Gold', paper: '#FAF7EF', ink: '#312A21', accent: '#8E6C15', rule: '#DDD1C0', muted: '#6E6253', ground: 'light' },
  { id: 'le-bone-and-ink', name: 'Bone and Ink', paper: '#F6F4EE', ink: '#1A1A18', accent: '#1A1A18', rule: '#DCD9D0', muted: '#6B6862', ground: 'light' },
  { id: 'le-blush-stone', name: 'Blush Stone', paper: '#F7F1EC', ink: '#2B211D', accent: '#9A5B4C', rule: '#E2D5CD', muted: '#74615A', ground: 'light' },
  { id: 'le-sage-vellum', name: 'Sage Vellum', paper: '#F5F5EE', ink: '#23271F', accent: '#5A6E4A', rule: '#D8DCD0', muted: '#6A7060', ground: 'light' },
  { id: 'le-cerulean-rag', name: 'Cerulean Rag', paper: '#F5F7F8', ink: '#1F262B', accent: '#3A6E86', rule: '#D6DDE1', muted: '#66717A', ground: 'light' },
  { id: 'le-plum-ash', name: 'Plum Ash', paper: '#F7F3F5', ink: '#241D24', accent: '#6E3A5C', rule: '#E0D5DB', muted: '#6E6069', ground: 'light' },
  { id: 'le-midnight-editorial', name: 'Midnight Editorial', paper: '#14141A', ink: '#F1EEE8', accent: '#C9A227', rule: '#2E2E38', muted: '#9C99A4', ground: 'dark' },
  { id: 'le-ink-plate', name: 'Ink Plate', paper: '#171614', ink: '#F2EFE8', accent: '#E4DED2', rule: '#2E2C28', muted: '#A09B92', ground: 'dark' },
  { id: 'le-rose-noir', name: 'Rose Noir', paper: '#1A1416', ink: '#F3E9EA', accent: '#C77F8C', rule: '#322629', muted: '#A6939A', ground: 'dark' },
  { id: 'le-sage-noir', name: 'Sage Noir', paper: '#14170F', ink: '#EDF0E4', accent: '#9BB57C', rule: '#2A2E22', muted: '#979E8A', ground: 'dark' },
];

/**
 * 04 — Modern Fintech. Inter, dark data ribbon, chips and tabs, violet accent.
 *
 * 6 light grounds and 4 dark. Index 0 is the family default.
 */
export const MODERN_FINTECH_COLOURWAYS: readonly ApprovedColourway[] = [
  { id: 'mf-violet-signal', name: 'Violet Signal', paper: '#FFFFFF', ink: '#17151F', accent: '#5B4BD6', rule: '#E4E2EC', muted: '#6C6980', ground: 'light' },
  { id: 'mf-teal-signal', name: 'Teal Signal', paper: '#FFFFFF', ink: '#10201F', accent: '#0F857A', rule: '#DCE7E5', muted: '#5E7472', ground: 'light' },
  { id: 'mf-amber-signal', name: 'Amber Signal', paper: '#FFFDFA', ink: '#1E1A14', accent: '#B87308', rule: '#E8DFD0', muted: '#7A6E5C', ground: 'light' },
  { id: 'mf-indigo-signal', name: 'Indigo Signal', paper: '#FFFFFF', ink: '#141A26', accent: '#2B4ED8', rule: '#DEE3EE', muted: '#67707F', ground: 'light' },
  { id: 'mf-coral-signal', name: 'Coral Signal', paper: '#FFFDFC', ink: '#201618', accent: '#D2405A', rule: '#EDDEE1', muted: '#7A6A6E', ground: 'light' },
  { id: 'mf-mint-signal', name: 'Mint Signal', paper: '#FCFFFD', ink: '#101E18', accent: '#0E8A57', rule: '#DAE8E1', muted: '#5F736A', ground: 'light' },
  { id: 'mf-night-console', name: 'Night Console', paper: '#101116', ink: '#F0F1F5', accent: '#7C6CF0', rule: '#262833', muted: '#9A9BAA', ground: 'dark' },
  { id: 'mf-teal-console', name: 'Teal Console', paper: '#0E1615', ink: '#E9F2F0', accent: '#2BB3A3', rule: '#232E2C', muted: '#8FA09D', ground: 'dark' },
  { id: 'mf-amber-console', name: 'Amber Console', paper: '#16130E', ink: '#F2ECE1', accent: '#E0A030', rule: '#2C2721', muted: '#A69A88', ground: 'dark' },
  { id: 'mf-coral-console', name: 'Coral Console', paper: '#16100F', ink: '#F4E9E8', accent: '#F0665F', rule: '#2E2422', muted: '#A8938F', ground: 'dark' },
];

/**
 * 05 — Architectural Property. Lato light, monochrome, measured drawings and schedules.
 *
 * 6 light grounds and 4 dark. Index 0 is the family default.
 */
export const ARCHITECTURAL_PROPERTY_COLOURWAYS: readonly ApprovedColourway[] = [
  { id: 'ap-concrete', name: 'Concrete', paper: '#F7F6F3', ink: '#2B2B2B', accent: '#2B2B2B', rule: '#DCDAD4', muted: '#6D6C67', ground: 'light' },
  { id: 'ap-blueprint', name: 'Blueprint', paper: '#F4F6F8', ink: '#1F2A33', accent: '#2E5C8A', rule: '#D6DDE4', muted: '#62707C', ground: 'light' },
  { id: 'ap-terracotta', name: 'Terracotta', paper: '#F8F5F1', ink: '#2A2320', accent: '#A75A3A', rule: '#E0D6CD', muted: '#756860', ground: 'light' },
  { id: 'ap-limewash', name: 'Limewash', paper: '#F7F6F0', ink: '#262620', accent: '#7A7A5E', rule: '#DCDACD', muted: '#6E6E60', ground: 'light' },
  { id: 'ap-zinc', name: 'Zinc', paper: '#F5F6F7', ink: '#23262A', accent: '#4E5A64', rule: '#D9DCDF', muted: '#686F76', ground: 'light' },
  { id: 'ap-ochre-board', name: 'Ochre Board', paper: '#F8F6EE', ink: '#262117', accent: '#96751B', rule: '#DED7C4', muted: '#6F6857', ground: 'light' },
  { id: 'ap-charcoal-set', name: 'Charcoal Set', paper: '#1C1C1B', ink: '#EFEEEA', accent: '#C9C5BC', rule: '#333331', muted: '#97948C', ground: 'dark' },
  { id: 'ap-blueprint-night', name: 'Blueprint Night', paper: '#121820', ink: '#E8EEF4', accent: '#6C9CC8', rule: '#252D36', muted: '#8E99A4', ground: 'dark' },
  { id: 'ap-terracotta-night', name: 'Terracotta Night', paper: '#1A1412', ink: '#F1E7E1', accent: '#C87A55', rule: '#302623', muted: '#A4938B', ground: 'dark' },
  { id: 'ap-bronze-set', name: 'Bronze Set', paper: '#17150F', ink: '#EFEBDF', accent: '#B99A55', rule: '#2D2A20', muted: '#9E9787', ground: 'dark' },
];

/**
 * 06 — Swiss Minimal. Strict grid, flat blocks, single red accent, no ornament.
 *
 * 6 light grounds and 4 dark. Index 0 is the family default.
 */
export const SWISS_MINIMAL_COLOURWAYS: readonly ApprovedColourway[] = [
  { id: 'sm-red-accent', name: 'Red Accent', paper: '#F4F4F4', ink: '#111111', accent: '#D31212', rule: '#DCDCDC', muted: '#6B6B6B', ground: 'light' },
  { id: 'sm-ultramarine', name: 'Ultramarine', paper: '#F4F5F7', ink: '#101114', accent: '#1B3FD8', rule: '#DADCE0', muted: '#686A70', ground: 'light' },
  { id: 'sm-black-only', name: 'Black Only', paper: '#F2F2F2', ink: '#0D0D0D', accent: '#0D0D0D', rule: '#DADADA', muted: '#6A6A6A', ground: 'light' },
  { id: 'sm-signal-orange', name: 'Signal Orange', paper: '#F5F4F2', ink: '#131211', accent: '#E2560D', rule: '#DEDBD6', muted: '#6D6A65', ground: 'light' },
  { id: 'sm-swiss-green', name: 'Swiss Green', paper: '#F3F5F3', ink: '#0F1310', accent: '#12764A', rule: '#D8DDD9', muted: '#676D69', ground: 'light' },
  { id: 'sm-cobalt-grey', name: 'Cobalt Grey', paper: '#F3F4F6', ink: '#14161A', accent: '#3A63B8', rule: '#D9DBE0', muted: '#676A72', ground: 'light' },
  { id: 'sm-inverse', name: 'Inverse', paper: '#121212', ink: '#F5F5F5', accent: '#FF4A3D', rule: '#2C2C2C', muted: '#9A9A9A', ground: 'dark' },
  { id: 'sm-ultramarine-inverse', name: 'Ultramarine Inverse', paper: '#101218', ink: '#F0F2F7', accent: '#6E8CF5', rule: '#262A33', muted: '#93979F', ground: 'dark' },
  { id: 'sm-green-inverse', name: 'Green Inverse', paper: '#0F1311', ink: '#EFF4F0', accent: '#3FBF83', rule: '#242A26', muted: '#939A95', ground: 'dark' },
  { id: 'sm-mono-inverse', name: 'Mono Inverse', paper: '#121212', ink: '#F5F5F5', accent: '#F5F5F5', rule: '#2C2C2C', muted: '#9A9A9A', ground: 'dark' },
];

/**
 * 07 — Corporate Advisory. Decimal numbering, letterhead band, signed notes.
 *
 * 6 light grounds and 4 dark. Index 0 is the family default.
 */
export const CORPORATE_ADVISORY_COLOURWAYS: readonly ApprovedColourway[] = [
  { id: 'ca-slate-teal', name: 'Slate Teal', paper: '#FBFAF7', ink: '#2A2A28', accent: '#2F4858', rule: '#DEDCD5', muted: '#6C6A64', ground: 'light' },
  { id: 'ca-navy-letterhead', name: 'Navy Letterhead', paper: '#FBFBF9', ink: '#1F2430', accent: '#1E3A6B', rule: '#DBDDE3', muted: '#656B78', ground: 'light' },
  { id: 'ca-forest', name: 'Forest', paper: '#FAFAF6', ink: '#22261F', accent: '#2E4B32', rule: '#DADED6', muted: '#666B62', ground: 'light' },
  { id: 'ca-claret', name: 'Claret', paper: '#FBF9F8', ink: '#2A2124', accent: '#7A2A3A', rule: '#E0D7D9', muted: '#6E6467', ground: 'light' },
  { id: 'ca-warm-stone', name: 'Warm Stone', paper: '#FBF9F4', ink: '#2A2620', accent: '#7C6A45', rule: '#E0DACB', muted: '#6D685C', ground: 'light' },
  { id: 'ca-steel', name: 'Steel', paper: '#FAFBFB', ink: '#212528', accent: '#40525C', rule: '#D9DDDF', muted: '#676D71', ground: 'light' },
  { id: 'ca-board-dark', name: 'Board Dark', paper: '#1A1D1C', ink: '#EDEFEC', accent: '#7FA8A0', rule: '#303433', muted: '#949996', ground: 'dark' },
  { id: 'ca-navy-board', name: 'Navy Board', paper: '#14171F', ink: '#E9ECF2', accent: '#7C93C4', rule: '#282C35', muted: '#9096A2', ground: 'dark' },
  { id: 'ca-forest-board', name: 'Forest Board', paper: '#14170F', ink: '#E9EEE4', accent: '#7FA478', rule: '#272B22', muted: '#949A8E', ground: 'dark' },
  { id: 'ca-claret-board', name: 'Claret Board', paper: '#1A1416', ink: '#F0E7E9', accent: '#B76B7A', rule: '#2F2629', muted: '#A0939A', ground: 'dark' },
];

/**
 * 08 — Wealth Management. Roboto, obsidian bands, statement rules, capital framing.
 *
 * 6 light grounds and 4 dark. Index 0 is the family default.
 */
export const WEALTH_MANAGEMENT_COLOURWAYS: readonly ApprovedColourway[] = [
  { id: 'wm-obsidian-band', name: 'Obsidian Band', paper: '#FAF9F6', ink: '#1E1B16', accent: '#1E1B16', rule: '#DFDCD4', muted: '#6B675F', ground: 'light' },
  { id: 'wm-bronze', name: 'Bronze', paper: '#FAF8F3', ink: '#201B14', accent: '#8A5A22', rule: '#E1D8C9', muted: '#6F6659', ground: 'light' },
  { id: 'wm-sea-slate', name: 'Sea Slate', paper: '#F8F9F8', ink: '#171C1E', accent: '#2C5560', rule: '#D9DEDF', muted: '#616A6D', ground: 'light' },
  { id: 'wm-heritage-green', name: 'Heritage Green', paper: '#F9FAF6', ink: '#1A2018', accent: '#2B5138', rule: '#DADFD6', muted: '#646B62', ground: 'light' },
  { id: 'wm-aubergine', name: 'Aubergine', paper: '#FAF7F8', ink: '#201A20', accent: '#5C2F52', rule: '#DED4DA', muted: '#6B6167', ground: 'light' },
  { id: 'wm-sandstone', name: 'Sandstone', paper: '#FBF8F2', ink: '#241E16', accent: '#9A7538', rule: '#E2D9C7', muted: '#6F675A', ground: 'light' },
  { id: 'wm-private-night', name: 'Private Night', paper: '#16150F', ink: '#F1EDE2', accent: '#C9A227', rule: '#2C2A22', muted: '#9E9887', ground: 'dark' },
  { id: 'wm-sea-night', name: 'Sea Night', paper: '#101618', ink: '#E7EEF0', accent: '#61A0AE', rule: '#232B2D', muted: '#8C979A', ground: 'dark' },
  { id: 'wm-heritage-night', name: 'Heritage Night', paper: '#121710', ink: '#E8EEE6', accent: '#77A583', rule: '#242A23', muted: '#929A91', ground: 'dark' },
  { id: 'wm-aubergine-night', name: 'Aubergine Night', paper: '#171218', ink: '#EFE8F0', accent: '#A87BA0', rule: '#2C242E', muted: '#9C929F', ground: 'dark' },
];

/**
 * 09 — Data / Analyst. Mono figures on cell gridlines, field keys printed beside values.
 *
 * 6 light grounds and 4 dark. Index 0 is the family default.
 */
export const DATA_ANALYST_COLOURWAYS: readonly ApprovedColourway[] = [
  { id: 'da-paper-grid', name: 'Paper Grid', paper: '#FFFDFA', ink: '#312A21', accent: '#312A21', rule: '#D8CDBC', muted: '#6E6253', ground: 'light' },
  { id: 'da-cyan-model', name: 'Cyan Model', paper: '#FCFDFE', ink: '#16202A', accent: '#0B7285', rule: '#D5E0E6', muted: '#5E6F79', ground: 'light' },
  { id: 'da-magenta-model', name: 'Magenta Model', paper: '#FFFCFD', ink: '#241A22', accent: '#A31D6B', rule: '#E3D3DC', muted: '#6F5E68', ground: 'light' },
  { id: 'da-lime-model', name: 'Lime Model', paper: '#FCFDFA', ink: '#1C2118', accent: '#4C7A16', rule: '#DBE0D3', muted: '#666D5E', ground: 'light' },
  { id: 'da-violet-model', name: 'Violet Model', paper: '#FDFCFE', ink: '#1E1A26', accent: '#5B3FC4', rule: '#DEDAE8', muted: '#676277', ground: 'light' },
  { id: 'da-slate-model', name: 'Slate Model', paper: '#FBFCFC', ink: '#1D2225', accent: '#47565E', rule: '#D9DDDF', muted: '#666D71', ground: 'light' },
  { id: 'da-terminal', name: 'Terminal', paper: '#12100D', ink: '#EDE7DC', accent: '#D9A520', rule: '#2A2620', muted: '#9A9081', ground: 'dark' },
  { id: 'da-cyan-terminal', name: 'Cyan Terminal', paper: '#0D1417', ink: '#E4EFF2', accent: '#35B0C4', rule: '#212C30', muted: '#8B9A9E', ground: 'dark' },
  { id: 'da-magenta-terminal', name: 'Magenta Terminal', paper: '#150F13', ink: '#F1E5EC', accent: '#D556A0', rule: '#2A2028', muted: '#9E8F98', ground: 'dark' },
  { id: 'da-lime-terminal', name: 'Lime Terminal', paper: '#101408', ink: '#E9EFDF', accent: '#9CC93C', rule: '#262B1C', muted: '#949A85', ground: 'dark' },
];

/**
 * 10 — Dark Executive. Mono on obsidian, vertical rail, amber for the base case.
 *
 * 4 light grounds and 6 dark. Index 0 is the family default.
 */
export const DARK_EXECUTIVE_COLOURWAYS: readonly ApprovedColourway[] = [
  { id: 'de-amber-obsidian', name: 'Amber Obsidian', paper: '#1A1611', ink: '#F2EBDE', accent: '#D9A520', rule: '#3A332A', muted: '#A2957F', ground: 'dark' },
  { id: 'de-ice-obsidian', name: 'Ice Obsidian', paper: '#14171A', ink: '#ECF1F5', accent: '#6FB6E8', rule: '#2A3037', muted: '#93A0AB', ground: 'dark' },
  { id: 'de-ember', name: 'Ember', paper: '#191212', ink: '#F3E9E6', accent: '#C4553A', rule: '#362826', muted: '#A6918B', ground: 'dark' },
  { id: 'de-jade-obsidian', name: 'Jade Obsidian', paper: '#111713', ink: '#E9F1EB', accent: '#5CB98A', rule: '#26302A', muted: '#8FA096', ground: 'dark' },
  { id: 'de-violet-obsidian', name: 'Violet Obsidian', paper: '#14121C', ink: '#EDEAF4', accent: '#9182F0', rule: '#2A2736', muted: '#9A96A8', ground: 'dark' },
  { id: 'de-steel-obsidian', name: 'Steel Obsidian', paper: '#15181A', ink: '#EAEFF2', accent: '#A9B7C0', rule: '#2B3134', muted: '#929A9F', ground: 'dark' },
  { id: 'de-executive-light', name: 'Executive Light', paper: '#F6F4F0', ink: '#1A1611', accent: '#8A6A12', rule: '#DCD7CD', muted: '#6E685D', ground: 'light' },
  { id: 'de-ice-light', name: 'Ice Light', paper: '#F4F7F9', ink: '#14171A', accent: '#1E6E9C', rule: '#D6DDE2', muted: '#646E75', ground: 'light' },
  { id: 'de-ember-light', name: 'Ember Light', paper: '#F9F5F3', ink: '#1C1614', accent: '#A8452C', rule: '#E0D5D0', muted: '#6E635F', ground: 'light' },
  { id: 'de-jade-light', name: 'Jade Light', paper: '#F4F8F5', ink: '#111713', accent: '#1F7A52', rule: '#D7DFD9', muted: '#656D68', ground: 'light' },
];

/** Every family's colourways, keyed by `design_family`. */
export const COLOURWAYS_BY_FAMILY: Readonly<Record<string, readonly ApprovedColourway[]>> = {
  private_banking: PRIVATE_BANKING_COLOURWAYS,
  institutional_research: INSTITUTIONAL_RESEARCH_COLOURWAYS,
  luxury_editorial: LUXURY_EDITORIAL_COLOURWAYS,
  modern_fintech: MODERN_FINTECH_COLOURWAYS,
  architectural_property: ARCHITECTURAL_PROPERTY_COLOURWAYS,
  swiss_minimal: SWISS_MINIMAL_COLOURWAYS,
  corporate_advisory: CORPORATE_ADVISORY_COLOURWAYS,
  wealth_management: WEALTH_MANAGEMENT_COLOURWAYS,
  data_analyst: DATA_ANALYST_COLOURWAYS,
  dark_executive: DARK_EXECUTIVE_COLOURWAYS,
};
