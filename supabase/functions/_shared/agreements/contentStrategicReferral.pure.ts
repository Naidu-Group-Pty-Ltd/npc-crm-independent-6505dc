/**
 * AGREEMENT 01 — Strategic Property Referral Agreement.
 * Issued by the Buyer's Agency to the Finance Partner.
 *
 * ## LOCKED LEGAL CONTENT — read before editing anything in this file
 *
 * Every string below is transcribed verbatim from the supplied template
 * (`Finance_Portal_Template__Buyers_Agent_to_Finance_Partner_Agreement_.docx`).
 * The wording is legal content and is NOT this codebase's to improve: no
 * rephrasing, no renumbering, no shortening, no "fixing", no added clauses.
 * The single permitted transformation is the one the template invites — its
 * `<<INSERT>>`-style brackets are written as `{{field_key}}` binding tokens,
 * and each field's ORIGINAL bracket text is preserved as the placeholder in
 * `fields.pure.ts`, so an unfilled render prints exactly what the template
 * printed.
 *
 * An edit here changes `agreementContentHash` for every subsequently issued
 * version, which is deliberate: the hash frozen on each issued version row is
 * how an audit proves which wording a partner reviewed and executed.
 *
 * ## Authorised amendment — 9 Aug 2026
 *
 * The rule above says "no renumbering", and this file has been renumbered. It
 * was not this codebase's decision: the document owner supplied a reviewed copy
 * with the operational **REFERRAL WORKFLOW** section (the seven handover stages
 * and the information-boundary note) removed, and confirmed the removal was
 * deliberate before it was applied here.
 *
 * What changed, and nothing else:
 *   - the `referral_workflow` section was deleted in full;
 *   - section badges 4, 5-7, 8-10, 11-13 and 14 became 3, 4-6, 7-9, 10-12, 13;
 *   - clauses 5-13 became 4-12, with their subclauses.
 *
 * **Not one word of any clause changed.** The supplied copy was diffed line by
 * line against this module's output and the only differences were the removed
 * section and the numbers above; `agreementWhiteLabel.spec.ts` and
 * `agreements.spec.ts` hold that shape. The rule still stands for everyone
 * else: renumbering happens when the document owner says so, in writing, and
 * never to tidy something up.
 */

import type { AgreementTemplateContent } from './types.pure.ts';

export const STRATEGIC_REFERRAL_CONTENT: AgreementTemplateContent = {
  key: 'strategic_property_referral',
  title: 'Strategic Property Referral Agreement',
  direction: 'inbound_property_referral',
  issuedByLine: 'ISSUED BY THE BUYER\'S AGENCY TO THE FINANCE PARTNER',
  documentVersion: '2.0',
  sections: [
    {
      id: 'cover',
      header: null,
      audience: 'always',
      blocks: [
        {
          kind: 'cover',
          logoPlaceholder: '[ INSERT COMPANY LOGO ]',
          companyNameToken: '{{company_name}}',
          titleLines: ['STRATEGIC PROPERTY REFERRAL', 'AGREEMENT'],
          issuedByLine: 'ISSUED BY THE BUYER\'S AGENCY TO THE FINANCE PARTNER',
          // Issuer first: this agreement is issued BY the buyer's agency.
          particulars: [
            { label: 'BETWEEN', value: '{{ba_legal_name}}' },
            { label: 'ABN / ACN', value: '{{ba_abn_acn}}' },
            { label: 'AND', value: '{{fp_legal_name}}' },
            { label: 'ABN / ACN', value: '{{fp_abn_acn}}' },
            { label: 'DATED', value: '{{effective_date}}' },
            { label: 'GOVERNING LAW', value: '{{governing_state}}' },
          ],
          versionLine: 'EFFECTIVE DATE: {{effective_date}}',
          reviewStatement:
            'Template only - obtain legal, licensing, privacy and aggregator approval before use.',
        },
      ],
    },

    {
      id: 'email_pack',
      header: {
        badge: 'E',
        heading: 'PARTNER EMAIL TEMPLATE',
        hint: 'Editable introductory correspondence',
        sub: 'Customise, approve and issue',
      },
      audience: 'template_pack',
      blocks: [
        {
          kind: 'note',
          label: 'How to use this page',
          body:
            'Replace all bracketed fields, attach the agreement and commercial schedule, obtain internal approval, and delete this guidance card before issue.',
        },
        {
          kind: 'emailTemplate',
          subjectLabel: 'SUBJECT',
          subject:
            'Strategic Referral Partnership - {{ba_display_name}} and {{fp_display_name}}',
          bodyParagraphs: [
            'Hi {{recipient_first_name}},',
            'Thank you for discussing a potential referral partnership between {{ba_display_name}} and {{fp_display_name}}.',
            'Attached is our editable Strategic Property Referral Agreement. It is designed for circumstances where your finance team identifies a client who may benefit from independent property strategy, buyer advocacy, property selection, due diligence or acquisition support.',
            'The commercial schedule has deliberately been left open so the parties can negotiate the referral model, qualifying event, payment timeframe, GST treatment and exclusions before execution.',
            'Please have the agreement reviewed by your legal, compliance, ACL-holder and aggregator teams where applicable. Once the commercial schedule is agreed, we can finalise the document for electronic execution and activate the referral workflow.',
          ],
          signoffLines: [
            'Kind regards,',
            '{{sender_name}}',
            '{{sender_title}}',
            '{{company_name}}',
            '{{company_phone}}  |  {{company_email}}  |  {{company_website}}',
          ],
          checklistTitle: 'ACTIVATION CHECKLIST',
          checklist: [
            { step: '1', title: 'CUSTOMISE', detail: 'Company, contact and commercial fields' },
            { step: '2', title: 'REVIEW', detail: 'Legal, compliance, ACL and aggregator' },
            { step: '3', title: 'EXECUTE', detail: 'Approved electronic or wet signature' },
            { step: '4', title: 'ACTIVATE', detail: 'Secure referral and reporting workflow' },
          ],
          attachmentsTitle: 'ATTACHMENTS',
          attachments: [
            'Strategic Property Referral Agreement',
            'Commercial Schedule',
            'Referral Registration Form',
          ],
        },
      ],
    },

    {
      id: 'agreement_details',
      header: {
        badge: '1',
        heading: 'AGREEMENT DETAILS',
        hint: 'Complete before issue',
        sub: 'Core entity and authority information',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'note',
          label: 'Completion standard',
          body:
            'Use the exact legal entity names, registration details, licence information and service addresses that will appear in the executed agreement.',
        },
        {
          kind: 'grid',
          rows: [
            [
              { label: 'AGREEMENT DATE', fieldKey: 'effective_date' },
              { label: 'GOVERNING STATE / TERRITORY', fieldKey: 'governing_state' },
            ],
            [
              { label: 'BUYER\'S AGENCY LEGAL NAME', fieldKey: 'ba_legal_name' },
              { label: 'BUYER\'S AGENCY TRADING NAME', fieldKey: 'ba_trading_name' },
            ],
            [
              { label: 'ABN / ACN', fieldKey: 'ba_abn_acn' },
              { label: 'REAL ESTATE LICENCE DETAILS', fieldKey: 'ba_re_licence' },
            ],
            [
              { label: 'REGISTERED ADDRESS', fieldKey: 'ba_address' },
              { label: 'PRIMARY EMAIL', fieldKey: 'ba_email' },
            ],
            [
              { label: 'FINANCE PARTNER LEGAL NAME', fieldKey: 'fp_legal_name' },
              { label: 'FINANCE PARTNER TRADING NAME', fieldKey: 'fp_trading_name' },
            ],
            [
              { label: 'ABN / ACN', fieldKey: 'fp_abn_acn' },
              { label: 'ACL / CREDIT REPRESENTATIVE NUMBER', fieldKey: 'fp_acl_crn' },
            ],
            [
              { label: 'REGISTERED ADDRESS', fieldKey: 'fp_address' },
              { label: 'PRIMARY EMAIL', fieldKey: 'fp_email' },
            ],
          ],
        },
        {
          kind: 'note',
          label: 'Parties',
          body:
            'The buyer\'s agency is the recipient of property-service referrals. The finance partner is the referring party. Each remains independent and responsible for its own services, staff, licensing, advice and client documentation.',
        },
      ],
    },

    {
      id: 'purpose_scope',
      header: {
        badge: '2',
        heading: 'PURPOSE & SCOPE',
        hint: 'Clear service boundaries',
        sub: 'Independent services. Coordinated client journey.',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'dualPanel',
          left: {
            title: 'BUYER\'S AGENCY RESPONSIBILITIES',
            bullets: [
              'Provide property strategy, research, property identification and buyer advocacy services under a separate client engagement.',
              'Undertake appropriate property due diligence, negotiation and acquisition coordination within its licensed scope.',
              'Explain its own fees, service limitations and conflicts directly to the client.',
              'Provide only agreed high-level milestone updates to the finance partner, subject to client consent.',
              'Not provide credit assistance, lender recommendations or financial product advice unless separately licensed and authorised.',
            ],
          },
          right: {
            title: 'FINANCE PARTNER RESPONSIBILITIES',
            bullets: [
              'Identify clients who may require property acquisition or buyer advocacy support.',
              'Obtain client consent before sharing personal information or making the introduction.',
              'Continue to manage all borrowing-capacity, credit, loan application and lender communications.',
              'Maintain all required ACL, credit representative, aggregator and lender authorisations.',
              'Avoid representing that the buyer\'s agency guarantees a property outcome, valuation, loan approval or investment return.',
            ],
          },
        },
        {
          kind: 'note',
          label: 'Boundary principle',
          body:
            'The referral relationship coordinates handover and milestone visibility. It does not merge professional responsibilities, advice scopes or client contracts.',
        },
      ],
    },

    {
      id: 'operative_purpose',
      header: {
        badge: '2A',
        heading: 'PURPOSE & SERVICES',
        hint: 'Operative clauses',
        sub: 'Establishment, scope and separate client engagement',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'clauses',
          clauses: [
            {
              number: '1',
              heading: 'Purpose of Agreement',
              subclauses: [
                {
                  number: '1.1',
                  text: 'This Agreement establishes a structured referral relationship under which the Finance Partner may introduce clients to the Buyer\'s Agency for property consulting and buyer advocacy services.',
                },
                {
                  number: '1.2',
                  text: 'The objective is to support a coordinated client journey while preserving the client\'s freedom of choice and the independent professional responsibilities of each party.',
                },
                {
                  number: '1.3',
                  text: 'Nothing in this Agreement creates a partnership, joint venture, agency, employment, fiduciary relationship or authority for either party to bind the other.',
                },
              ],
            },
            {
              number: '2',
              heading: 'Services and Client Engagement',
              subclauses: [
                {
                  number: '2.1',
                  text: 'The Buyer\'s Agency may offer property strategy, search, appraisal, due diligence, negotiation and acquisition coordination services, subject to its own client agreement.',
                },
                {
                  number: '2.2',
                  text: 'The Finance Partner remains solely responsible for credit services, lending advice, credit assistance, loan structuring, application management and lender liaison.',
                },
                {
                  number: '2.3',
                  text: 'Each party may accept or decline a referral or client engagement in its discretion and must promptly communicate any material inability to proceed.',
                },
              ],
            },
          ],
        },
        {
          kind: 'note',
          label: 'Operational outcome',
          body:
            'Each referral moves into a separate property-services engagement only after the buyer\'s agency explains its services and the client chooses to proceed.',
        },
      ],
    },

    {
      id: 'commercial_schedule',
      header: {
        badge: '3',
        heading: 'COMMERCIAL SCHEDULE',
        hint: 'Finance partner referral to buyer\'s agency',
        sub: 'Complete every applicable field before execution',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'note',
          label: 'No pre-set commercial terms',
          body:
            'This schedule intentionally contains no fixed fee, percentage or payment timeframe. The parties must complete every applicable field before execution.',
        },
        {
          kind: 'grid',
          rows: [
            [
              {
                label: 'REMUNERATION MODEL',
                choice: {
                  fieldKey: 'remuneration_model',
                  options: [
                    { value: 'fixed_fee', label: 'Fixed fee' },
                    { value: 'percentage_of_fee', label: 'Percentage of buyer\'s agency fee' },
                    { value: 'other', label: 'Other:' },
                  ],
                  otherFieldKey: 'remuneration_model_other',
                },
              },
              { label: 'AGREED AMOUNT / PERCENTAGE', fieldKey: 'agreed_fee_value' },
            ],
            [
              {
                label: 'GST TREATMENT',
                choice: {
                  fieldKey: 'gst_treatment',
                  options: [
                    { value: 'plus_gst', label: 'Plus GST' },
                    { value: 'inclusive_of_gst', label: 'GST inclusive' },
                    { value: 'not_applicable', label: 'Not applicable' },
                  ],
                },
              },
              {
                label: 'QUALIFYING EVENT',
                choice: {
                  fieldKey: 'qualifying_event',
                  options: [
                    { value: 'Engagement signed', label: 'Engagement signed' },
                    { value: 'Unconditional contract', label: 'Unconditional contract' },
                    { value: 'Settlement', label: 'Settlement' },
                    { value: 'other', label: 'Other:' },
                  ],
                  otherFieldKey: 'qualifying_event_other',
                },
              },
            ],
            [
              {
                label: 'PAYMENT TIMEFRAME',
                template: '{{payment_timeframe_days}} business days after the qualifying event and valid invoice',
              },
              {
                label: 'INVOICE PROCESS',
                choice: {
                  fieldKey: 'invoice_process',
                  options: [
                    { value: 'tax_invoice', label: 'Tax invoice' },
                    { value: 'rcti', label: 'RCTI' },
                    { value: 'other', label: 'Other:' },
                  ],
                  otherFieldKey: 'invoice_process_other',
                },
              },
            ],
            [
              { label: 'EXCLUDED MATTERS', fieldKey: 'excluded_matters' },
              { label: 'DUPLICATE REFERRAL RULE', fieldKey: 'duplicate_referral_rule' },
            ],
            [
              { label: 'FEE CAP / MINIMUM', fieldKey: 'fee_cap_minimum' },
              { label: 'POST-TERMINATION ENTITLEMENT', fieldKey: 'post_termination_entitlement' },
            ],
          ],
        },
        {
          kind: 'note',
          label: 'Commercial control',
          body:
            'Commercial terms may only be changed by a written variation signed by both parties. No amount is payable unless the agreed qualifying event occurs and all disclosure, consent and invoicing requirements have been satisfied.',
        },
      ],
    },

    {
      id: 'consent_privacy',
      header: {
        badge: '4-6',
        heading: 'CLIENT CONSENT, PRIVACY & COMMUNICATIONS',
        hint: 'Client choice and controlled information exchange',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'clauses',
          clauses: [
            {
              number: '4',
              heading: 'Client Consent and Disclosure',
              subclauses: [
                {
                  number: '4.1',
                  text: 'The Finance Partner must obtain the client\'s consent before disclosing personal information to the Buyer\'s Agency.',
                },
                {
                  number: '4.2',
                  text: 'Each party must clearly disclose any referral payment or other material benefit where disclosure is required by law, professional standards, licence conditions, aggregator policy or the party\'s internal compliance framework.',
                },
                {
                  number: '4.3',
                  text: 'The client remains free to decline the referral, choose another provider or cease dealing with either party.',
                },
              ],
            },
            {
              number: '5',
              heading: 'Privacy and Data Security',
              subclauses: [
                {
                  number: '5.1',
                  text: 'Each party must handle personal information in accordance with applicable privacy laws, its privacy policy and reasonable security controls.',
                },
                {
                  number: '5.2',
                  text: 'Personal information may only be used for the referral, service delivery, payment administration, compliance and lawful record-keeping purposes.',
                },
                {
                  number: '5.3',
                  text: 'A party must promptly notify the other of any suspected privacy incident materially affecting referred clients and cooperate with lawful response obligations.',
                },
              ],
            },
            {
              number: '6',
              heading: 'Client Communications',
              subclauses: [
                {
                  number: '6.1',
                  text: 'Neither party may communicate on behalf of the other without written authority.',
                },
                {
                  number: '6.2',
                  text: 'Status updates must be factual, proportionate and limited to the milestones approved by the client and the parties.',
                },
                {
                  number: '6.3',
                  text: 'Neither party may guarantee finance approval, property performance, valuation, settlement timing or any financial outcome.',
                },
              ],
            },
          ],
        },
      ],
    },

    {
      id: 'protections',
      header: {
        badge: '7-9',
        heading: 'RELATIONSHIP PROTECTIONS & RISK ALLOCATION',
        hint: 'Independent responsibility and fair dealing',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'clauses',
          clauses: [
            {
              number: '7',
              heading: 'Client Relationships and Non-Circumvention',
              subclauses: [
                {
                  number: '7.1',
                  text: 'The Finance Partner retains responsibility for its lending relationship and the Buyer\'s Agency retains responsibility for its property-services relationship.',
                },
                {
                  number: '7.2',
                  text: 'Neither party may intentionally bypass the agreed referral process to avoid an accrued payment or knowingly solicit the other party\'s client for directly competing services outside its normal professional scope.',
                },
                {
                  number: '7.3',
                  text: 'Nothing prevents a client from independently choosing, changing or engaging service providers.',
                },
              ],
            },
            {
              number: '8',
              heading: 'Confidentiality, Insurance and Records',
              subclauses: [
                {
                  number: '8.1',
                  text: 'Each party must keep confidential non-public client, commercial and operational information and disclose it only as authorised or required by law.',
                },
                {
                  number: '8.2',
                  text: 'Each party must maintain insurance reasonably appropriate to its services and legal obligations.',
                },
                {
                  number: '8.3',
                  text: 'Each party must retain referral, consent, disclosure, invoice and payment records for the period required by applicable law and its compliance framework.',
                },
              ],
            },
            {
              number: '9',
              heading: 'Liability and Indemnity',
              subclauses: [
                {
                  number: '9.1',
                  text: 'Each party remains responsible for its own acts, omissions, advice, representations, staff, contractors and regulatory obligations.',
                },
                {
                  number: '9.2',
                  text: 'To the extent permitted by law, each party indemnifies the other against third-party loss arising directly from its material breach, negligence, unlawful conduct or unauthorised representation.',
                },
                {
                  number: '9.3',
                  text: 'Neither party is liable for the independent decision of a client, lender, vendor, valuer, insurer or other third party, except to the extent caused by that party\'s own breach or negligence.',
                },
              ],
            },
          ],
        },
      ],
    },

    {
      id: 'term_general',
      header: {
        badge: '10-12',
        heading: 'TERM, TERMINATION & GENERAL PROVISIONS',
        hint: 'Lifecycle, disputes and governing law',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'clauses',
          clauses: [
            {
              number: '10',
              heading: 'Term and Termination',
              subclauses: [
                {
                  number: '10.1',
                  text: 'This Agreement starts when signed by both parties and continues until terminated.',
                },
                {
                  number: '10.2',
                  text: 'Either party may terminate without cause by giving {{termination_notice_days}} days\' written notice.',
                },
                {
                  number: '10.3',
                  text: 'A party may terminate immediately for an unremedied material breach after {{breach_remedy_days}} business days\' written notice, fraud, gross misconduct, insolvency, loss of required licence or material regulatory risk.',
                },
                {
                  number: '10.4',
                  text: 'Termination does not affect rights and obligations accrued before termination, including any payment entitlement preserved in the Commercial Schedule.',
                },
              ],
            },
            {
              number: '11',
              heading: 'Dispute Resolution',
              subclauses: [
                {
                  number: '11.1',
                  text: 'A party must first give written details of a dispute and allow senior representatives to attempt resolution in good faith.',
                },
                {
                  number: '11.2',
                  text: 'If unresolved within {{dispute_resolution_days}} business days, the parties may refer the dispute to mediation before commencing court proceedings, except for urgent relief.',
                },
              ],
            },
            {
              number: '12',
              heading: 'Notices and General',
              subclauses: [
                {
                  number: '12.1',
                  text: 'Notices must be in writing and sent to the addresses or emails stated in the Agreement Details, as updated by notice.',
                },
                {
                  number: '12.2',
                  text: 'This Agreement, including completed schedules, is the entire agreement on its subject matter and may only be varied in writing signed by both parties.',
                },
                {
                  number: '12.3',
                  text: 'Neither party may assign this Agreement without the other party\'s written consent, not to be unreasonably withheld, except as part of a genuine business restructure that does not reduce the other party\'s rights.',
                },
                {
                  number: '12.4',
                  text: 'If a provision is invalid, it is severed to the minimum extent required. The remaining provisions continue.',
                },
                {
                  number: '12.5',
                  text: 'This Agreement is governed by the laws of {{governing_state}} and the parties submit to the courts of that jurisdiction.',
                },
              ],
            },
          ],
        },
      ],
    },

    {
      id: 'execution',
      header: {
        badge: '13',
        heading: 'EXECUTION',
        hint: 'Electronic or wet signature',
        sub: 'Complete only after all schedules are final',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'note',
          label: 'Execution note',
          body:
            'Select the execution block appropriate to each entity. The parties may execute counterparts and use an approved electronic signature platform.',
        },
        {
          kind: 'execution',
          parties: [
            { role: 'principal', title: 'SIGNED FOR THE BUYER\'S AGENCY' },
            { role: 'partner', title: 'SIGNED FOR THE FINANCE PARTNER' },
          ],
        },
        {
          kind: 'note',
          label: 'Optional company execution under section 127 of the Corporations Act 2001 (Cth):',
          body:
            'Use the block below only where it is appropriate for the executing entity and approved by the relevant advisers.',
        },
        {
          kind: 'grid',
          rows: [
            [
              { label: 'DIRECTOR / SOLE DIRECTOR', text: '<<NAME AND SIGNATURE>>' },
              { label: 'DIRECTOR / COMPANY SECRETARY', text: '<<NAME AND SIGNATURE OR N/A>>' },
            ],
          ],
        },
      ],
    },

    {
      id: 'form_referral_registration',
      header: {
        badge: 'A',
        heading: 'REFERRAL REGISTRATION FORM',
        hint: 'Finance partner to buyer\'s agency',
        sub: 'Secure referral and activation record',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'grid',
          rows: [
            [
              { label: 'REFERRAL ID', text: '<<AUTO-GENERATED OR INSERT>>' },
              { label: 'REFERRAL DATE', text: '<<DATE>>' },
            ],
            [
              { label: 'FINANCE PARTNER', text: '<<LEGAL / TRADING NAME>>' },
              { label: 'REFERRING ADVISER', text: '<<NAME AND CRN IF APPLICABLE>>' },
            ],
            [
              { label: 'CLIENT NAME', text: '<<CLIENT NAME>>' },
              { label: 'CLIENT CONTACT DETAILS', text: '<<PHONE AND EMAIL>>' },
            ],
            [
              { label: 'GENERAL PROPERTY REQUIREMENT', text: '<<OWNER-OCCUPIED / INVESTMENT / OTHER>>' },
              { label: 'ESTIMATED TIMING', text: '<<INSERT>>' },
            ],
            [
              { label: 'CONSENT OBTAINED', text: '☐ Yes   ☐ No' },
              { label: 'BENEFIT DISCLOSED', text: '☐ Yes   ☐ No   ☐ Not applicable' },
            ],
            [
              { label: 'PRIOR CLIENT CHECK', text: '☐ New   ☐ Existing   ☐ Duplicate' },
              { label: 'ASSIGNED CONSULTANT', text: '<<INSERT>>' },
            ],
            [
              { label: 'CURRENT STATUS', text: '☐ Submitted  ☐ Accepted  ☐ Contacted  ☐ Engaged  ☐ Contracted  ☐ Settled' },
              { label: 'COMMERCIAL ELIGIBILITY', text: '☐ Pending   ☐ Eligible   ☐ Not eligible' },
            ],
          ],
        },
        {
          kind: 'note',
          label: 'Permitted update fields',
          body:
            'Subject to client consent, status updates should be limited to high-level milestones such as contacted, engaged, searching, contract signed, finance milestone and settled. Detailed financial or personal information should not be disclosed unless specifically authorised.',
        },
      ],
    },
  ],
};
