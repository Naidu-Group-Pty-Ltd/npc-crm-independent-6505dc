/**
 * What each planning control MEANS — the educational half of the report.
 *
 * A retrieved fact and a useful fact are not the same thing. `HO544` is a
 * retrieval; "a heritage overlay, which means external works you would
 * normally do without a permit need one, and the permit is assessed against
 * the place's heritage significance rather than against amenity" is
 * information a client can act on. The Compass carried the first and none of
 * the second, and that is most of what "the Zoning, Planning and
 * Infrastructure sections do not provide sufficiently solid, meaningful or
 * valuable information" describes.
 *
 * The rule that makes this safe, and the reason it is a table rather than a
 * prompt: **everything here is true of the CONTROL, never of the property.**
 * It says what a bushfire overlay obliges; it never says this property is
 * bushfire prone, never states a BAL rating, never quantifies a cost, and
 * never says a control does not apply. Those are readings, and readings come
 * from `planningConstraints.pure.ts` alone.
 *
 * That separation is what the legacy long-form report did not have. Its
 * zoning section was fluent and specific — minimum lot size, height limit,
 * site coverage, permeability, contributions per lot, BAL rating, flood
 * freeboard in millimetres — and on the SAME property, in the SAME document,
 * three passes of it disagreed with each other on every one of those figures.
 * Fluency was never the problem. Fluency with nothing behind it was.
 *
 * `verify` is deliberately the most valuable line in each entry. The single
 * most useful paragraph in the legacy report was the one telling the reader to
 * obtain a Section 32 vendor statement or a planning certificate, and that
 * advice needs no retrieval at all — it was simply never written down
 * anywhere in the current product.
 */

import type { ConstraintFamily } from './planningConstraints.pure.ts';
import type { PlanningJurisdiction } from './planningSources.pure.ts';

export interface ControlExplanation {
  /** What the control IS, in one sentence a non-planner reads once. */
  what: string;
  /** What it obliges or limits for an owner. Never a cost, never a number. */
  effect: string;
  /** The specific thing to obtain or ask, and of whom. */
  verify: string;
}

/**
 * The guide, by family.
 *
 * Written against the controls as the instruments themselves define them.
 * Nothing here is jurisdiction-specific beyond what is common to every
 * Australian planning system, because the same family appears under different
 * names in each state and a per-state copy is how two copies come to disagree
 * — the rule `DEFAULT_REVIEW_INTERVALS` and `stampDuty/schedules` both answer
 * to. Where the name genuinely differs, `instrumentNameFor` says so.
 */
export const CONTROL_GUIDE: Readonly<Record<ConstraintFamily, ControlExplanation>> = {
  height: {
    what: 'A maximum building height set by the planning instrument, measured from ground level to the top of the building.',
    effect: 'It caps how many storeys can be built and is one of the two controls that decide whether a site could ever carry more dwellings than it does now. A proposal above the limit needs a variation, which is assessed on merit and is never assured.',
    verify: 'The height map and the clause that sets it are in the planning certificate for the lot. Ask a town planner whether the existing dwelling already uses the allowance.',
  },
  floorSpaceRatio: {
    what: 'The ratio of total floor area to site area the instrument permits — a floor space ratio of 0.5:1 allows 500 m² of floor area on a 1,000 m² site.',
    effect: 'With the height limit, it sets the development ceiling. It does not by itself permit a second dwelling: what may be built is decided by the zone’s land-use table, not by the floor space allowance.',
    verify: 'Confirm the ratio and any site-specific additional control on the planning certificate; a floor space ratio and a height limit that disagree are usually resolved by the more restrictive of the two.',
  },
  minimumLotSize: {
    what: 'The smallest lot the instrument will permit when land is subdivided.',
    effect: 'It is the control that decides whether a block can be split. A lot below twice the minimum cannot ordinarily be subdivided into two, however large it looks, and a lot above it still needs a permit.',
    verify: 'Compare the lot’s surveyed area on the title against the minimum on the planning certificate, and ask a surveyor about frontage and access before assuming a split is feasible.',
  },
  dwellingDensity: {
    what: 'A minimum number of dwellings per hectare the instrument requires in this area.',
    effect: 'It is a floor rather than a ceiling, used in growth areas to stop land being under-developed. It signals that the surrounding area is expected to intensify.',
    verify: 'Read it alongside the height and lot-size controls; together they describe the built form the area is planned to become.',
  },
  heritage: {
    what: 'A heritage listing or conservation area. The listing may be of the property itself, or of a precinct the property sits inside.',
    effect: 'Work that would normally need no permit — external painting, fences, windows, demolition, even some landscaping — can require one, and the application is assessed against the place’s heritage significance. It affects renovation scope, timing and cost, and it can affect insurance and lender valuation.',
    verify: 'Obtain the heritage citation for the item or the conservation area statement, and ask the council what exemptions apply. If the listing is of a precinct rather than the dwelling, the controls are usually lighter — confirm which it is.',
  },
  design: {
    what: 'A design, character or development-plan control that sets how buildings must look and sit on the land in this area.',
    effect: 'It governs setbacks, materials, roof forms, articulation, overshadowing and street presentation. It rarely prevents development but frequently changes what it costs and how long approval takes.',
    verify: 'Read the schedule to the overlay — the numbered schedule is where the actual requirements live, and two properties under the same overlay code can sit under very different schedules.',
  },
  bushfire: {
    what: 'A bushfire-prone or bushfire-management designation, made because of the land’s proximity to vegetation that can carry fire.',
    effect: 'New building and some alterations must meet a construction standard set by an assessed Bushfire Attack Level, and a defendable space or asset protection zone may be required. It also affects insurance availability and premium.',
    verify: 'A Bushfire Attack Level assessment is site-specific and must be carried out by a qualified assessor — the mapping says the designation applies, not what standard your build must meet. Ask your insurer for a quote before exchange, not after.',
  },
  flood: {
    what: 'Flood mapping or a flood planning control, made from modelled flood behaviour rather than from whether the property has flooded before.',
    effect: 'It typically sets a minimum floor level, restricts what can be built at ground level, and can require flood-compatible materials. It materially affects insurance: some insurers decline, and premiums can differ by a multiple.',
    verify: 'Ask the council for the flood level and the flood planning level for this lot — a designation without a level tells you nothing about depth. Obtain an insurance quote in writing before exchange.',
  },
  landslide: {
    what: 'Land identified as subject to landslip or slope instability risk.',
    effect: 'It usually requires a geotechnical report with any development application, and can restrict excavation, fill and the siting of a building on the lot.',
    verify: 'Ask whether a geotechnical assessment already exists for the lot or the estate; commissioning one after exchange is the expensive order to do it in.',
  },
  erosion: {
    what: 'An erosion-management designation, made where soil or slope conditions make land loss or instability a risk.',
    effect: 'It controls earthworks, vegetation removal and drainage, and can require a management plan with any development application.',
    verify: 'Ask the council what triggers a permit under the overlay — routine landscaping can be caught by it.',
  },
  coastal: {
    what: 'A coastal hazard designation covering erosion, recession or storm-tide inundation.',
    effect: 'It can set minimum floor levels, restrict hard structures near the shoreline and require a coastal hazard assessment. Some designations anticipate conditions decades ahead, so the control can apply where nothing is happening today.',
    verify: 'Ask which hazard and which planning horizon the mapping uses — present-day and 2100 lines are very different constraints and are often shown on the same map.',
  },
  acidSulfateSoils: {
    what: 'Soils that release acid when disturbed and exposed to air, mapped by the class of risk and the depth at which they occur.',
    effect: 'It regulates excavation and dewatering below a stated depth — footings, pools, services and basements. Works usually need a management plan, and the cost falls on the excavation rather than the building.',
    verify: 'The class and trigger depth are on the planning certificate. If a pool or a basement is part of the plan, price the management requirement before exchange.',
  },
  airportNoise: {
    what: 'An aircraft-noise or obstacle-limitation designation around an airport.',
    effect: 'Noise contours can require acoustic construction standards and can limit what uses are permitted. An obstacle-limitation surface caps building and even crane height.',
    verify: 'Ask which noise contour the lot sits in — the contour, not the fact of being near an airport, is what sets the requirement.',
  },
  drinkingWaterCatchment: {
    what: 'Land draining into a declared drinking-water supply catchment.',
    effect: 'It controls effluent disposal, stormwater and intensive uses, and matters most where the property is not connected to reticulated sewer.',
    verify: 'Confirm the sewer connection. On an unsewered lot, ask what on-site wastewater system the council will accept under the catchment controls.',
  },
  groundwater: {
    what: 'A groundwater-vulnerability designation, mapping where the aquifer is readily reached by contamination from the surface.',
    effect: 'It regulates activities that could contaminate groundwater and can affect excavation and on-site wastewater. For an ordinary dwelling it is usually a low-impact control.',
    verify: 'Relevant mainly where a bore, a septic system or significant excavation is contemplated.',
  },
  riparian: {
    what: 'Riparian land, a watercourse or a waterway protection area on or beside the lot.',
    effect: 'It sets a protected corridor from the top of the bank in which building, filling and vegetation removal are controlled, so it can remove usable area from a lot that looks unencumbered on a plan.',
    verify: 'Ask for the mapped corridor width. An open drain and a mapped watercourse look identical on the ground and are treated very differently.',
  },
  salinity: {
    what: 'Land identified as saline or at risk of salinity.',
    effect: 'It affects footing and slab design, drainage, landscaping and building materials, and is a construction-cost question rather than a permission question.',
    verify: 'Raise it with the builder and the engineer; a salinity-aware footing design is ordinary but has to be specified.',
  },
  biodiversity: {
    what: 'Mapped native vegetation, habitat or biodiversity value on or near the lot.',
    effect: 'It controls clearing and can require an assessment or an offset before vegetation is removed, including for a driveway, a shed or a pool. Habitat mapping for a listed species can be a substantial constraint on an otherwise ordinary lot.',
    verify: 'Ask what may be cleared without approval. Assume nothing about existing trees, and confirm before pricing any work that needs vegetation to go.',
  },
  wetlands: {
    what: 'A wetland mapped for its ecological value, together with the buffer of land around it that the control also covers.',
    effect: 'It controls filling, drainage, clearing and building within the mapped area and its buffer, and can require an ecological assessment.',
    verify: 'Ask for the mapped extent and the buffer distance, and check them against the parts of the lot you intend to use.',
  },
  vegetation: {
    what: 'A vegetation-protection control over trees or native vegetation on the lot.',
    effect: 'Removing or lopping a protected tree needs a permit, including where the tree is causing a problem. It affects renovation, driveways, sheds and pools.',
    verify: 'Ask the council which trees on the lot are protected and what the exemptions are before planning any work near them.',
  },
  scenicProtection: {
    what: 'A landscape, scenic-protection or significant-landscape control over the visual character of the area.',
    effect: 'It governs building siting, height, colour, materials and vegetation, so that development reads as subordinate to the landscape. It rarely prevents a dwelling and frequently constrains its form.',
    verify: 'Read the schedule for the specific siting and materials requirements, which vary widely between schedules under the same code.',
  },
  environmentallySensitive: {
    what: 'A designation marking the land as environmentally sensitive or of state environmental significance.',
    effect: 'It raises the assessment standard for development and can require an ecological or environmental assessment. The designation is usually about what may be disturbed rather than about whether a dwelling may exist.',
    verify: 'Ask which matter the mapping records and whether it affects the building envelope or only the balance of the lot.',
  },
  contamination: {
    what: 'A contaminated-land or environmental-audit control, applied where a past use may have left contamination.',
    effect: 'It can require a site audit or a statement from an accredited auditor before a sensitive use — including a dwelling — is approved. An audit takes months rather than weeks.',
    verify: 'Ask whether an audit statement already exists for the land. If one is required and does not exist, treat the timeline as a material risk to settlement plans.',
  },
  mineralResource: {
    what: 'Land identified as holding a mineral, extractive or state resource.',
    effect: 'It protects the resource and any buffer around an existing or future extraction operation, which can mean noise, dust and heavy-vehicle movements, and can constrain sensitive uses nearby.',
    verify: 'Ask whether an active operation or an approved one lies within the buffer, and how close.',
  },
  acquisition: {
    what: 'Land reserved for future acquisition by a public authority — for a road, a park, a school or drainage.',
    effect: 'This is the most consequential control a residential lot can carry. Part or all of the land is earmarked to be acquired, development is effectively frozen over the reserved part, and the owner may have a right to require the authority to buy.',
    verify: 'Establish immediately which authority holds the reservation, what area is affected and what the acquisition programme is. Do not exchange without legal advice on this point.',
  },
  foreshoreBuildingLine: {
    what: 'A line seaward of which building is controlled or prohibited.',
    effect: 'It fixes how close to the waterfront a structure may be, and can apply to decks, pools and retaining walls as well as to the dwelling.',
    verify: 'Ask for the surveyed position of the line relative to the lot, not its position on a map.',
  },
  developmentContributions: {
    what: 'A development-contributions control, under which development in this area pays towards the infrastructure that serves it.',
    effect: 'A contribution is levied when development occurs. On an established dwelling with no development proposed, nothing is payable; on new development or subdivision it is a real and sometimes large cost.',
    verify: 'If any development is contemplated, ask the council for the contribution rate that applies and whether it has already been paid at subdivision.',
  },
  infrastructureContribution: {
    what: 'An infrastructure-contributions control levying a charge on development towards state or regional infrastructure.',
    effect: 'As with development contributions, it is triggered by development rather than by ownership. Where it has been paid at the subdivision stage it is not payable again.',
    verify: 'Ask whether the contribution has been paid for this lot, and obtain that in writing.',
  },
  parking: {
    what: 'A parking overlay setting the parking a development must provide, or may not provide, in this area.',
    effect: 'It usually reduces required parking near transport rather than increasing it, and matters mainly for development and for the tenant appeal of a dwelling with limited off-street parking.',
    verify: 'Relevant mainly where a second dwelling or a change of use is contemplated.',
  },
  regionalPlan: {
    what: 'A statutory regional plan covering this area, which sets the long-term settlement pattern the local scheme must give effect to.',
    effect: 'It does not control what is built on one lot. It says what the region is planned to become — where growth is directed, where it is not, and what the land-use category of this area is — which is the most reliable published statement about the area’s long-term direction.',
    verify: 'Read the land-use category the plan gives this area; a growth designation and a rural or landscape designation carry opposite long-term expectations.',
  },
  growthArea: {
    what: 'A designated growth, priority living or priority development area — land the state has identified for coordinated development.',
    effect: 'Inside such an area, land supply, infrastructure sequencing and sometimes the assessment process itself are managed by the state rather than left to the market. It signals intended investment and intended additional supply, and those pull in opposite directions for an investor.',
    verify: 'Ask what stage the area is at and what is still to be delivered. A designation made years ago with nothing built is a different proposition from one under active construction.',
  },
  other: {
    what: 'A mapped designation the publisher records over this land.',
    effect: 'Its effect is set by the instrument that creates it, which is not summarised in this report.',
    verify: 'Ask the council or a town planner what this designation requires for the kind of work you have in mind.',
  },
};

/**
 * The one document that settles every question above, by jurisdiction.
 *
 * Naming it precisely is the difference between advice a client can act on and
 * advice they cannot: asking a Queensland council for a "Section 32" gets
 * nowhere, and asking a Victorian vendor for a "planning and development
 * certificate" gets nowhere either.
 */
export const VERIFICATION_DOCUMENT: Readonly<Record<PlanningJurisdiction, string>> = {
  NSW: 'a Planning Certificate under s. 10.7 of the Environmental Planning and Assessment Act 1979, obtained from the council — the s. 10.7(2) certificate lists the zoning and the controls that apply, and the s. 10.7(5) certificate adds the matters the council knows of but is not obliged to disclose. Ask for both.',
  VIC: 'the Section 32 vendor statement, which must include a planning certificate showing the zone and the overlays, together with a Planning Property Report from the Victorian Government’s planning portal.',
  QLD: 'a planning and development certificate from the council under the Planning Act 2016 — a limited certificate states the zone and the overlays, and a full certificate adds every decision and condition affecting the land. Queensland sets zoning in each council scheme, so this certificate is the only authoritative statement of the zone.',
  SA: 'a Form 1 vendor statement together with a property search through the PlanSA portal, which shows the zone and the overlays under the Planning and Design Code.',
  WA: 'a zoning certificate and a property enquiry from the local government, together with a title search showing any memorial or notification on the certificate of title.',
  TAS: 'a Section 337 certificate from the council, which states the zone and the codes that apply under the Tasmanian Planning Scheme.',
  ACT: 'a lease conveyancing enquiry and the Crown lease itself — in the ACT the lease purpose clause, not the zone alone, governs what the land may be used for.',
  NT: 'a zoning certificate and a planning scheme search from the Northern Territory Planning Commission, together with a title search.',
};

/**
 * The sentence a report prints where a jurisdiction publishes no state-wide
 * layer at all, so an absence cannot be read as a clean property.
 *
 * Queensland is the case that matters — 43.9% of stored coordinates — where
 * zoning is set by each council scheme and no state layer carries it.
 */
export const NO_STATE_LAYER_NOTE: Partial<Record<PlanningJurisdiction, string>> = {
  QLD: 'In Queensland, zoning and most overlays are set by each council’s planning scheme rather than on a state-wide map. The state-level designations below were checked; council overlays are not covered by this report, so nothing here says whether a council overlay applies. The council’s planning and development certificate confirms them.',
  WA: 'The bush fire prone area designation is read from the Fire and Emergency Services Commissioner’s published map. Western Australia publishes its planning scheme zones, density codes and other overlays, and its floodplain mapping, for personal use only, so they are not covered by this report and nothing here says whether any of them applies. The local government confirms them.',
  SA: 'The zone is read from the Planning and Design Code. The Code’s overlays are not covered by this report, so nothing here says whether one applies; the PlanSA portal confirms them.',
  NT: 'The Northern Territory’s planning scheme overlays are not covered by this report, so nothing here says whether one applies. A zoning certificate from the Northern Territory Planning Commission confirms them.',
  ACT: 'In the Australian Capital Territory the zone is read from the Territory Plan. Its precinct codes and its bushfire, flood and heritage overlays are not covered by this report, so nothing here says whether one applies. In the ACT the Crown lease’s purpose clause also governs use, and no map carries it.',
};

/**
 * What this platform reads of each jurisdiction's OVERLAY registers.
 *
 * W3.6's rule: *a Western Australian property must read "no state planning
 * register is loaded for Western Australia", never "no overlays".* The five
 * absences already existed and the sentences already existed; what did not
 * exist was anything that could tell you a jurisdiction had been FORGOTTEN.
 * `NO_STATE_LAYER_NOTE` is a `Partial` record — correctly, because a
 * jurisdiction whose overlays this platform reads in full needs no such note
 * — and a `Partial` record is exactly the shape that lets one go missing.
 *
 * The Australian Capital Territory did. Its ZONE is read (`buildActZoningQuery`
 * is one of the four zoning probes), so it never looked unserved; its overlay
 * registers have no branch at all, so `constraintOutcomes` stayed empty and
 * the page fell through to the generic sentence — the same words a transport
 * failure produces, naming neither the territory nor where a reader should
 * go instead.
 *
 * So the coverage is DECLARED, and the invariant is asserted:
 * **anything not `state_layers_read` owes a note.** A new jurisdiction, or a
 * register withdrawn, then fails a test rather than quietly printing the
 * generic line.
 *
 * `partial` is its own value because Queensland is genuinely partial — the
 * state registers answer for state instruments and the council scheme is
 * unread — and collapsing it into either neighbour would make one of two
 * true sentences unsayable.
 */
export type OverlayCoverage = 'state_layers_read' | 'partial_state_layers_read' | 'not_read';

export const OVERLAY_COVERAGE: Readonly<Record<PlanningJurisdiction, OverlayCoverage>> = {
  NSW: 'state_layers_read',
  VIC: 'state_layers_read',
  TAS: 'state_layers_read',
  QLD: 'partial_state_layers_read',
  WA: 'partial_state_layers_read',
  SA: 'not_read',
  NT: 'not_read',
  ACT: 'not_read',
};
