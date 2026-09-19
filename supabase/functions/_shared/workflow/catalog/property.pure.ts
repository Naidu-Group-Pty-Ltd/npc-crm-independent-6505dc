/**
 * Property, valuation and location-intelligence operations.
 *
 * This is the category the rest of the product is built on, so the operations
 * here are deliberately specific: an automation should be able to take an
 * address off a trigger and end up with a valuation, a zoning overlay, an aerial
 * image and a set of comparable sales without dropping to a raw HTTP node.
 */

import { f, opt, outs, provider } from './builders.pure.ts';
import type { CatalogNode } from '../types.pure.ts';

const ADDRESS_FIELD = f.expr('address', 'Address', {
  required: true,
  placeholder: '{{trigger.propertyAddress}}',
  help: 'Full street address including suburb, state and postcode.',
});

const VALUATION_OUTPUTS = outs(
  'estimate:number:Estimated value',
  'lowEstimate:number:Low estimate',
  'highEstimate:number:High estimate',
  'confidence:string:Confidence',
  'valuedAt:string:Valued at',
);

export const PROPERTY_NODES: CatalogNode[] = [
  ...provider({ integrationId: 'cotality', category: 'property_data', docs: 'https://developer.corelogic.asia' }, [
    {
      op: 'valuation',
      name: 'Estimate a property’s value',
      summary: 'Returns an automated valuation with a confidence band.',
      fields: [ADDRESS_FIELD, f.select('propertyType', 'Property type', [opt('house', 'House'), opt('unit', 'Unit'), opt('land', 'Land')], { defaultValue: 'house' })],
      outputs: VALUATION_OUTPUTS,
      keywords: ['avm', 'corelogic', 'valuation', 'price', 'estimate'],
    },
    {
      op: 'attributes',
      name: 'Get property attributes',
      summary: 'Returns bedrooms, land size, build year and other core facts.',
      fields: [ADDRESS_FIELD],
      outputs: outs('propertyId:string:Property ID', 'bedrooms:number', 'bathrooms:number', 'carSpaces:number:Car spaces', 'landAreaSqm:number:Land area (sqm)', 'yearBuilt:number:Year built', 'lastSalePrice:number:Last sale price', 'lastSaleDate:string:Last sale date'),
      keywords: ['attributes', 'beds', 'land size', 'facts'],
    },
    {
      op: 'comparables',
      name: 'Find comparable sales',
      summary: 'Returns recent nearby sales of similar properties.',
      fields: [ADDRESS_FIELD, f.number('radiusKm', 'Within (km)', { defaultValue: 2 }), f.number('months', 'Sold in the last (months)', { defaultValue: 6 }), f.number('limit', 'How many', { defaultValue: 10 })],
      outputs: outs('comparables:array:Comparable sales', 'medianPrice:number:Median price', 'count:number:Matches'),
      keywords: ['comps', 'sales', 'evidence', 'cma'],
    },
  ]),

  ...provider({ integrationId: 'domain', category: 'property_data', docs: 'https://developer.domain.com.au/docs/latest' }, [
    {
      op: 'listing_search',
      name: 'Search listings',
      summary: 'Finds properties for sale or rent that match your criteria.',
      fields: [
        f.select('mode', 'Looking for', [opt('Buy', 'For sale'), opt('Rent', 'For rent'), opt('Sold', 'Sold')], { required: true, defaultValue: 'Buy' }),
        f.expr('suburb', 'Suburb', { required: true, placeholder: '{{trigger.suburb}}' }),
        f.text('state', 'State', { placeholder: 'NSW' }),
        f.number('minPrice', 'Minimum price'),
        f.number('maxPrice', 'Maximum price'),
        f.number('minBedrooms', 'Minimum bedrooms'),
        f.multi('propertyTypes', 'Property types', [opt('House'), opt('ApartmentUnitFlat', 'Apartment or unit'), opt('Townhouse'), opt('Villa'), opt('VacantLand', 'Vacant land')]),
      ],
      outputs: outs('listings:array:Listings', 'count:number:Matches'),
      keywords: ['search', 'for sale', 'rent', 'listings'],
    },
    {
      op: 'new_listing',
      kind: 'trigger',
      name: 'New listing matches',
      summary: 'Runs when a listing appears that matches your criteria.',
      fields: [f.expr('suburb', 'Suburb', { required: true }), f.number('maxPrice', 'Maximum price'), f.number('minBedrooms', 'Minimum bedrooms')],
      outputs: outs('listingId:string:Listing ID', 'address:string', 'price:number', 'bedrooms:number', 'url:string:Listing URL', 'listedAt:string:Listed at'),
      keywords: ['alert', 'watch', 'new', 'monitor'],
    },
    {
      op: 'suburb_performance',
      name: 'Get suburb performance',
      summary: 'Returns median price, growth and days on market for a suburb.',
      fields: [f.expr('suburb', 'Suburb', { required: true }), f.text('state', 'State', { placeholder: 'NSW' }), f.select('propertyCategory', 'Property type', [opt('house', 'House'), opt('unit', 'Unit')], { defaultValue: 'house' })],
      outputs: outs('medianPrice:number:Median price', 'annualGrowth:number:Annual growth (%)', 'daysOnMarket:number:Days on market', 'auctionClearanceRate:number:Clearance rate (%)', 'numberSold:number:Sales volume'),
      keywords: ['suburb', 'growth', 'median', 'market'],
    },
  ]),

  ...provider({ integrationId: 'proptrack', category: 'property_data', docs: 'https://www.proptrack.com.au/data-solutions/' }, [
    { op: 'valuation', name: 'Estimate a property’s value', summary: 'Returns a PropTrack automated valuation.', fields: [ADDRESS_FIELD], outputs: VALUATION_OUTPUTS, keywords: ['avm', 'valuation', 'realestate.com.au'] },
    { op: 'market_insights', name: 'Get market insights', summary: 'Returns supply, demand and buyer activity for a suburb.', fields: [f.expr('suburb', 'Suburb', { required: true }), f.text('state', 'State')], outputs: outs('demandIndex:number:Demand index', 'supplyIndex:number:Supply index', 'medianDaysOnMarket:number:Days on market', 'searchVolume:number:Search volume') },
  ]),

  ...provider({ integrationId: 'pricefinder', category: 'property_data', docs: 'https://www.pricefinder.com.au' }, [
    { op: 'property_search', name: 'Look up a property', summary: 'Returns ownership, sales history and attributes.', fields: [ADDRESS_FIELD], outputs: outs('propertyId:string:Property ID', 'salesHistory:array:Sales history', 'landAreaSqm:number:Land area (sqm)', 'zoning:string', 'lastSalePrice:number:Last sale price') , keywords: ['history', 'title', 'ownership'] },
    { op: 'rental_estimate', name: 'Estimate rent', summary: 'Returns an expected weekly rent and yield.', fields: [ADDRESS_FIELD], outputs: outs('weeklyRent:number:Weekly rent', 'grossYield:number:Gross yield (%)', 'confidence:string'), keywords: ['rent', 'yield', 'cashflow'] },
  ]),

  ...provider({ integrationId: 'landchecker', category: 'property_data', docs: 'https://landchecker.com.au' }, [
    {
      op: 'planning_overlays',
      name: 'Get planning and zoning',
      summary: 'Returns the zone, overlays and development controls on a parcel.',
      fields: [ADDRESS_FIELD],
      outputs: outs('zone:string', 'zoneDescription:string:Zone description', 'overlays:array:Overlays', 'lotPlan:string:Lot and plan', 'landAreaSqm:number:Land area (sqm)', 'heightLimitM:number:Height limit (m)'),
      keywords: ['zoning', 'planning', 'overlay', 'heritage', 'flood', 'bushfire', 'development'],
    },
    { op: 'easements', name: 'Check easements', summary: 'Returns registered easements and restrictions on title.', fields: [ADDRESS_FIELD], outputs: outs('easements:array:Easements', 'hasEasement:boolean:Has easement'), keywords: ['title', 'restriction', 'covenant', 'due diligence'] },
  ]),

  ...provider({ integrationId: 'nearmap', category: 'property_data', docs: 'https://docs.nearmap.com' }, [
    {
      op: 'aerial_image',
      name: 'Capture an aerial image',
      summary: 'Returns a recent high-resolution aerial photo of a property.',
      fields: [ADDRESS_FIELD, f.select('zoom', 'Detail', [opt('19', 'Wide — the block'), opt('20', 'Standard — the property'), opt('21', 'Close — the roof')], { defaultValue: '20' }), f.text('captureDate', 'As at', { placeholder: 'Latest' })],
      outputs: outs('imageUrl:string:Image URL', 'capturedAt:string:Captured at', 'resolutionCm:number:Resolution (cm)'),
      keywords: ['aerial', 'satellite', 'imagery', 'roof', 'report cover'],
    },
  ]),

  ...provider({ integrationId: 'geoscape', category: 'property_data', docs: 'https://docs.geoscape.com.au' }, [
    {
      op: 'validate_address',
      name: 'Validate an address',
      summary: 'Corrects an address and returns its official G-NAF identifier.',
      fields: [f.expr('address', 'Address', { required: true, placeholder: '{{trigger.address}}' })],
      outputs: outs('gnafId:string:G-NAF ID', 'formatted:string:Formatted address', 'latitude:number', 'longitude:number', 'confidence:number', 'matched:boolean:Matched'),
      keywords: ['gnaf', 'address', 'clean', 'normalise', 'validate'],
    },
    { op: 'building_footprint', name: 'Get building footprint', summary: 'Returns roof area, building height and land cover for a parcel.', fields: [ADDRESS_FIELD], outputs: outs('roofAreaSqm:number:Roof area (sqm)', 'buildingHeightM:number:Building height (m)', 'swimmingPool:boolean:Has pool', 'solarPanel:boolean:Has solar'), keywords: ['footprint', 'roof', 'solar', 'pool'] },
  ]),

  ...provider({ integrationId: 'mapbox', category: 'property_data', docs: 'https://docs.mapbox.com/api/' }, [
    { op: 'geocode', name: 'Find coordinates', summary: 'Converts an address into latitude and longitude.', fields: [f.expr('query', 'Address', { required: true }), f.text('country', 'Country', { defaultValue: 'AU' })], outputs: outs('latitude:number', 'longitude:number', 'placeName:string:Place name'), keywords: ['geocode', 'coordinates', 'latlng'] },
    { op: 'isochrone', name: 'Map travel time', summary: 'Returns the area reachable within a travel time.', fields: [f.expr('latitude', 'Latitude', { required: true }), f.expr('longitude', 'Longitude', { required: true }), f.select('profile', 'Travelling by', [opt('driving', 'Car'), opt('walking', 'Walking'), opt('cycling', 'Bike')], { defaultValue: 'driving' }), f.number('minutes', 'Within (minutes)', { defaultValue: 15 })], outputs: outs('geojson:object:Area', 'areaSqKm:number:Area (sq km)'), keywords: ['commute', 'travel time', 'catchment', 'lifestyle'] },
    { op: 'static_map', name: 'Render a map image', summary: 'Returns a map image centred on a location.', fields: [f.expr('latitude', 'Latitude', { required: true }), f.expr('longitude', 'Longitude', { required: true }), f.select('style', 'Style', [opt('streets-v12', 'Streets'), opt('satellite-streets-v12', 'Satellite'), opt('light-v11', 'Light')], { defaultValue: 'light-v11' }), f.number('zoom', 'Zoom', { defaultValue: 14 })], outputs: outs('imageUrl:string:Image URL'), keywords: ['map', 'image', 'report', 'location'] },
  ]),

  ...provider({ integrationId: 'mapillary', category: 'property_data', docs: 'https://www.mapillary.com/developer/api-documentation' }, [
    { op: 'street_imagery', name: 'Find street imagery', summary: 'Returns the nearest crowd-photographed street-level image of a location (CC BY-SA 4.0).', fields: [f.expr('latitude', 'Latitude', { required: true }), f.expr('longitude', 'Longitude', { required: true })], outputs: outs('imageId:string:Image ID', 'thumbUrl:string:Image URL', 'capturedAt:string:Captured', 'attribution:string'), keywords: ['street view', 'imagery', 'photo', 'listing'] },
  ]),

  ...provider({ integrationId: 'walkscore', category: 'property_data', docs: 'https://www.walkscore.com/professional/api.php' }, [
    { op: 'scores', name: 'Get walkability scores', summary: 'Returns walk, transit and bike scores for an address.', fields: [ADDRESS_FIELD], outputs: outs('walkScore:number:Walk score', 'transitScore:number:Transit score', 'bikeScore:number:Bike score', 'description:string'), keywords: ['walkability', 'transit', 'lifestyle', 'amenity'] },
  ]),

  ...provider({ integrationId: 'abs', category: 'property_data', docs: 'https://api.data.abs.gov.au' }, [
    {
      op: 'census_profile',
      name: 'Get area demographics',
      summary: 'Returns census figures for a suburb or statistical area.',
      fields: [f.expr('region', 'Suburb or SA2', { required: true }), f.multi('measures', 'Include', [opt('population', 'Population'), opt('medianAge', 'Median age'), opt('medianIncome', 'Median household income'), opt('ownership', 'Owner-occupier rate'), opt('familyComposition', 'Family composition'), opt('employment', 'Employment')], { defaultValue: 'population' })],
      outputs: outs('population:number', 'medianAge:number:Median age', 'medianHouseholdIncome:number:Median household income', 'ownerOccupierRate:number:Owner-occupier rate (%)', 'data:object:All measures'),
      keywords: ['census', 'demographics', 'population', 'income', 'sa2'],
    },
  ]),

  ...provider({ integrationId: 'rba', category: 'property_data', docs: 'https://www.rba.gov.au/statistics/' }, [
    { op: 'cash_rate', name: 'Get the cash rate', summary: 'Returns the current RBA cash rate and its last change.', fields: [], outputs: outs('cashRate:number:Cash rate (%)', 'effectiveFrom:string:Effective from', 'previousRate:number:Previous rate', 'direction:string:Last move'), keywords: ['interest', 'rate', 'rba', 'repayment', 'serviceability'] },
    { op: 'rate_changed', kind: 'trigger', name: 'Cash rate changed', summary: 'Runs when the RBA moves the cash rate.', fields: [], outputs: outs('cashRate:number:Cash rate (%)', 'previousRate:number:Previous rate', 'changeBps:number:Change (basis points)', 'direction:string'), keywords: ['rba', 'interest', 'alert', 'clients'] },
  ]),

  ...provider({ integrationId: 'cordell', category: 'property_data', docs: 'https://www.corelogic.com.au/products/cordell' }, [
    {
      op: 'construction_estimate',
      name: 'Estimate construction cost',
      summary: 'Returns a build cost estimate for a dwelling specification.',
      fields: [f.expr('postcode', 'Postcode', { required: true }), f.select('dwellingType', 'Building', [opt('house', 'Detached house'), opt('townhouse', 'Townhouse'), opt('apartment', 'Apartment')], { defaultValue: 'house' }), f.number('floorAreaSqm', 'Floor area (sqm)', { required: true }), f.select('quality', 'Standard', [opt('budget', 'Budget'), opt('standard', 'Standard'), opt('premium', 'Premium')], { defaultValue: 'standard' })],
      outputs: outs('estimatedCost:number:Estimated cost', 'costPerSqm:number:Cost per sqm', 'rangeLow:number:Low estimate', 'rangeHigh:number:High estimate'),
      keywords: ['build', 'construction', 'cost', 'feasibility', 'development', 'insurance'],
    },
  ]),

  ...provider({ integrationId: 'sqm_research', category: 'property_data', docs: 'https://sqmresearch.com.au' }, [
    { op: 'vacancy_rates', name: 'Get vacancy rates', summary: 'Returns the rental vacancy rate for a postcode.', fields: [f.expr('postcode', 'Postcode', { required: true })], outputs: outs('vacancyRate:number:Vacancy rate (%)', 'vacantListings:number:Vacant listings', 'month:string', 'trend:string'), keywords: ['vacancy', 'rental', 'demand', 'tight'] },
    { op: 'asking_prices', name: 'Get asking prices', summary: 'Returns asking prices and rents for a postcode.', fields: [f.expr('postcode', 'Postcode', { required: true }), f.select('propertyType', 'Property type', [opt('house', 'House'), opt('unit', 'Unit')], { defaultValue: 'house' })], outputs: outs('askingPrice:number:Asking price', 'askingRent:number:Asking rent', 'weeklyChange:number:Weekly change (%)') },
  ]),

  ...provider({ integrationId: 'google', category: 'property_data', docs: 'https://developers.google.com/maps/documentation' }, [
    { op: 'geocode', name: 'Find coordinates', summary: 'Converts an address into coordinates and a place ID.', fields: [f.expr('address', 'Address', { required: true })], outputs: outs('latitude:number', 'longitude:number', 'placeId:string:Place ID', 'formatted:string:Formatted address') },
    { op: 'nearby_places', name: 'Find nearby amenities', summary: 'Lists schools, transport, shops or parks near a location.', fields: [f.expr('latitude', 'Latitude', { required: true }), f.expr('longitude', 'Longitude', { required: true }), f.select('placeType', 'Looking for', [opt('school', 'Schools'), opt('train_station', 'Train stations'), opt('supermarket', 'Supermarkets'), opt('hospital', 'Hospitals'), opt('park', 'Parks'), opt('cafe', 'Cafes')], { required: true, defaultValue: 'school' }), f.number('radiusMetres', 'Within (metres)', { defaultValue: 2000 })], outputs: outs('places:array:Places', 'nearest:object:Nearest', 'count:number'), keywords: ['amenity', 'school', 'transport', 'catchment', 'lifestyle'] },
    { op: 'street_view', name: 'Capture a street view', summary: 'Returns a street-level photo of an address.', fields: [ADDRESS_FIELD, f.number('heading', 'Camera direction', { help: '0 is north, 90 is east. Leave blank to face the property.' })], outputs: outs('imageUrl:string:Image URL', 'available:boolean:Imagery available'), keywords: ['photo', 'facade', 'street', 'report'] },
  ]),

  // Airtable's base id is a credential rather than a per-step setting: a
  // workspace has one base, and asking for it on every step is how a typo ends
  // up writing to a base nobody is watching. `{{secret.AIRTABLE_WORKFLOW_BASE_ID}}` in
  // the URL reads the value the Integrations page collects for the WORKFLOW
  // connection — deliberately not `AIRTABLE_BASE_ID`, which is the Listings &
  // Overview pipeline's base, managed by Mission Control and the same across
  // the prime and every clone. See docs/integrations/AIRTABLE_KEY_OWNERSHIP.md.
  ...provider({ integrationId: 'airtable', category: 'property_data', docs: 'https://airtable.com/developers/web/api/introduction' }, [
    { op: 'list_records', name: 'Find records', summary: 'Returns records from a table, optionally filtered.', fields: [f.text('table', 'Table', { required: true }), f.text('filterByFormula', 'Filter', { placeholder: "{Status} = 'Active'" }), f.number('maxRecords', 'How many', { defaultValue: 100 })], outputs: outs('records:array:Records', 'count:number'),
      request: {
        method: 'GET',
        url: 'https://api.airtable.com/v0/{{secret.AIRTABLE_WORKFLOW_BASE_ID}}/{{table}}',
        auth: { type: 'bearer', secret: 'AIRTABLE_API_KEY' },
        query: { filterByFormula: '{{filterByFormula}}', maxRecords: '{{maxRecords}}' },
        outputs: { records: 'records', count: 'records.length' },
        requires: ['AIRTABLE_API_KEY', 'AIRTABLE_WORKFLOW_BASE_ID'],
      } },
    { op: 'create_record', name: 'Create a record', summary: 'Adds a row to a table.', fields: [f.text('table', 'Table', { required: true }), f.keyValue('fields', 'Fields', { required: true })], outputs: outs('recordId:string:Record ID', 'createdAt:string:Created at'),
      request: {
        method: 'POST',
        url: 'https://api.airtable.com/v0/{{secret.AIRTABLE_WORKFLOW_BASE_ID}}/{{table}}',
        auth: { type: 'bearer', secret: 'AIRTABLE_API_KEY' },
        body: { fields: '{{fields|object}}', typecast: 'true' },
        outputs: { recordId: 'id', createdAt: 'createdTime' },
        requires: ['AIRTABLE_API_KEY', 'AIRTABLE_WORKFLOW_BASE_ID'],
      } },
    { op: 'update_record', name: 'Update a record', summary: 'Changes fields on an existing row.', fields: [f.text('table', 'Table', { required: true }), f.expr('recordId', 'Record', { required: true }), f.keyValue('fields', 'Fields', { required: true })], outputs: outs('recordId:string:Record ID'),
      request: {
        method: 'PATCH',
        url: 'https://api.airtable.com/v0/{{secret.AIRTABLE_WORKFLOW_BASE_ID}}/{{table}}/{{recordId}}',
        auth: { type: 'bearer', secret: 'AIRTABLE_API_KEY' },
        body: { fields: '{{fields|object}}', typecast: 'true' },
        outputs: { recordId: 'id' },
        requires: ['AIRTABLE_API_KEY', 'AIRTABLE_WORKFLOW_BASE_ID'],
      } },
    { op: 'record_created', kind: 'trigger', name: 'New record', summary: 'Runs when a row is added to a table.', fields: [f.text('table', 'Table', { required: true })], outputs: outs('recordId:string:Record ID', 'fields:object:Fields', 'createdAt:string:Created at') },
  ]),
];
