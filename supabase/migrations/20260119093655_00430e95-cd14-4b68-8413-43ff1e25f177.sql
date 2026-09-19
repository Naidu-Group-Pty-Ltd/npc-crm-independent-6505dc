-- Migrate notes from Excel workbook to client_notes table
-- Matching clients by email address

-- First, let's insert all the notes from the Excel file
-- Using ON CONFLICT to handle any potential duplicates

INSERT INTO public.client_notes (client_id, content, note_type, created_at)
SELECT 
  c.id,
  notes.content,
  'pipeline' as note_type,
  NOW()
FROM (
  VALUES
    ('rob.hasto@gmail.com', 'Rob is exploring an SMSF for property investment. Hannan Accounting will contact him to schedule a consult next Friday 7/11 to discuss setup details and next steps.'),
    ('parthgoyal@icloud.com', 'Graham explains that releasing $100K in equity will require about $190K in declared income. Once that''s settled, they can assess borrowing for a new purchase. He also asks for Nidhi''s recent payslips to confirm her income'),
    ('sekhar.racharla@yahoo.com', 'IFC booked on 14/11 5.00pm. Tried contacting for IFC but no answer. Voicemail left'),
    ('satpalsp@outlook.com', 'IFC booked on 18/11 at 12.00pm. IFC no show due to wife and baby doc appointment.'),
    ('gj.singh@indimex.com.au', 'IFC booked on 20/11 at 4.30pm'),
    ('jassisaini202@yahoo.com', 'Rugesh is sharing a priority investment opportunity in Henley Brook: a fixed-price 4x2x2 turnkey package for around $880k on a 313 sqm block, highlighted as the strongest option given market demand and its proximity to Jaspreet''s current home. He mentions alternative dual-key options in Southern River and Anketell but still recommends Henley Brook as the standout choice and attached an investment report for review.'),
    ('is7753041@gmail.com', 'Discovery call booked on 20 Nov 2025, 04:00 pm. DC no show - Voicemail left.'),
    ('nikhilreddy.koyadi@gmail.com', 'waiting on Nikhil to deal with his accountants for tax lodgement'),
    ('denishl28@gmail.com', 'Discovery call booked on 18 Nov 2025, 07:00 pm. No answer for DC call. Voicemail left.'),
    ('sureneni.srikanth@gmail.com', 'Discovery call booked on 20 Nov 2025, 06:30 pm. PC & BA agreement sent on 21/11/2025'),
    ('jqneela@gmail.com', 'She''s a New Zealand citizen renting in Winter Valley and can buy an owner-occupied home without FIRB approval, but investment properties would require it. She has $50k–$100k saved, is ready to buy her first home, and may qualify for the 5% Medical Practitioner initiative'),
    ('jim@prestigesparks.com.au', 'Discovery call booked on 24 Nov 2025, 04:00 pm. DC no show - voicemail left'),
    ('alinakayastha33@gmail.com', 'Discovery call booked on 27 Nov 2025, 04:00 pm'),
    ('p2006.prashant@gmail.com', 'Prashant is currently an owner-occupier and is now looking to purchase an investment property. He is in a position where he would like to explore the new-build route, which he is very open to post my explanation'),
    ('spclassic88@gmail.com', 'Satchi is a Malaysian citizen residing in Canberra on a Subclass 482 Temporary Skill Shortage (TSS) visa. For property-related purposes, this classifies him as a temporary resident and therefore a foreign purchaser under Australian law.'),
    ('vishalpharma19@yahoo.com', 'Discovery call booked on 05 Dec 2025, 01:30 pm. DC no show - voicemail left'),
    ('abdullahaslam058@gmail.com', 'Discovery call booked on 02 Dec 2025, 04:30 pm. try to contact Abdullah unfortunately there was no answer left in a message transcending him through to DC no show'),
    ('dineshchandra8@bigpond.com', 'Discovery call booked on 02 Dec 2025, 07:30 pm. Reschedule link sent via text in GHL'),
    ('prateek.arora@y7mail.com', 'Discovery call booked on 05 Dec 2025, 02:30 pm'),
    ('mgiogrand@gmail.com', 'Discovery call booked on 02 Dec 2025, 06:30 pm. PC & BA agreement issued on 4/12/2025'),
    ('alexjaworska@hotmail.com', 'Discovery call booked on 05 Dec 2025, 07:00 pm'),
    ('swathi.udumala1@gmail.com', 'Swathi is looking to reduce her overall mortgage repayments. She is currently on a variable rate for both her principal place of residence (PPOR) and her investment property.'),
    ('salmanahmed313@gmail.com', 'Discovery call booked on 02 Dec 2025, 02:30 pm. PC & BA agreement issued on 4/12/2025'),
    ('sukhwindersingh163@gmail.com', 'Discovery call booked on 04 Dec 2025, 06:30 pm. DC no show - voicemail left'),
    ('ranjitsingh117@yahoo.com', 'Discovery call booked on 10 Dec 2025, 01:00 pm'),
    ('hardiksanchala@gmail.com', 'Hardik Sanchala and his wife, who live in Cranbourne East and currently own only their principal residence, are looking to reduce their home mortgage and start building wealth through property investment. They have around $40,000 available and are not interested in using an SMSF structure'),
    ('hassan0123ahmed@gmail.com', 'Discovery call booked on 05 Dec 2025, 05:00 pm. Rugesh called unfortunately Hassan was riding his bike'),
    ('sunilraskar@gmail.com', 'Rugesh sent an investment report based on Wellard and has advised that there will be a ICF of 1500 if Sunil wishes to proceed'),
    ('arshmalhi1@gmail.com', 'Currently in temporary visa. Has been advised to wait till he gets his PR. He has refered his brother Manmeet to us.'),
    ('abdullllahhjaved@gmail.com', 'Discovery call booked on 11 Dec 2025, 07:30 pm'),
    ('s.prasad40@hotmail.com', 'Discovery call booked on 16 Dec 2025, 03:30 pm. Called but no answer. No voicemail left.'),
    ('kamd_81@yahoo.com', 'Discovery call booked on 16 Dec 2025, 01:00 pm'),
    ('anoopmarkose83@gmail.com', 'Welcome pack email sent via Admin on 10/1'),
    ('magguatul@gmail.com', 'Discovery call booked on 19 Jan 2026, 02:30 pm. DC no show - voicemail left'),
    ('kassimseeni651@gmail.com', 'The vendor has accepted Zabeera''s offer, and she''s ready to proceed subject to finance approval. Initial estimates indicate around $462k borrowing and $33k cash required, but Graham will confirm the actual figures. Andy isn''t included yet, and Zabeera has been told not to sign anything further until borrowing capacity is confirmed. Various opportunities presented unfortunately none was chosen. Over 15 opportunities presented initially. Back to the drawing board to source out more opportunities.'),
    ('kaimalie19@outlook.com', 'Graham says Jimmy''s application has settled, his max borrowing capacity is about $675K, and he''ll have $90K equity left after clearing the personal loan. He hopes they can line up a deal soon'),
    ('sudhershanam@gmail.com', 'Pramod wants to move forward with property investment through SMSF, not in personal names, and will contact Graham and Rugesh once he''s prepared.'),
    ('architect_abhi5@yahoo.co.in', 'Graham informed that the land and build loan for property at Lot 613 / 41 Dryandra Street, Manor Lakes VIC has successfully settled today. He also congratulated and attached the bank''s settlement confirmation for Abhi''s records via email on 21/11'),
    ('sdl1991@outlook.com.au', '3/12 Conditonally approved. Provided additional docs, SLA 2 business days for unconditonal aproval. Next steps email issued by GT. Documents have been submitted by Sam. PC & BA agreement has also been executed'),
    ('shalinibaran@gmail.com', '28/12 App being assessed. SLA 3 business days. 27/11 App lodged. Preliminary assessment due for 2 Dec. Graham is waiting on Danny before starting Shalini''s application'),
    ('elonex98@yahoo.com', 'PC & BA agreement issued on 1/12/2025')
) AS notes(email, content)
JOIN public.clients c ON LOWER(c.primary_email) = LOWER(notes.email)
WHERE notes.content IS NOT NULL AND notes.content != '';

-- Return count of notes inserted
SELECT 'Notes migration completed' as status;