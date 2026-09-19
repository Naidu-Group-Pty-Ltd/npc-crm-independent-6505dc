/**
 * AGREEMENT 02 — Finance Referral & Commission Agreement.
 * Issued by the Finance Partner to the Buyer's Agency.
 *
 * ## LOCKED LEGAL CONTENT — read before editing anything in this file
 *
 * Every string below is transcribed verbatim from the supplied template
 * (`Finance_Portal_Template__Finance_Referral__Commission_Agreement_.docx`),
 * under the same rule as `contentStrategicReferral.pure.ts`: the wording is
 * legal content and may not be rephrased, renumbered, shortened or corrected —
 * clause 7's heading spells "Reciept" because the supplied document does, and
 * it stays that way until the counterparties execute different wording. The
 * `<<INSERT>>` brackets become `{{field_key}}` binding tokens; the original
 * bracket text is each field's placeholder in `fields.pure.ts`.
 */

import type { AgreementTemplateContent } from './types.pure.ts';

export const FINANCE_REFERRAL_CONTENT: AgreementTemplateContent = {
  key: 'finance_referral_commission',
  title: 'Finance Referral & Commission Agreement',
  direction: 'outbound_finance_referral',
  issuedByLine: 'ISSUED BY THE FINANCE PARTNER TO THE BUYER\'S AGENCY',
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
          titleLines: ['FINANCE REFERRAL &', 'COMMISSION AGREEMENT'],
          issuedByLine: 'ISSUED BY THE FINANCE PARTNER TO THE BUYER\'S AGENCY',
          // Issuer first: this agreement is issued BY the finance partner.
          particulars: [
            { label: 'BETWEEN', value: '{{fp_legal_name}}' },
            { label: 'ABN / ACN', value: '{{fp_abn_acn}}' },
            { label: 'AND', value: '{{ba_legal_name}}' },
            { label: 'ABN / ACN', value: '{{ba_abn_acn}}' },
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
            'Finance Referral Partnership - {{fp_display_name}} and {{ba_display_name}}',
          bodyParagraphs: [
            'Hi {{recipient_first_name}},',
            'Thank you for discussing a referral arrangement under which {{ba_display_name}} may introduce clients to {{fp_display_name}} for potential credit services.',
            'Attached is the editable Finance Referral & Commission Agreement, together with the supporting Loan Writer Undertaking, Referrer Entity & Payment Details Form and Client Referral & Consent Form.',
            'The commercial schedule contains open fields for the agreed upfront commission share, trail commission share, payment cycle, GST process, clawback treatment and treatment of refinances or subsequent loans. No percentage or payment date is pre-set.',
            'Before execution, the agreement should be reviewed and approved by the finance partner\'s legal, compliance, ACL-holder and aggregator teams, together with the buyer\'s agency\'s own advisers.',
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
            'Finance Referral & Commission Agreement',
            'Loan Writer Undertaking',
            'Referrer Entity & Payment Details Form',
            'Client Referral & Consent Form',
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
        sub: 'Core entity, licence and administration information',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'note',
          label: 'Completion standard',
          body:
            'Use the exact legal entity names, authorisation details, service addresses and commission-administration contacts that will appear in the executed agreement.',
        },
        {
          kind: 'grid',
          rows: [
            [
              { label: 'AGREEMENT DATE', fieldKey: 'effective_date' },
              { label: 'GOVERNING STATE / TERRITORY', fieldKey: 'governing_state' },
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
              { label: 'AUTHORISING LICENSEE / AGGREGATOR', fieldKey: 'fp_licensee_aggregator' },
              { label: 'REGISTERED ADDRESS', fieldKey: 'fp_address' },
            ],
            [
              { label: 'PRIMARY EMAIL', fieldKey: 'fp_email' },
              { label: 'COMMISSION ADMINISTRATION EMAIL', fieldKey: 'fp_commission_admin_email' },
            ],
            [
              { label: 'BUYER\'S AGENCY LEGAL NAME', fieldKey: 'ba_legal_name' },
              { label: 'BUYER\'S AGENCY TRADING NAME', fieldKey: 'ba_trading_name' },
            ],
            [
              { label: 'ABN / ACN', fieldKey: 'ba_abn_acn' },
              { label: 'PROPERTY LICENCE DETAILS', fieldKey: 'ba_property_licence' },
            ],
            [
              { label: 'REGISTERED ADDRESS', fieldKey: 'ba_address' },
              { label: 'PRIMARY EMAIL', fieldKey: 'ba_email' },
            ],
          ],
        },
        {
          kind: 'note',
          label: 'Parties',
          body:
            'The finance partner receives referrals and provides regulated credit services. The buyer\'s agency acts only as a referrer unless it separately holds the licences and authorisations required to provide credit assistance.',
        },
      ],
    },

    {
      id: 'boundaries',
      header: {
        badge: '2',
        heading: 'PURPOSE & PROFESSIONAL BOUNDARIES',
        hint: 'Referral-only scope',
        sub: 'Clear distinction between introduction and credit assistance',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'dualPanel',
          left: {
            title: 'BUYER\'S AGENCY / REFERRER MAY',
            bullets: [
              'Tell a client that the Finance Partner can provide credit services.',
              'With written client consent, provide the client\'s name, contact details and a brief description of the general credit purpose.',
              'Disclose the agreed referral benefit or commission-share arrangement to the client.',
              'Submit and track the referral through the agreed secure workflow.',
              'Continue to provide separate property consulting and buyer advocacy services within its own licensed scope.',
            ],
          },
          right: {
            title: 'BUYER\'S AGENCY / REFERRER MUST NOT',
            bullets: [
              'Recommend a particular loan, lender, rate, credit product or finance structure.',
              'Assess or represent the client\'s eligibility, borrowing capacity or prospects of approval.',
              'Prepare or submit a credit application or negotiate with a lender on the client\'s behalf unless separately authorised.',
              'Describe itself as acting for the Finance Partner, ACL holder, aggregator or lender.',
              'Charge the client a separate amount merely for making the referral, unless lawful and separately documented.',
            ],
          },
        },
        {
          kind: 'note',
          label: 'Referral boundary',
          body:
            'The buyer\'s agency introduces. The finance partner assesses, advises, applies, liaises and settles. Each organisation remains responsible for its own separate service relationship.',
        },
      ],
    },

    {
      id: 'operative_purpose',
      header: {
        badge: '2A',
        heading: 'PURPOSE & FINANCE PARTNER SERVICES',
        hint: 'Operative clauses',
        sub: 'Referral authority and regulated service responsibility',
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
                  text: 'This Agreement permits the Buyer\'s Agency to refer clients to the Finance Partner for potential credit services and sets out the associated commission-share arrangement.',
                },
                {
                  number: '1.2',
                  text: 'The parties intend that referrals remain incidental to the Buyer\'s Agency\'s property-services business and are conducted within the limits of applicable credit, privacy and consumer laws.',
                },
                {
                  number: '1.3',
                  text: 'This Agreement does not authorise the Buyer\'s Agency to provide credit assistance or represent the Finance Partner, any ACL holder, aggregator or lender.',
                },
              ],
            },
            {
              number: '2',
              heading: 'Finance Partner Services',
              subclauses: [
                {
                  number: '2.1',
                  text: 'The Finance Partner is solely responsible for all credit services, including fact finding, borrowing-capacity assessment, responsible lending inquiries, product comparison, loan structuring, application preparation, disclosure, submission, lender liaison and settlement.',
                },
                {
                  number: '2.2',
                  text: 'The Finance Partner must maintain all required licences, authorisations, memberships, lender accreditations and insurance.',
                },
                {
                  number: '2.3',
                  text: 'The Finance Partner may accept or decline a referral or credit application and does not guarantee approval, valuation, pricing or settlement.',
                },
              ],
            },
          ],
        },
      ],
    },

    {
      id: 'referral_requirements',
      header: {
        badge: '3',
        heading: 'REFERRAL REQUIREMENTS',
        hint: 'Buyer\'s agency to finance partner',
        sub: 'Consent, permitted information and secure handling',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'clauses',
          clauses: [
            {
              number: '3',
              heading: 'Permitted Referral Activities',
              subclauses: [
                {
                  number: '3.1',
                  text: 'Before sharing information, the Buyer\'s Agency must tell the client that the Finance Partner may be able to provide credit services and obtain the client\'s written consent to the introduction.',
                },
                {
                  number: '3.2',
                  text: 'The Buyer\'s Agency may provide only the client\'s name, contact details and a brief description of the general credit purpose unless the client separately authorises further disclosure.',
                },
                {
                  number: '3.3',
                  text: 'The Buyer\'s Agency must disclose the nature of any commission share, referral fee or other material benefit in the manner required by law and the Finance Partner\'s compliance framework.',
                },
                {
                  number: '3.4',
                  text: 'The Buyer\'s Agency must not provide inaccurate, misleading or incomplete information and must promptly correct any material error it becomes aware of.',
                },
                {
                  number: '3.5',
                  text: 'The Buyer\'s Agency is not obliged to make referrals and the client remains free to choose another finance provider.',
                },
              ],
            },
            {
              number: '4',
              heading: 'Finance Partner Referral Handling',
              subclauses: [
                {
                  number: '4.1',
                  text: 'The Finance Partner must confirm receipt, acceptance and the assigned broker or loan writer through the agreed portal or secure channel.',
                },
                {
                  number: '4.2',
                  text: 'The Finance Partner must contact the client within {{fp_contact_timeframe}} or advise the Buyer\'s Agency that the referral cannot be serviced.',
                },
                {
                  number: '4.3',
                  text: 'Subject to client consent, the Finance Partner may provide high-level status updates such as contacted, assessment underway, application submitted, conditional approval, unconditional approval, settlement booked and settled.',
                },
                {
                  number: '4.4',
                  text: 'Detailed credit reports, lender comparisons, servicing calculations, liabilities, identity documents and financial records must not be disclosed to the Buyer\'s Agency unless specifically authorised and necessary.',
                },
              ],
            },
          ],
        },
        {
          kind: 'note',
          label: 'Secure workflow expectation',
          body:
            'Use the agreed portal or secure channel for referral submission, status tracking and authorised information exchange.',
        },
      ],
    },

    {
      id: 'commission_schedule',
      header: {
        badge: '4',
        heading: 'COMMISSION & PAYMENT SCHEDULE',
        hint: 'Buyer\'s agency referral to finance partner',
        sub: 'Flexible percentage-based schedule',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'note',
          label: 'Flexible percentage-based schedule',
          body:
            'Complete the negotiated percentages and payment mechanics. The template does not prescribe an upfront percentage, trail percentage, payment date or lender panel.',
        },
        {
          kind: 'grid',
          rows: [
            [
              {
                label: 'UPFRONT COMMISSION SHARE',
                template: '{{upfront_commission_share}} of net upfront commission actually received',
              },
              {
                label: 'TRAIL COMMISSION SHARE',
                template: '{{trail_commission_share}} of net trail commission actually received',
              },
            ],
            [
              {
                label: 'COMMISSION BASIS',
                choice: {
                  fieldKey: 'commission_basis',
                  options: [
                    { value: 'gross', label: 'Gross received' },
                    { value: 'net_of_aggregator', label: 'Net of aggregator / licensee deductions' },
                    { value: 'other', label: 'Other:' },
                  ],
                  otherFieldKey: 'commission_basis_other',
                },
              },
              {
                label: 'QUALIFYING EVENT',
                template: 'Settled loan and first drawdown, unless otherwise stated: {{qualifying_event_override}}',
              },
            ],
            [
              { label: 'PAYMENT CYCLE', fieldKey: 'payment_cycle' },
              {
                label: 'CLEARED FUNDS CONDITION',
                choice: {
                  lead: 'Payment occurs only after the finance partner receives cleared funds:',
                  fieldKey: 'cleared_funds_condition',
                  options: [
                    { value: 'yes', label: 'Yes' },
                    { value: 'no', label: 'No' },
                  ],
                },
              },
            ],
            [
              {
                label: 'GST / TAX INVOICE PROCESS',
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
              { label: 'CLAWBACK TREATMENT', fieldKey: 'clawback_treatment' },
            ],
            [
              {
                label: 'CLAWBACK REPAYMENT TIMEFRAME',
                template: '{{clawback_repayment_days}} business days after written notice and evidence',
              },
              { label: 'REFINANCES / TOP-UPS / SUBSEQUENT LOANS', fieldKey: 'refinance_treatment' },
            ],
            [
              { label: 'DUPLICATE REFERRAL RULE', fieldKey: 'duplicate_referral_rule' },
              { label: 'POST-TERMINATION ENTITLEMENT', fieldKey: 'post_termination_entitlement' },
            ],
          ],
        },
        {
          kind: 'note',
          label: 'Cleared funds principle',
          body:
            'The finance partner is not required to pay a commission share until it has actually received the relevant commission in cleared funds. Any lender, aggregator or licensee clawback is dealt with only in accordance with the completed clawback field above.',
        },
      ],
    },

    {
      id: 'commission_admin',
      header: {
        badge: '5-7',
        heading: 'COMMISSION ADMINISTRATION, CLAWBACKS & TAX',
        hint: 'Statements, adjustments and GST controls',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'clauses',
          clauses: [
            {
              number: '5',
              heading: 'Commission Statements and Payment',
              subclauses: [
                {
                  number: '5.1',
                  text: 'The Finance Partner must provide a payment statement identifying the referral, relevant settled loan, commission received, calculation basis, GST treatment, adjustments and amount payable.',
                },
                {
                  number: '5.2',
                  text: 'The Buyer\'s Agency must provide any valid tax invoice or entity information reasonably required under the completed schedule.',
                },
                {
                  number: '5.3',
                  text: 'A payment dispute must be raised within {{payment_dispute_days}} business days after the statement. Undisputed amounts remain payable on time.',
                },
              ],
            },
            {
              number: '6',
              heading: 'Clawbacks and Adjustments',
              subclauses: [
                {
                  number: '6.1',
                  text: 'Where a lender, aggregator or ACL holder lawfully claws back commission relating to a referral, the parties will apply the completed clawback treatment in the Commission & Payment Schedule.',
                },
                {
                  number: '6.2',
                  text: 'The Finance Partner must provide reasonable evidence of the clawback and its calculation.',
                },
                {
                  number: '6.3',
                  text: 'The Buyer\'s Agency\'s repayment or offset obligation cannot exceed the commission-share amount actually paid to it for the affected loan, unless otherwise expressly agreed.',
                },
              ],
            },
            {
              number: '7',
              heading: 'GST and RCTIs (Reciept Created Tax Invoices)',
              subclauses: [
                {
                  number: '7.1',
                  text: 'Amounts are treated as inclusive or exclusive of GST as stated in the Commission & Payment Schedule.',
                },
                {
                  number: '7.2',
                  text: 'A party must remain registered for GST where required and notify the other if its status changes.',
                },
                {
                  number: '7.3',
                  text: 'If recipient-created tax invoices are used, the parties must satisfy the applicable requirements and the Buyer\'s Agency must not issue a duplicate tax invoice for the same supply.',
                },
              ],
            },
          ],
        },
      ],
    },

    {
      id: 'compliance_protections',
      header: {
        badge: '8-11',
        heading: 'COMPLIANCE, PRIVACY & RELATIONSHIP PROTECTIONS',
        hint: 'Authorisations, information security and risk allocation',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'clauses',
          clauses: [
            {
              number: '8',
              heading: 'Compliance and Warranties',
              subclauses: [
                {
                  number: '8.1',
                  text: 'Each party warrants that it holds the licences, approvals and authority required for its own business and will comply with applicable laws and lawful compliance directions.',
                },
                {
                  number: '8.2',
                  text: 'The Buyer\'s Agency warrants that it will not engage in credit activity beyond the scope permitted by law and its authorisations.',
                },
                {
                  number: '8.3',
                  text: 'The Buyer\'s Agency must promptly notify the Finance Partner if it becomes banned, disqualified, subject to a material complaint or investigation, or otherwise unable to make referrals lawfully.',
                },
              ],
            },
            {
              number: '9',
              heading: 'Privacy, Confidentiality and Security',
              subclauses: [
                {
                  number: '9.1',
                  text: 'Each party must collect, use, store and disclose personal information only for the referral, credit-service, payment, compliance and lawful record-keeping purposes.',
                },
                {
                  number: '9.2',
                  text: 'Each party must protect non-public client, commercial and operational information and promptly notify the other of a material privacy or cyber incident affecting referred clients.',
                },
                {
                  number: '9.3',
                  text: 'Banking and payment changes must be independently verified using a known contact method before processing.',
                },
              ],
            },
            {
              number: '10',
              heading: 'Client Relationships and Non-Circumvention',
              subclauses: [
                {
                  number: '10.1',
                  text: 'The Finance Partner retains responsibility for the credit relationship and the Buyer\'s Agency retains responsibility for the property-services relationship.',
                },
                {
                  number: '10.2',
                  text: 'Neither party may intentionally avoid an accrued commission-share entitlement or misrepresent the other party\'s services.',
                },
                {
                  number: '10.3',
                  text: 'The client retains complete freedom to choose, change or cease using either service provider.',
                },
              ],
            },
            {
              number: '11',
              heading: 'Liability and Indemnity',
              subclauses: [
                {
                  number: '11.1',
                  text: 'Each party remains responsible for its own conduct, advice, representations, employees, contractors and legal obligations.',
                },
                {
                  number: '11.2',
                  text: 'To the extent permitted by law, each party indemnifies the other against third-party loss arising directly from its material breach, negligence, unlawful conduct or unauthorised representation.',
                },
                {
                  number: '11.3',
                  text: 'The Buyer\'s Agency is not liable for a lender or Finance Partner decision, and the Finance Partner is not liable for a property recommendation or acquisition decision, except to the extent caused by its own breach or negligence.',
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
        badge: '12-13',
        heading: 'TERM, TERMINATION & GENERAL PROVISIONS',
        hint: 'Lifecycle, notices, disputes and governing law',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'clauses',
          clauses: [
            {
              number: '12',
              heading: 'Term and Termination',
              subclauses: [
                {
                  number: '12.1',
                  text: 'This Agreement starts when signed by both parties and continues until terminated.',
                },
                {
                  number: '12.2',
                  text: 'Either party may terminate without cause by giving {{termination_notice_days}} days\' written notice.',
                },
                {
                  number: '12.3',
                  text: 'A party may terminate immediately for an unremedied material breach after {{breach_remedy_days}} business days\' notice, fraud, gross negligence, insolvency, loss of authorisation or material regulatory risk.',
                },
                {
                  number: '12.4',
                  text: 'Except where termination results from fraud, deliberate misconduct or an agreed exclusion, commission-share entitlements for qualifying referrals made before termination continue as specified in the Commission & Payment Schedule.',
                },
              ],
            },
            {
              number: '13',
              heading: 'Notices, Disputes and General',
              subclauses: [
                {
                  number: '13.1',
                  text: 'Notices must be in writing and sent to the contact details in the Agreement Details.',
                },
                {
                  number: '13.2',
                  text: 'Senior representatives must attempt to resolve disputes in good faith before mediation or court proceedings, except for urgent relief.',
                },
                {
                  number: '13.3',
                  text: 'This Agreement and its completed schedules form the entire agreement and may only be varied in writing signed by both parties.',
                },
                {
                  number: '13.4',
                  text: 'Neither party may assign this Agreement without written consent, except for an approved novation or genuine business restructure that preserves the other party\'s rights.',
                },
                {
                  number: '13.5',
                  text: 'This Agreement is governed by the laws of {{governing_state}} and the parties submit to the courts of that jurisdiction.',
                },
                {
                  number: '13.6',
                  text: 'The Agreement may be signed electronically and in counterparts.',
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
        badge: '14',
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
            { role: 'partner', title: 'SIGNED FOR THE FINANCE PARTNER' },
            { role: 'principal', title: 'SIGNED FOR THE BUYER\'S AGENCY / REFERRER' },
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
      id: 'form_client_consent',
      header: {
        badge: 'A',
        heading: 'CLIENT REFERRAL & CONSENT FORM',
        hint: 'Buyer\'s agency to finance partner',
        sub: 'Client-authorised introduction record',
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
              { label: 'BUYER\'S AGENCY', text: '<<LEGAL / TRADING NAME>>' },
              { label: 'REFERRING REPRESENTATIVE', text: '<<NAME>>' },
            ],
            [
              { label: 'FINANCE PARTNER', text: '<<LEGAL / TRADING NAME>>' },
              { label: 'ASSIGNED BROKER / LOAN WRITER', text: '<<NAME AND CRN>>' },
            ],
            [
              { label: 'CLIENT NAME', text: '<<CLIENT NAME>>' },
              { label: 'CLIENT CONTACT DETAILS', text: '<<PHONE AND EMAIL>>' },
            ],
            [
              { label: 'GENERAL CREDIT PURPOSE', text: '<<PURCHASE / REFINANCE / EQUITY / OTHER>>' },
              { label: 'PREFERRED CONTACT TIME', text: '<<INSERT>>' },
            ],
            [
              { label: 'WRITTEN CONSENT OBTAINED', text: '☐ Yes   ☐ No' },
              { label: 'REFERRAL BENEFIT DISCLOSED', text: '☐ Yes   ☐ No   ☐ No benefit' },
            ],
            [
              { label: 'INFORMATION PROVIDED', text: '☐ Name   ☐ Contact details   ☐ General purpose only' },
              { label: 'CURRENT STATUS', text: '☐ Submitted  ☐ Accepted  ☐ Contacted  ☐ Application  ☐ Approved  ☐ Settled' },
            ],
          ],
        },
        {
          kind: 'consent',
          label: 'Client consent',
          body:
            'I consent to {{consent_referring_agency}} providing my name, contact details and general credit purpose to {{fp_display_name}} so that the finance partner may contact me about potential credit services. I understand that the buyer\'s agency may receive a referral payment or commission share if my loan settles, as disclosed to me. I remain free to choose another finance provider and no approval or lending outcome is guaranteed.',
          signatureLabel: 'CLIENT SIGNATURE',
          dateLabel: 'DATE',
        },
      ],
    },

    {
      id: 'form_loan_writer',
      header: {
        badge: 'B',
        heading: 'LOAN WRITER / AUTHORISED REPRESENTATIVE UNDERTAKING',
        hint: 'Supporting execution where an individual adviser services referrals',
        sub: 'Link to the main agreement and authorisation',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'grid',
          rows: [
            [
              { label: 'FINANCE PARTNER LEGAL ENTITY', fieldKey: 'fp_legal_name' },
              { label: 'ACL / AUTHORISING LICENSEE', fieldKey: 'fp_licensee_aggregator' },
            ],
            [
              { label: 'LOAN WRITER / REPRESENTATIVE ENTITY', fieldKey: 'lw_entity' },
              { label: 'CREDIT REPRESENTATIVE NUMBER', fieldKey: 'lw_crn' },
            ],
            [
              { label: 'BUYER\'S AGENCY / REFERRER', fieldKey: 'ba_display_name' },
              { label: 'MAIN AGREEMENT DATE', fieldKey: 'effective_date' },
            ],
          ],
        },
        {
          kind: 'clauses',
          clauses: [
            {
              number: 'B1',
              heading: 'Purpose',
              subclauses: [
                {
                  number: 'B1.1',
                  text: 'The Loan Writer acknowledges that the Buyer\'s Agency and the Finance Partner have entered into the Referral & Commission Agreement identified above.',
                },
                {
                  number: 'B1.2',
                  text: 'The Loan Writer may receive and service referrals only through the Finance Partner and subject to the main agreement, the Loan Writer\'s authorisation and all lawful directions of the Finance Partner, ACL holder and aggregator.',
                },
              ],
            },
          ],
        },
      ],
    },

    {
      id: 'form_loan_writer_undertakings',
      header: {
        badge: 'B2-B4',
        heading: 'LOAN WRITER UNDERTAKINGS',
        hint: 'Conduct, payment structure and termination',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'clauses',
          clauses: [
            {
              number: 'B2',
              heading: 'Undertakings',
              subclauses: [
                {
                  number: 'B2.1',
                  text: 'The Loan Writer will comply with the referral, privacy, disclosure, record-keeping and professional-boundary provisions of the main agreement.',
                },
                {
                  number: 'B2.2',
                  text: 'The Loan Writer will not represent that the Buyer\'s Agency provides credit assistance or guarantees finance approval.',
                },
                {
                  number: 'B2.3',
                  text: 'The Loan Writer will promptly notify the Finance Partner of any complaint, privacy incident, regulatory issue or authorisation change relevant to a referred client.',
                },
              ],
            },
            {
              number: 'B3',
              heading: 'No Separate Payment Obligation',
              subclauses: [
                {
                  number: 'B3.1',
                  text: 'Unless separately agreed in writing, all commission-share payments are made by the Finance Partner to the Buyer\'s Agency. This undertaking does not create a separate payment obligation for the Loan Writer.',
                },
              ],
            },
            {
              number: 'B4',
              heading: 'Termination',
              subclauses: [
                {
                  number: 'B4.1',
                  text: 'This undertaking ends when the Loan Writer ceases to be authorised by or associated with the Finance Partner, or when the main agreement terminates, whichever occurs first. Accrued obligations survive to the extent stated in the main agreement.',
                },
              ],
            },
          ],
        },
      ],
    },

    {
      id: 'form_loan_writer_execution',
      header: {
        badge: 'B5',
        heading: 'EXECUTION',
        hint: 'Electronic or wet signature',
        sub: 'Loan writer undertaking',
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
            { role: 'loan_writer', title: 'SIGNED FOR THE LOAN WRITER / AUTHORISED REPRESENTATIVE' },
            { role: 'principal', title: 'SIGNED FOR THE BUYER\'S AGENCY / REFERRER' },
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
      id: 'form_referrer_details',
      header: {
        badge: 'C',
        heading: 'REFERRER ENTITY & PAYMENT DETAILS',
        hint: 'Restricted finance administration form',
        sub: 'Banking verification and payment administration',
      },
      audience: 'always',
      blocks: [
        {
          kind: 'note',
          label: 'Security control',
          body:
            'Banking details should be collected in a restricted-access workflow and independently verified using a known telephone number before the first payment or any later change.',
        },
        {
          kind: 'grid',
          rows: [
            [
              { label: 'REGISTERED ENTITY NAME', text: '<<INSERT>>' },
              { label: 'TRADING NAME', text: '<<INSERT>>' },
            ],
            [
              { label: 'ABN / ACN', text: '<<INSERT>>' },
              { label: 'GST REGISTERED', text: '☐ Yes   ☐ No' },
            ],
            [
              { label: 'REGISTERED ADDRESS', text: '<<INSERT>>' },
              { label: 'BUSINESS PHONE', text: '<<INSERT>>' },
            ],
            [
              { label: 'ACCOUNTS EMAIL / RCTI EMAIL', text: '<<INSERT>>' },
              { label: 'AUTHORISED ACCOUNTS CONTACT', text: '<<INSERT>>' },
            ],
            [
              { label: 'ACCOUNT NAME', text: '<<MUST MATCH AGREEMENT ENTITY>>' },
              { label: 'BANK NAME', text: '<<INSERT>>' },
            ],
            [
              { label: 'BSB', text: '<<INSERT>>' },
              { label: 'ACCOUNT NUMBER', text: '<<INSERT>>' },
            ],
            [
              { label: 'INDEPENDENT VERIFICATION DATE', text: '<<DATE>>' },
              { label: 'VERIFIED BY', text: '<<NAME AND ROLE>>' },
            ],
          ],
        },
        {
          kind: 'note',
          label: 'Declaration',
          body:
            'The signatory confirms that the entity and banking information is accurate, that they are authorised to provide it, and that the finance partner may use the information solely for administering payments, reconciliations and required tax documentation under the agreement.',
        },
        {
          kind: 'grid',
          rows: [
            [
              { label: 'DIRECTOR / AUTHORISED SIGNATORY', text: '<<NAME AND SIGNATURE>>' },
              { label: 'DATE SIGNED', text: '____ / ____ / ______' },
            ],
          ],
        },
      ],
    },
  ],
};
