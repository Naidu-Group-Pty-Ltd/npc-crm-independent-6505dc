"""Surgical upgrade of the NPC Email 1 blueprint.

Run from the repo root:  python3 docs/integrations/blueprints/apply-upgrades.py


Every edit is keyed to a finding in docs/integrations/NPC_EMAIL_1_AUDIT.md.
The script reads the blueprint saved from scenarios_get, applies the edits by
module id, and writes the result. It never rebuilds the flow: routers, feeders
and module ids keep their identity so Make's own diff stays reviewable.
"""
import json, copy, sys

SRC = 'docs/integrations/blueprints/npc-email-1.original.json'
OUT = 'docs/integrations/blueprints/npc-email-1.upgraded.json'

bp = json.load(open(SRC))

INTAKE = 'tblWIg5cs85O30pcY'
EMAILS = 'tbltAY2t8eiaMzOXs'
BASE = 'apptyShYE0yzL4IGB'

# ---------------------------------------------------------------- index -----
index = {}
def walk(flow):
    for m in flow:
        index[m['id']] = m
        for r in m.get('routes', []):
            walk(r.get('flow', []))
walk(bp['flow'])

def mod(i):
    if i not in index:
        raise SystemExit(f'module {i} missing')
    return index[i]

edits = []
def note(n, text):
    edits.append(f'{n}: {text}')

# ------------------------------------------------------- shared fragments ---
# Provenance comes from the trigger, never from the model. A language model
# reading a chunk of body text cannot know the sender address or the Graph
# message id, so asking it for them invents them.
def provenance():
    return {
        'fldyma7AM6cKO2rm7': '{{1.subject}}',                       # Email Subject
        'fld4IPtcoGDjj6uml': '{{1.from.emailAddress.address}}',     # Sender Email
        'fldUWHc1JQ7DHCfei': '{{1.from.emailAddress.name}}',        # Sender Name
        'fldzxTkClvL1s21Hp': '{{1.toRecipients[].emailAddress.address}}',  # Recipient Email
        'fldH9mIjYMXH8tqhR': '{{1.bodyPreview}}',                   # Email Body Preview
        'fldwqiG10PxalSNhc': '{{substring(4.text; 0; 90000)}}',     # Email Body Plain Text
        'fldIyXyGIjA5uuujL': '{{1.receivedDateTime}}',              # Email Received At
        'fldcoBzLoOvIkdduK': '{{1.sentDateTime}}',                  # Email Sent At
        'fldLChWwHqJdGOR51': '{{1.id}}',                            # Email Message ID
        'fldtOAVmHY3eYMPko': '{{1.conversationId}}',                # Email Conversation ID
        'fldUmj3z0S4SJS1yN': '{{1.internetMessageId}}',             # Internet Message ID
        'fldPjdpKBGGmPwP8p': '{{1.webLink}}',                       # Email Web Link
        'fldX9xwRCfUmfIadM': '{{1.hasAttachments}}',                # Email Has Attachments
        'fld8xrXrV6KbWcUFK': '{{7.__IMTLENGTH__}}',                 # Email Attachment Count
        'fldNQP6e1Ewu6RSNx': '{{executionId}}',                     # Scenario Run ID
        'fldCUXytspE28ur4l': '{{executionId}}',                     # Extraction Batch ID
    }

def timestamps():
    return {
        'fldRQo08oxp8nANW2': '{{now}}',              # Extracted At
        'fldPbWwGmLKUrjPsB': '{{now}}',              # First Seen At
        'fldObHoTxoTdukvwR': '{{now}}',              # Last Seen At
        'fld2HnIkPbO8TIkRE': '{{now}}',              # Last Processed At
        'fldQFNbAzcJQh62qh': '{{1.receivedDateTime}}',  # Last Updated From Source
        'fldMdtKo1DcawGYUp': True,                   # Is Latest Version
    }

def content_key(s):
    """The composite identity key, built the same way everywhere it is used.

    A plain lower-cased pipe-joined key rather than a hash: it is readable in
    Airtable, it is what the duplicate search compares against, and it survives
    "St" one week and "Street" the next because the extractor normalises street
    types before it gets here.
    """
    return (f'{{{{lower(trim(ifempty({s}.normalized_address; {s}.address)))}}}}|'
            f'{{{{lower(trim({s}.suburb))}}}}|'
            f'{{{{trim({s}.postcode)}}}}|'
            f'{{{{lower(trim({s}.project_name))}}}}|'
            f'{{{{lower(trim({s}.lot))}}}}')

def listing_fields(s):
    """The extracted listing itself, mapped from feeder `s`."""
    return {
        # Identity / classification
        'fldib1IRHws9OeNf0': f'{{{{{s}.record_type}}}}',
        'fldEtAr2tKN90GSht': f'{{{{{s}.record_status}}}}',
        'fldjpC0qVBGCz1FEs': f'{{{{{s}.duplicate_status}}}}',
        'fldmOyVovNKWTbz63': content_key(s),
        # Address. `Address` takes the address the source actually printed;
        # `Normalized Address` takes the normalised one. Mapping the normalised
        # value into both was why no record ever carried the original wording.
        'fldlW8xSbifH1OGxg': f'{{{{{s}.address}}}}',
        'fldu3SzJNBeUHfKDx': f'{{{{{s}.normalized_address}}}}',
        'fldjjq8ESyEoWoXbl': f'{{{{{s}.suburb}}}}',
        'fldX5jSbzuiIK9y4x': f'{{{{{s}.postcode}}}}',
        'fldwMT1KcTMJLV3WZ': f'{{{{{s}.state}}}}',
        'flde1V5SZKJoCzkpK': f'{{{{{s}.country}}}}',
        'fld8yUQUPeOsr5vpv': f'{{{{{s}.full_address}}}}',
        'fldC98yQlSzCnBLce': f'{{{{{s}.unit_number}}}}',
        'fldiC8RFqaYlcOttb': f'{{{{{s}.street_number}}}}',
        'fldoqzJOOLAWwozck': f'{{{{{s}.street_name}}}}',
        'fldFckGyo0jEKmrBO': f'{{{{{s}.street_type}}}}',
        'fld2fKUblWJtcu1h7': f'{{{{{s}.lot}}}}',
        'fldhwPAAk35zyxv36': f'{{{{{s}.latitude}}}}',
        'fldDbps7sV8YURE0l': f'{{{{{s}.longitude}}}}',
        # Project
        'fldgs0rw9zkOJ4pSE': f'{{{{{s}.project_name}}}}',
        'fld99ddkEy4v3lVdq': f'{{{{{s}.estate_name}}}}',
        'fldtPpWLOBZjzuLyK': f'{{{{{s}.stage}}}}',
        'fldakOUCPu6Q9qPCr': f'{{{{{s}.builder_developer}}}}',
        # Classification
        'fld40F6pwlH0NDTf7': f'{{{{{s}.property_type}}}}',
        'fldtEFae4OyhXQxAc': f'{{{{{s}.sector}}}}',
        'fldzkDzFEToo8hNH5': f'{{{{{s}.intent}}}}',
        'fldQvWP518HOQrrfv': f'{{{{{s}.category}}}}',
        'fldNLj3r1786PhfUF': f'{{{{{s}.zoning}}}}',
        'fldyWGfccDS5UDQtL': f'{{{{{s}.listing_status}}}}',
        'fldNsKojEZvhQtNVe': f'{{{{{s}.contract_type}}}}',
        'fldcHchl4B6kmJdrb': f'{{{{{s}.package_type}}}}',
        'fld7k3QMtN3LRKqcA': f'{{{{{s}.registration_month_year}}}}',
        'flddMNLV3ovgoiaT0': f'{{{{{s}.registration_date}}}}',
        # Price
        'fldLpEgTVziuSJrcO': f'{{{{{s}.sale_method}}}}',
        'fldgruPyD7DZcmq4e': f'{{{{{s}.rent_period}}}}',
        'fldNS45HvCU9Jifli': f'{{{{{s}.display_price_text}}}}',
        'fldca09tuy3SSTIvu': f'{{{{{s}.price_numeric}}}}',
        'fldDFarbOfdSIGxlx': f'{{{{{s}.price_min}}}}',
        'fldvExKLPeDivcfD3': f'{{{{{s}.price_max}}}}',
        'fldhj3UbBYfGEr3pL': f'{{{{{s}.total_price}}}}',
        'fldBMP7zCIdeiVaXH': f'{{{{{s}.land_price}}}}',
        'fldyl4bvwxXOnj2FS': f'{{{{{s}.build_price}}}}',
        'fld9RT1PtVLWchPaL': f'{{{{{s}.rent_amount}}}}',
        'fld7Z1qpAhSZaFPov': f'{{{{{s}.price_qualifier}}}}',
        'fldCCyjKFYFMIRNyN': f'{{{{{s}.gst_applicable}}}}',
        'fldoEzUmevuXnEpWh': f'{{{{{s}.outgoings_pa}}}}',
        'fldvc4aAmO1NKcrmg': f'{{{{{s}.bond_deposit}}}}',
        'fldyIoqex1AuXRrUT': f'{{{{{s}.lease_term}}}}',
        'fld4CKE7eeiTW4huq': f'{{{{{s}.price_notes}}}}',
        'fldWjrqbmi5wvfEJ0': f'{{{{{s}.price_numeric}}}}',   # Current Price Snapshot
        # Specs
        'flduTFYz903QgIAG1': f'{{{{{s}.beds}}}}',
        'fldIH0iuP0DXXsUOJ': f'{{{{{s}.baths}}}}',
        'fldgEImJI6QzIH5ej': f'{{{{{s}.car_spaces}}}}',
        'fldbcAsYi3dE5FRQJ': f'{{{{{s}.parking_details}}}}',
        'fld5HPk5dCxkKgoai': f'{{{{{s}.land_size_sqm}}}}',
        'fldqcyg2UiegiHcAr': f'{{{{{s}.building_area_sqm}}}}',
        'fld9fASRIkrcO2LMB': f'{{{{{s}.floor_area_sqm}}}}',
        'fldihUfd8iN90rWtE': f'{{{{{s}.total_area_sqm}}}}',
        'fldZWTkPsD2iwKBEe': f'{{{{{s}.frontage_m}}}}',
        'fldux63qXG9gRJLgr': f'{{{{{s}.area_unit_original}}}}',
        'fldEq9VLE7xqP0QsG': f'{{{{{s}.storeys}}}}',
        'fldX9xpwBvHhXABOa': f'{{{{{s}.property_features}}}}',
        'fld3Md7KhFlIEdeIU': f'{{{{{s}.availability_date}}}}',
        'fldpZHIo8tQNJ5kGG': f'{{{{{s}.settlement_date}}}}',
        # Content
        'fldVurLsIoJznTKHx': f'{{{{{s}.property_description}}}}',
        'fldOijY0vv8cwE1yd': f'{{{{{s}.summary}}}}',
        'fldmCcMIY0BkKqzVy': f'{{{{{s}.original_row_text}}}}',
        'fldya3DDDIcDYJl4f': f'{{{{{s}.raw_source_snippet}}}}',
        # Agent
        'fldNWkhe7nhUSTMyg': f'{{{{{s}.agent_name}}}}',
        'fldyM4FSC0KGkZ2U3': f'{{{{{s}.agent_phone}}}}',
        'fldIe2Ij5XQvVBTVs': f'{{{{{s}.agent_mobile}}}}',
        'fldcBbNIkyBT9v0Qa': f'{{{{{s}.agent_email}}}}',
        'fldrisFoLERgo66X4': f'{{{{{s}.agent_role}}}}',
        'fldt0FX6UIu2gXN3d': f'{{{{{s}.agency_name}}}}',
        'fldRIuCKckxrrcxQd': f'{{{{{s}.agency_office_phone}}}}',
        'fldCDMR8szwgODuB2': f'{{{{{s}.agency_email}}}}',
        'fldGOk8QEhfL7x81M': f'{{{{{s}.agency_website}}}}',
        'flddzDrLDdQDfYfoK': f'{{{{{s}.agent_agency_notes}}}}',
        # Inspection
        'flduVfZFW5dmPmyKH': f'{{{{{s}.inspection_start}}}}',
        'fldi7e5gCa2uPCcDq': f'{{{{{s}.inspection_end}}}}',
        'fldRqhG4XGtCoUiiy': f'{{{{{s}.inspection_notes}}}}',
        'fldEBzYVYwVQBRWNE': f'{{{{{s}.open_home_available}}}}',
        'fldCBmZjqDcpyH8bJ': f'{{{{{s}.next_inspection_date}}}}',
        'fld7KclZBymQUCN6j': f'{{{{{s}.private_inspection_required}}}}',
        'fldHDCDZqjO4kUI4s': f'{{{{{s}.inspection_raw_text}}}}',
        # Links
        'fldO8UGR5qT0AtTJx': f'{{{{{s}.web_link}}}}',
        'fldVrI54Ca7t4691T': f'{{{{{s}.source_web_link}}}}',
        'fldtEJGhNp7HKhdpH': f'{{{{join({s}.alternate_web_links; newline)}}}}',
        # Quality
        'fld6hsm7vL5OtLeRM': f'{{{{{s}.extraction_confidence}}}}',
        'fldaxMkTcSCnj6dOw': f'{{{{{s}.address_confidence}}}}',
        'fld2LR0jE8y0yPxXx': f'{{{{{s}.price_confidence}}}}',
        'fldQQ8CN2qxzvLJfO': f'{{{{{s}.specs_confidence}}}}',
        'fldaXMII5Q0NxBumi': f'{{{{{s}.agent_details_confidence}}}}',
        'fldagtGEQlwYr1jB1': f'{{{{{s}.overall_data_quality_score}}}}',
        'fldikOAUubTCdGXbD': f'{{{{{s}.needs_human_review}}}}',
        'fldW9nSNdcxjEv4BR': f'{{{{{s}.review_reason}}}}',
        'fld7GlB9QsWVNnlXx': f'{{{{{s}.human_review_status}}}}',
        'fldiESnDRczrvaBFD': f'{{{{{s}.human_review_notes}}}}',
        # Errors
        'fldpUWi6LByMYFslu': f'{{{{{s}.error_type}}}}',
        'fldQ9sPA1zAlU7i1C': f'{{{{{s}.error_message}}}}',
        # Notes
        'fld2Hdei95VYla4yO': f'{{{{{s}.follow_up_notes}}}}',
        'fldyjtcMKumTpFxeg': 'New Property',
    }

def extraction_meta(model, method, prompt_version, source_type, stage,
                    raw_out, in_chars, out_chars, listing_count, module_label):
    return {
        'fldOO9RjZCQzOjKUl': source_type,          # Source Type
        'fldKpnJzCHXhTGkTj': stage,                # Processing Stage
        'fldrxJ2XDayRlEJST': 'Extracted',          # Processing Status
        'fldjjHyGw0hJVDijx': model,                # AI Model
        'fldLbXcxpOYyJR5Gc': method,               # Extraction Method
        'fldPCQTaD8tLBIlEO': prompt_version,       # Prompt Version
        'fldnCCrP2MLIS1UTf': module_label,         # Make Module Source
        'flduR84oClLfnb76G': raw_out,              # Raw AI Output
        'fldkQ8f8CmOZCcAz0': raw_out,              # Raw Extracted JSON
        **({'fldZQohtfZfIYaXV8': in_chars} if in_chars else {}),  # Input Character Count
        'fldR3Ut6movCXFjXK': out_chars,            # Output Character Count
        'fldhTFy7C3QuYyU0c': listing_count,        # Extracted Listings Count
        'fldpxErBtiar2BcnI': 'Valid',              # JSON Parse Status
        'fldGzwDgvO5LiIk8n': True,                 # Parsed JSON Valid
    }

# The one extraction prompt. Route 1 (PDF) and route 4 (web scrape) each carried
# their own older copy that emitted a ~20-key schema against a 205-column table.
MASTER_PROMPT = None
for msg in mod(36)['mapper']['messages']:
    if msg.get('role') == 'system':
        MASTER_PROMPT = msg['content']
assert MASTER_PROMPT and 'npc_property_master_v2_single_table' in MASTER_PROMPT

# Two clauses the master prompt never had. `property_features` writes into a
# curated 26-choice column, and with typecast on an unconstrained model turns
# that column into a junk drawer within a week. `listing_images` was declared in
# the schema and then never explained, so it came back [] every time.
FEATURE_VOCAB = [
    'Pool', 'Gym', 'Study', 'Balcony', 'Courtyard', 'Alfresco', 'Garage', 'Carport',
    'Air Conditioning', 'Heating', 'Ensuite', 'Walk-in Robe', 'Solar', 'Storage',
    'Lift Access', 'Loading Dock', 'Roller Door', 'Hardstand', 'Office Space',
    'Showroom', 'High Clearance', 'Yard', 'Warehouse', 'Workshop',
    'Retail Frontage', 'Other',
]
CONSTRAINTS = (
    '\n\nPROPERTY FEATURES VOCABULARY (closed list):\n'
    '`property_features` is a CLOSED vocabulary. Emit only these exact strings, and only '
    'when the source states the feature:\n'
    + ', '.join(FEATURE_VOCAB) + '.\n'
    'Anything that does not map to one of these goes in `property_description`, never into '
    '`property_features`. Never invent a new feature name.\n\n'
    'IMAGE RULES:\n'
    '`listing_images` is an ARRAY OF ABSOLUTE https URLs pointing at photographs of the '
    'property, in the order the source presents them - the hero shot first, because the '
    'first entry is what the dashboard renders as the card image.\n'
    '- Property photography only. Exclude agent headshots, agency logos, brand banners, '
    'email-signature images, map tiles, tracking pixels, social icons and spacer images.\n'
    '- Absolute https URLs only. Never relative paths, never cid: references, never data: URIs.\n'
    '- Floorplans go in `floorplan_url`, not in `listing_images`.\n'
    '- Cap at 20. If there are none, return [].\n'
)
MASTER_PROMPT = MASTER_PROMPT + CONSTRAINTS
for msg in mod(36)['mapper']['messages']:
    if msg.get('role') == 'system':
        msg['content'] = MASTER_PROMPT
note('F22', 'modules 21, 36 and 20 — property_features was written into a curated 26-choice '
            'column from an unconstrained model output, which with typecast on would have '
            'turned that column into a junk drawer; the vocabulary is now closed in the prompt. '
            'listing_images was declared in the schema and never explained, so it always came '
            'back empty; it now has explicit ordering and exclusion rules')

# The image analyser carries its own prompt and needs the same two clauses.
mod(20)['mapper']['prompt'] = mod(20)['mapper']['prompt'] + CONSTRAINTS

# ============================================================== ROUTE 1: PDF ==
# F1 — attachment classifier missed spreadsheets, which is how most developer
# stock lists actually arrive.
m = mod(22)
m['filter']['conditions'] = [
    [{'a': '{{7.contentType}}', 'b': 'pdf', 'o': 'text:contain:ci'}],
    [{'a': '{{7.contentType}}', 'b': 'doc', 'o': 'text:contain:ci'}],
    [{'a': '{{7.contentType}}', 'b': 'sheet', 'o': 'text:contain:ci'}],
    [{'a': '{{7.contentType}}', 'b': 'excel', 'o': 'text:contain:ci'}],
    [{'a': '{{7.contentType}}', 'b': 'csv', 'o': 'text:contain:ci'}],
]
note('F1', 'module 22 — document filter now also admits spreadsheets (sheet/excel/csv)')

# F2 — the PDF branch ran a legacy prompt with a 20-key schema.
for msg in mod(21)['mapper']['messages']:
    if msg.get('role') == 'system':
        msg['content'] = MASTER_PROMPT
note('F2', 'module 21 — PDF extractor now runs the same master v2 prompt as the body extractor')

# F3 — the PDF branch wrote to the legacy `Properties` table.
m = mod(28)
rec = {}
rec.update(listing_fields('33'))
rec.update(provenance())
rec.update(timestamps())
rec.update(extraction_meta(
    model='gpt-5.2', method='OpenAI Text Extraction',
    prompt_version='npc_property_master_v2_single_table',
    source_type='PDF', stage='Document Extracted',
    raw_out='{{substring(21.result; 0; 90000)}}',
    in_chars='{{length(32.content)}}', out_chars='{{length(21.result)}}',
    listing_count='{{length(27.listings)}}',
    module_label='NPC Email 1 / 28 (PDF attachment)'))
rec.update({
    'fldaS9MprydWuSX18': '{{8.filename}}',            # Source Attachment Name
    'fldYmaRJzPUZo78o2': '{{7.contentType}}',         # Source Attachment MIME Type
    'fldfaTFaeNkSqK1Gq': '{{8.size}}',                # Source Attachment Size
    'fldslJJYOuehwP6tb': 'PDF',                       # Source Attachment Type
    'fldba6zTzgjOT591O': '{{18.webContentLink}}',     # Google Drive File URL
    'fld3dVFVuDjRAOh4N': '{{18.id}}',                 # Google Drive File ID
    'fldG7bsjQcnuHPyeD': '{{substring(32.content; 0; 90000)}}',  # Source Document Extracted Text
    'fldFm3YbQDn6FCqKs': 'Extracted',                 # Source Document Extraction Status
    'fldthYBtgNVT5KbrJ': [{'url': '{{18.webContentLink}}', 'filename': '{{8.filename}}'}],  # Brochure
})
m['mapper'] = {'base': BASE, 'table': INTAKE, 'record': rec,
               'typecast': True, 'useColumnId': False}
note('F3', 'module 28 — retargeted from Properties to Property Intake Master, '
           '20 fields to ~120, provenance taken from the trigger, typecast on')

# F4 — a select write with typecast off fails the whole bundle on an unseen option.
mod(54)['mapper']['typecast'] = True
mod(54)['mapper']['record']['fldx96rScPizG9Brh'] = 'Invalid AI JSON'
note('F4', 'module 54 — typecast on; status reads "Invalid AI JSON" instead of "Error 500"')

# F5/F6 — the PDF geocode enrichment matched on a raw address string and then
# wrote back one field.
mod(128)['mapper']['formula'] = '{Intake Content Hash} = "' + content_key('123') + '"'
mod(128)['mapper']['fields'] = ['Address', 'Intake Content Hash']
note('F5', 'module 128 — duplicate search moved off the unescaped Address formula onto Intake Content Hash')

mod(129)['mapper']['record'] = {
    'fldhwPAAk35zyxv36': '{{124.geometry.location.lat}}',   # Latitude
    'fldDbps7sV8YURE0l': '{{124.geometry.location.lng}}',   # Longitude
    'fldOUM8ZCX0TD2s4c': '{{124.formatted_address}}',       # Geocoded Full Address
    'fldH3tm1cunvnpOvJ': '{{124.urlMap}}',                  # Google Maps Link
    'fldD7zoSGzAkcxSA3': '{{127.geocoding_status}}',        # Geocoding Status
    'fldNxxT0ZDfWta2Ha': '{{124.formatted_address}} | place_id={{124.place_id}} | location_type={{124.geometry.location_type}}',  # Geocoding Raw Response
    'fldX5jSbzuiIK9y4x': '{{127.postcode}}',                # Postcode
    'fldwMT1KcTMJLV3WZ': '{{127.state}}',                   # State
    'flde1V5SZKJoCzkpK': '{{127.country}}',                 # Country
    'fldjjq8ESyEoWoXbl': '{{127.suburb}}',                  # Suburb
    'fld8yUQUPeOsr5vpv': '{{127.full_address}}',            # Full Address
    'fldu3SzJNBeUHfKDx': '{{127.normalized_address}}',      # Normalized Address
    'fldiC8RFqaYlcOttb': '{{127.street_number}}',           # Street Number
    'fldoqzJOOLAWwozck': '{{127.street_name}}',             # Street Name
    'fldFckGyo0jEKmrBO': '{{127.street_type}}',             # Street Type
    'fldNdNsA6DPpQIRmF': ['State', 'Postcode'],             # Enriched Fields
    'fld8mT2mVK3uWHo9O': 'Enriched',                        # Enrichment Status
    'fldKpnJzCHXhTGkTj': 'Geocoded',                        # Processing Stage
    'fldObHoTxoTdukvwR': '{{now}}',                         # Last Seen At
    'fld2HnIkPbO8TIkRE': '{{now}}',                         # Last Processed At
}
mod(129)['mapper']['typecast'] = True
note('F6', 'module 129 — geocode write-back goes from Postcode alone to '
           'lat/long, Google Maps link, locality and street parts')

# ======================================================= ROUTE 2: EMAIL BODY ==
# F7 — Address carried the normalised value; the printed address was dropped.
m = mod(38)
rec = {}
rec.update(listing_fields('113'))
rec.update(provenance())
rec.update(timestamps())
rec.update(extraction_meta(
    model='gpt-5.4', method='OpenAI Text Extraction',
    prompt_version='npc_property_master_v2_single_table',
    source_type='Email Body', stage='Property Created',
    raw_out='{{substring(36.result; 0; 90000)}}',
    in_chars='{{length(111.value)}}', out_chars='{{length(36.result)}}',
    listing_count='{{length(35.listings)}}',
    module_label='NPC Email 1 / 38 (email body)'))
rec.update({
    # Module 13 lives in a sibling router branch, so it is not addressable from
    # here; the URLs come from the extractor's own reading of the body instead.
    'fldNZ1zC7lWnW63PC': '{{join(113.alternate_web_links; newline)}}',
    'flddLP8yYsa0tIxPn': '{{substring(113.scraped_website_text; 0; 90000)}}',
    'fldws4mnqkyyzYfM4': 'Not Started',   # Web Scrape Status
    'fld8mT2mVK3uWHo9O': 'Not Started',   # Enrichment Status
    'fldD7zoSGzAkcxSA3': 'Not Started',   # Geocoding Status
    # Images the extractor found inline in the email body.
    'fldtLTvziB8H1Rt4y': '{{join(113.listing_images; newline)}}',  # Listing Image URLs
    'fldmsoZ47F7b4zqJk': '{{first(113.listing_images)}}',          # Primary Image URL
    'fldIm2qkfYecRbZen': '{{length(113.listing_images)}}',         # Image Count
    'fld5DocU0IqpaAeNs': '{{now}}',                                # Images Captured At
    'fldRgm1uKmfBSA78L': '{{if(length(113.listing_images); "Portal Listing"; "None Found")}}',
})
m['mapper'] = {'base': BASE, 'table': INTAKE, 'record': rec,
               'typecast': True, 'useColumnId': False}
note('F7', 'module 38 — Address now takes the printed address and Normalized Address the '
           'normalised one; provenance, extraction metadata and image candidates added; typecast on')

# F8 — the invalid-JSON branch updated the intake table by record id of an
# *Emails* row and set nothing.
mod(51)['mapper'] = {
    'id': '{{2.id}}', 'base': BASE, 'table': EMAILS,
    'record': {'fldx96rScPizG9Brh': 'Invalid AI JSON',
               'fldUvSkOwJ0Zn69Id': 'Body extraction returned no usable listings. '
                                    'Raw model output: {{substring(36.result; 0; 4000)}}'},
    'typecast': True, 'useColumnId': False}
note('F8', 'module 51 — was updating Property Intake Master with an Emails record id and '
           'writing nothing; now records the failure on the Emails row it actually owns')

# F9 — three "Error 500" writers aimed Emails field ids at the intake table.
ERROR_REC = lambda reason, etype, module_label: {
    'fldib1IRHws9OeNf0': 'Error Record',
    'fldEtAr2tKN90GSht': 'Needs Review',
    'fldrxJ2XDayRlEJST': 'Failed',
    'fldKpnJzCHXhTGkTj': 'Error',
    'fldpUWi6LByMYFslu': etype,
    'fldQ9sPA1zAlU7i1C': reason,
    'fldhGWyo7nzB3ya7I': module_label,
    'fldikOAUubTCdGXbD': True,
    'fld7GlB9QsWVNnlXx': 'Pending',
}

mod(75)['mapper'] = {
    'base': BASE, 'table': INTAKE,
    'record': {**ERROR_REC('Extracted listing carried no usable web link: {{107.web_link}}',
                           'Missing Web Link', 'NPC Email 1 / 75'),
               **provenance(), **timestamps(),
               'fldlW8xSbifH1OGxg': '{{107.address}}',
               'fldjjq8ESyEoWoXbl': '{{107.suburb}}',
               'fldmOyVovNKWTbz63': content_key('107'),
               'fldW9nSNdcxjEv4BR': ['Missing Web Link']},
    'typecast': True, 'useColumnId': False}
note('F9', 'module 75 — was writing "Error 500" into the Emails table with no context; '
           'now writes a typed Error Record against the listing that failed')

mod(119)['mapper'] = {
    'base': BASE, 'table': INTAKE,
    'record': {**ERROR_REC('No web link on the extracted listing, so nothing could be scraped.',
                           'Missing Web Link', 'NPC Email 1 / 119'),
               **provenance(), **timestamps(),
               'fldlW8xSbifH1OGxg': '{{116.address}}',
               'fldjjq8ESyEoWoXbl': '{{116.suburb}}',
               'fldmOyVovNKWTbz63': content_key('116'),
               'fldws4mnqkyyzYfM4': 'Not Required',
               'fldW9nSNdcxjEv4BR': ['Missing Web Link']},
    'typecast': True, 'useColumnId': False}

mod(122)['mapper'] = {
    'base': BASE, 'table': INTAKE,
    'record': {**ERROR_REC('Matched an existing record that carries no Web Link, so the '
                           'scrape had no target.', 'Web Scrape Failed', 'NPC Email 1 / 122'),
               **provenance(), **timestamps(),
               'fldlW8xSbifH1OGxg': '{{116.address}}',
               'fldT3MS9WYDzlny0f': '{{92.id}}',
               'fldmOyVovNKWTbz63': content_key('116'),
               'fldws4mnqkyyzYfM4': 'Failed',
               'fldW9nSNdcxjEv4BR': ['Missing Web Link']},
    'typecast': True, 'useColumnId': False}
note('F9b', 'modules 119 and 122 — same fix, typed error records instead of "Error 500"/"No URL"')

# F10 — duplicate searches used unescaped free-text formulas.
mod(71)['mapper']['formula'] = '{Intake Content Hash} = "' + content_key('107') + '"'
mod(71)['mapper']['fields'] = ['Address', 'Intake Content Hash', 'Web Link']
mod(106)['mapper']['formula'] = '{Intake Content Hash} = "' + content_key('107') + '"'
mod(106)['mapper']['fields'] = ['Project Name', 'Intake Content Hash', 'Web Link']
mod(82)['mapper']['formula'] = '{Intake Content Hash} = "' + content_key('115') + '"'
mod(82)['mapper']['fields'] = ['Address', 'Intake Content Hash']
mod(92)['mapper']['formula'] = '{Intake Content Hash} = "' + content_key('116') + '"'
mod(92)['mapper']['fields'] = ['Address', 'Web Link', 'Intake Content Hash',
                               'Listing Image URLs', 'Images Captured At']
note('F10', 'modules 71, 82, 92, 106 — all four duplicate searches moved off unescaped '
            'free-text address formulas onto the exact Intake Content Hash')

# F11 — "record already exists" branches updated nothing.
SEEN_AGAIN = {
    'fldObHoTxoTdukvwR': '{{now}}',                  # Last Seen At
    'fldQFNbAzcJQh62qh': '{{1.receivedDateTime}}',   # Last Updated From Source
    'fld2HnIkPbO8TIkRE': '{{now}}',                  # Last Processed At
    'fldjpC0qVBGCz1FEs': 'Updated Existing',         # Duplicate Status
    'fldyjtcMKumTpFxeg': 'Existing Property Updated',# Change Type
    'fldMdtKo1DcawGYUp': True,                       # Is Latest Version
    'fldNQP6e1Ewu6RSNx': '{{executionId}}',          # Scenario Run ID
}
for mid, src, label in ((65, '107', 'address match'), (104, '107', 'project match')):
    mod(mid)['mapper']['record'] = {
        **SEEN_AGAIN,
        'fldKpnJzCHXhTGkTj': 'Property Updated',
        'fldSw1QWP1Byk22h9': f'Seen again in "{{{{1.subject}}}}" ({label}).',
        'fld3SB8pUahInoGlS': '{{now}}',
        'fldO8UGR5qT0AtTJx': f'{{{{{src}.web_link}}}}',
        'fldWjrqbmi5wvfEJ0': f'{{{{{src}.price_numeric}}}}',
        'fldSXu2fxaeuu8sUd': f'{{{{{src}.listing_status}}}}',
    }
    mod(mid)['mapper']['typecast'] = True
mod(83)['mapper']['record'] = {
    **SEEN_AGAIN,
    'fldhwPAAk35zyxv36': '{{81.geometry.location.lat}}',
    'fldDbps7sV8YURE0l': '{{81.geometry.location.lng}}',
    'fldOUM8ZCX0TD2s4c': '{{81.formatted_address}}',
    'fldH3tm1cunvnpOvJ': '{{81.urlMap}}',
    'fldD7zoSGzAkcxSA3': '{{89.geocoding_status}}',
    'fldNxxT0ZDfWta2Ha': '{{81.formatted_address}} | place_id={{81.place_id}} | location_type={{81.geometry.location_type}}',
    'fldX5jSbzuiIK9y4x': '{{89.postcode}}',
    'fldwMT1KcTMJLV3WZ': '{{89.state}}',
    'flde1V5SZKJoCzkpK': '{{89.country}}',
    'fldjjq8ESyEoWoXbl': '{{89.suburb}}',
    'fld8yUQUPeOsr5vpv': '{{89.full_address}}',
    'fldu3SzJNBeUHfKDx': '{{89.normalized_address}}',
    'fldiC8RFqaYlcOttb': '{{89.street_number}}',
    'fldoqzJOOLAWwozck': '{{89.street_name}}',
    'fldFckGyo0jEKmrBO': '{{89.street_type}}',
    'fldNdNsA6DPpQIRmF': ['State', 'Postcode'],
    'fld8mT2mVK3uWHo9O': 'Enriched',
    'fldKpnJzCHXhTGkTj': 'Geocoded',
}
mod(83)['mapper']['typecast'] = True
note('F11', 'modules 65, 83, 104 — "already have this one" branches set only two empty '
            'collaborator fields; they now stamp Last Seen At, price/status snapshots '
            'and (for 83) the full geocode result')

# F12 — the create-if-different branches wrote Emails field ids into the intake table.
for mid, search, src in ((72, '71', '107'), (105, '106', '107')):
    mod(mid)['mapper'] = {
        'base': BASE, 'table': INTAKE,
        'record': {**listing_fields(src), **provenance(), **timestamps(),
                   'fldT3MS9WYDzlny0f': f'{{{{{search}.id}}}}',
                   'fldn57H8vrHWemtYQ': 'Content key did not match the candidate found by '
                                        'the duplicate search, so this was filed as a new property.',
                   'fldnCCrP2MLIS1UTf': f'NPC Email 1 / {mid}',
                   'fldNQP6e1Ewu6RSNx': '{{executionId}}',
                   'fldOO9RjZCQzOjKUl': 'Email Body',
                   'fldKpnJzCHXhTGkTj': 'Property Created',
                   'fldrxJ2XDayRlEJST': 'Extracted'},
        'typecast': True, 'useColumnId': False}
note('F12', 'modules 72 and 105 — were creating intake records out of three Emails field ids '
            '(Name/Assignee/Status), which cannot exist on this table; now write real listings')

# F13 — Firecrawl asked for HTML and the next module read markdown.
mod(94)['mapper'].update({
    'formats': ['markdown', 'links'],
    # 2-day cache is the wrong default when the point of the pass is fresh
    # photos. 1h is the module's floor.
    'maxAge': '3600000',
    'location': {'country': 'AU'},
    'timeout': '45000',
    'onlyMainContent': False,
})
note('F13', 'module 94 — Firecrawl requested ["html"] while module 98 read data.markdown, so the '
            'model was handed an empty string on every run; now markdown+links, AU egress, '
            '1h cache instead of 2 days, and full-page content so galleries are not stripped')

# F14 — the scrape extractor ran the legacy PDF prompt.
WEB_PROMPT = (
    'You are a precise, non-creative extraction agent reading ONE scraped Australian '
    'property listing page.\n\n'
    'Output ONLY one valid JSON object. No markdown, no code fences, no prose.\n\n'
    'Use exactly this structure:\n'
    '{"extraction_meta":{"record_type":"Property Listing|URL / Web Record|Error Record|Unknown",'
    '"source_type":"Web Scrape","processing_status":"Extracted|Partially Extracted|Needs Human Review|Failed",'
    '"processing_stage":"Webpage Scraped","extraction_method":"Firecrawl Web Scrape",'
    '"prompt_version":"npc_web_listing_v1","extracted_listings_count":null,'
    '"json_parse_status":"Valid","parsed_json_valid":true,"notes":"string|null"},'
    '"listings":[{ ...one object per property on the page... }]}\n\n'
    'Each listing object uses the same keys as the NPC property master schema: record_type, '
    'source_type, processing_status, processing_stage, record_status, lot, unit_number, '
    'street_number, street_name, street_type, address, normalized_address, suburb, state, '
    'postcode, country, full_address, project_name, estate_name, stage, builder_developer, '
    'property_type, sector, intent, category, zoning, listing_status, contract_type, '
    'package_type, registration_month_year, registration_date, sale_method, rent_period, '
    'display_price_text, price_numeric, price_min, price_max, total_price, land_price, '
    'build_price, rent_amount, price_qualifier, gst_applicable, outgoings_pa, bond_deposit, '
    'lease_term, price_notes, beds, baths, car_spaces, parking_details, land_size_sqm, '
    'building_area_sqm, floor_area_sqm, total_area_sqm, frontage_m, area_unit_original, '
    'storeys, property_features, availability_date, settlement_date, property_description, '
    'summary, agent_name, agent_phone, agent_mobile, agent_email, agent_role, agency_name, '
    'agency_office_phone, agency_email, agency_website, agent_agency_notes, inspection_start, '
    'inspection_end, inspection_notes, open_home_available, next_inspection_date, '
    'private_inspection_required, inspection_raw_text, web_link, source_web_link, '
    'alternate_web_links, listing_images, floorplan_url, brochure_url, extraction_confidence, '
    'address_confidence, price_confidence, specs_confidence, agent_details_confidence, '
    'overall_data_quality_score, needs_human_review, review_reason, error_type, error_message.\n\n'
    'IMAGE RULES — these matter most, the dashboard renders from them:\n'
    '1. `listing_images` is an ARRAY OF ABSOLUTE https URLs pointing at photographs of the '
    'property. Never relative paths, never data: URIs.\n'
    '2. Order them as the page orders them: the gallery hero first. The first entry is what '
    'the dashboard uses as the card image.\n'
    '3. Include only property photography. Exclude agent headshots, agency logos, brand '
    'banners, map tiles, tracking pixels, social icons, and any image under roughly 200px.\n'
    '4. Strip resizing/watermark query strings when the bare URL still resolves; prefer the '
    'largest variant the page offers.\n'
    '5. Put floorplan images in `floorplan_url`, not in `listing_images`.\n'
    '6. Cap at 20 images. If the page shows none, return [].\n\n'
    'GENERAL RULES:\n'
    '- Do not invent facts. Unknown scalars are null, unknown arrays [].\n'
    '- Numbers are numbers: strip $, commas, "sqm", "m2".\n'
    '- Preserve the agent\'s own price wording in display_price_text.\n'
    '- Australian addresses: keep unit/lot separate from the street address, suburb without '
    'state or postcode, and normalise street types (St->Street, Rd->Road, Ave->Avenue, '
    'Ct->Court, Cres->Crescent, Cct->Circuit, Pde->Parade, Tce->Terrace, Pl->Place, '
    'Bvd->Boulevard, Ln->Lane, Dr->Drive, Hwy->Highway).\n'
    '- listing_status: Available / Under Offer / Sold / Leased / Withdrawn / Unknown.\n'
    '- If the page is not a property listing, return listings: [] and set '
    'extraction_meta.record_type to "URL / Web Record".'
)
mod(98)['mapper']['messages'] = [
    {'role': 'system', 'content': WEB_PROMPT},
    {'role': 'user', 'content': 'Scraped page: {{92.`Web Link`}}\n\n'
                                'Page title: {{94.data.metadata.title}}\n'
                                'Open Graph image: {{94.data.metadata.`og:image`}}\n\n'
                                'Content:\n{{94.data.markdown}}\n\n'
                                'Links found on the page:\n{{join(94.data.links; newline)}}'},
]
note('F14', 'module 98 — was running the PDF-availability-sheet prompt against a scraped web '
            'page and never asked for images; replaced with a listing-page prompt whose '
            'first-class output is an ordered listing_images array')

# F15 — the feeder read a key the prompt never emitted.
mod(100)['mapper']['array'] = '{{99.listings}}'
note('F15', 'module 100 — fed on {{99.extras}}, which the extractor has never emitted, so every '
            'downstream module in the scrape branch received zero bundles; now {{99.listings}}')

# F16 — the enrichment write-back. This is the module the Listings page depends on.
mod(97)['mapper'] = {
    'id': '{{92.id}}', 'base': BASE, 'table': INTAKE,
    'record': {
        **SEEN_AGAIN,
        'fldKpnJzCHXhTGkTj': 'Webpage Scraped',
        'fldws4mnqkyyzYfM4': 'Scraped',
        'fld8mT2mVK3uWHo9O': 'Enriched',
        'fldNdNsA6DPpQIRmF': ['Images', 'Description', 'Web Link', 'Agent Details'],
        # Images, newest capture wins. Written newest-first because the first
        # URL is what the dashboard treats as the hero.
        'fldtLTvziB8H1Rt4y': '{{join(100.listing_images; newline)}}',
        'fldmsoZ47F7b4zqJk': '{{ifempty(first(100.listing_images); 94.data.metadata.`og:image`)}}',
        'fldIm2qkfYecRbZen': '{{length(100.listing_images)}}',
        'fld5DocU0IqpaAeNs': '{{now}}',
        'fldRgm1uKmfBSA78L': '{{if(length(100.listing_images); "Web Scrape"; "None Found")}}',
        # Content the scrape recovered
        'flddLP8yYsa0tIxPn': '{{substring(94.data.markdown; 0; 90000)}}',
        'fldCRxsyACyD1TwDG': '{{100.summary}}',
        'fldVurLsIoJznTKHx': '{{100.property_description}}',
        'fldO8UGR5qT0AtTJx': '{{92.`Web Link`}}',
        'fldtEJGhNp7HKhdpH': '{{join(100.alternate_web_links; newline)}}',
        'fldX9xpwBvHhXABOa': '{{100.property_features}}',
        # Agent details a scrape usually knows better than an email footer
        'fldNWkhe7nhUSTMyg': '{{100.agent_name}}',
        'fldIe2Ij5XQvVBTVs': '{{100.agent_mobile}}',
        'fldcBbNIkyBT9v0Qa': '{{100.agent_email}}',
        'fldt0FX6UIu2gXN3d': '{{100.agency_name}}',
        'fldGOk8QEhfL7x81M': '{{100.agency_website}}',
        # Inspection times move; a scrape is the fresher source
        'flduVfZFW5dmPmyKH': '{{100.inspection_start}}',
        'fldi7e5gCa2uPCcDq': '{{100.inspection_end}}',
        'fldCBmZjqDcpyH8bJ': '{{100.next_inspection_date}}',
        'fldEBzYVYwVQBRWNE': '{{100.open_home_available}}',
        # Price and status, with the previous value kept so a change is visible
        'fldNS45HvCU9Jifli': '{{100.display_price_text}}',
        'fldca09tuy3SSTIvu': '{{100.price_numeric}}',
        'fldyWGfccDS5UDQtL': '{{100.listing_status}}',
        'fldWjrqbmi5wvfEJ0': '{{100.price_numeric}}',
        'fldSXu2fxaeuu8sUd': '{{100.listing_status}}',
        'fldjjHyGw0hJVDijx': 'gpt-5',
        'fldLbXcxpOYyJR5Gc': 'Firecrawl Web Scrape',
        'fldPCQTaD8tLBIlEO': 'npc_web_listing_v1',
        'fldnCCrP2MLIS1UTf': 'NPC Email 1 / 97 (web scrape enrichment)',
        'flduR84oClLfnb76G': '{{substring(98.result; 0; 90000)}}',
    },
    'typecast': True, 'useColumnId': False}
note('F16', 'module 97 — the web-scrape enrichment wrote nothing at all; it now writes the '
            'image set (URLs, hero, count, source, Images Captured At), the scraped copy, '
            'refreshed agent and inspection details, and a price/status snapshot')

# F17 — the create-side of the scrape branch.
mod(96)['mapper'] = {
    'base': BASE, 'table': INTAKE,
    'record': {**listing_fields('100'), **provenance(), **timestamps(),
               'fldOO9RjZCQzOjKUl': 'Web Scrape',
               'fldKpnJzCHXhTGkTj': 'Webpage Scraped',
               'fldrxJ2XDayRlEJST': 'Extracted',
               'fldws4mnqkyyzYfM4': 'Scraped',
               'fld8mT2mVK3uWHo9O': 'Enriched',
               'fldjjHyGw0hJVDijx': 'gpt-5',
               'fldLbXcxpOYyJR5Gc': 'Firecrawl Web Scrape',
               'fldPCQTaD8tLBIlEO': 'npc_web_listing_v1',
               'fldnCCrP2MLIS1UTf': 'NPC Email 1 / 96 (web scrape)',
               'flduR84oClLfnb76G': '{{substring(98.result; 0; 90000)}}',
               'flddLP8yYsa0tIxPn': '{{substring(94.data.markdown; 0; 90000)}}',
               'fldtLTvziB8H1Rt4y': '{{join(100.listing_images; newline)}}',
               'fldmsoZ47F7b4zqJk': '{{ifempty(first(100.listing_images); 94.data.metadata.`og:image`)}}',
               'fldIm2qkfYecRbZen': '{{length(100.listing_images)}}',
               'fld5DocU0IqpaAeNs': '{{now}}',
               'fldRgm1uKmfBSA78L': '{{if(length(100.listing_images); "Web Scrape"; "None Found")}}'},
    'typecast': True, 'useColumnId': False}
note('F17', 'module 96 — was creating an "Error 500" row in the Emails table on the success '
            'path of the scrape; now creates the scraped listing with its images')

# ================================================== ROUTE 3: IMAGE ATTACHMENTS =
# F18 — the JPEG test was a case-sensitive equality against the full MIME type,
# so image/jpeg never matched. Nor did webp, gif or heic.
mod(23)['filter']['conditions'] = [
    [{'a': '{{7.contentType}}', 'b': 'image/', 'o': 'text:contain:ci'}],
    [{'a': '{{7.name}}', 'b': '.jpg', 'o': 'text:endwith:ci'}],
    [{'a': '{{7.name}}', 'b': '.jpeg', 'o': 'text:endwith:ci'}],
    [{'a': '{{7.name}}', 'b': '.png', 'o': 'text:endwith:ci'}],
    [{'a': '{{7.name}}', 'b': '.webp', 'o': 'text:endwith:ci'}],
    [{'a': '{{7.name}}', 'b': '.gif', 'o': 'text:endwith:ci'}],
    [{'a': '{{7.name}}', 'b': '.heic', 'o': 'text:endwith:ci'}],
]
note('F18', 'module 23 — the image filter tested contentType *equals* "jpeg" case-sensitively, '
            'so every image/jpeg attachment was silently dropped; png was the only format that '
            'ever got through. Now any image/* MIME type or image file extension')

# F19 — the image branch wrote to the legacy Properties table, and read the
# parsed root instead of the per-listing feeder, so every row in a table
# screenshot got the same empty values.
m = mod(25)
rec = {}
rec.update(listing_fields('52'))
rec.update(provenance())
rec.update(timestamps())
rec.update(extraction_meta(
    model='gpt-5.4', method='OpenAI Image Analysis',
    prompt_version='npc_image_property_extractor_v2_single_table',
    source_type='Image', stage='Image Analysed',
    raw_out='{{substring(20.choices[].message.content; 0; 90000)}}',
    in_chars=None,
    out_chars='{{length(20.choices[].message.content)}}',
    listing_count='{{length(26.listings)}}',
    module_label='NPC Email 1 / 25 (image attachment)'))
rec.update({
    'fldaS9MprydWuSX18': '{{19.filename}}',
    'fldYmaRJzPUZo78o2': '{{7.contentType}}',
    'fldfaTFaeNkSqK1Gq': '{{19.size}}',
    'fldslJJYOuehwP6tb': 'Image',
    'fldba6zTzgjOT591O': '{{24.webContentLink}}',
    'fld3dVFVuDjRAOh4N': '{{24.id}}',
    'fld88J5N9PEKrd2yr': '{{24.webContentLink}}',
    # The attachment itself is the photo. This is the one path where we hold the
    # bytes, so it goes into the attachment column as well as the URL list.
    'fldzVIdZI5TKYgeP6': [{'url': '{{24.webContentLink}}', 'filename': '{{19.filename}}'}],
    'fldtLTvziB8H1Rt4y': '{{24.webContentLink}}',
    'fldmsoZ47F7b4zqJk': '{{24.webContentLink}}',
    'fldIm2qkfYecRbZen': 1,
    'fld5DocU0IqpaAeNs': '{{now}}',
    'fldRgm1uKmfBSA78L': 'Email Attachment',
})
m['mapper'] = {'base': BASE, 'table': INTAKE, 'record': rec,
               'typecast': True, 'useColumnId': False}
note('F19', 'module 25 — retargeted from Properties to Property Intake Master, and moved off '
            'the parsed-JSON root ({{26.*}}) onto the per-listing feeder ({{52.*}}), which is '
            'why every row of a multi-row screenshot used to land identical and empty. '
            'The attachment now also fills Listing Images / Listing Image URLs')

# F20 — filter referenced a key that does not exist ("listing" for "listings").
mod(49)['filter']['conditions'] = [[{'a': '{{26.listings[]}}', 'o': 'notexist'}]]
mod(49)['mapper']['record']['fldx96rScPizG9Brh'] = 'Invalid AI JSON'
mod(49)['mapper']['typecast'] = True
note('F20', 'module 49 — invalid-JSON filter tested {{26.listing[]}}; the key is `listings`, '
            'so the branch never fired and image failures were invisible')

# ==================================================== ROUTE 4: URL BREAKDOWN ==
# F21 — every URL in the email was fetched, including one-click unsubscribe and
# tracking pixels, and the result was a prose "breakdown of the business"
# dropped into a notes column.
mod(17)['filter'] = {
    'name': 'Not a tracking or unsubscribe link',
    'conditions': [[
        {'a': '{{13.__IMTMATCH__}}', 'b': 'unsubscribe', 'o': 'text:notcontain:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': 'optout', 'o': 'text:notcontain:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': 'opt-out', 'o': 'text:notcontain:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': 'list-manage', 'o': 'text:notcontain:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': 'mailchi', 'o': 'text:notcontain:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': '/track', 'o': 'text:notcontain:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': 'click.', 'o': 'text:notcontain:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': 'pixel', 'o': 'text:notcontain:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': 'beacon', 'o': 'text:notcontain:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': '.png', 'o': 'text:notendwith:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': '.jpg', 'o': 'text:notendwith:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': '.gif', 'o': 'text:notendwith:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': '.css', 'o': 'text:notendwith:ci'},
        {'a': '{{13.__IMTMATCH__}}', 'b': '.js', 'o': 'text:notendwith:ci'},
    ]],
}
mod(14)['mapper']['messages'] = [{
    'role': 'user',
    'content': 'Return ONLY a JSON object {"is_property_listing":true|false,'
               '"page_title":"string|null","address":"string|null","suburb":"string|null",'
               '"display_price_text":"string|null","agency_name":"string|null",'
               '"listing_images":["absolute https urls, property photos only, hero first"],'
               '"summary":"one factual sentence"} describing this page. No prose, no markdown. '
               'Page URL: {{13.__IMTMATCH__}}\n\nContent:\n{{substring(17.data; 0; 60000)}}',
}]
mod(14)['mapper']['response_format'] = 'json_object'
mod(14)['mapper']['parseJSONResponse'] = True
mod(15)['mapper']['record'] = {
    'fldUvSkOwJ0Zn69Id': 'Property URL followed: {{13.__IMTMATCH__}}\n\n'
                         'Page read: {{substring(14.result; 0; 20000)}}',
}
mod(15)['mapper']['typecast'] = True
note('F21', 'modules 13/14/15 — the URL branch GET-ed every link in the email, including '
            'unsubscribe and tracking URLs, then asked a model for a prose "breakdown of the '
            'business" and dropped it into a notes column. It now only follows links that look '
            'like listing pages, returns structured JSON, and records the URLs it followed')

# --------------------------------------------------------------- serialise ---
json.dump(bp, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f'{len(edits)} edits applied\n')
for e in edits:
    print(' -', e)
print('\nwrote', OUT, len(json.dumps(bp)), 'bytes')
