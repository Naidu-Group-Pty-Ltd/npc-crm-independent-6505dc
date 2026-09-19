# NPC Property Dashboard - Technical Blueprint

> **Version**: 1.0.0  
> **Last Updated**: January 2026  
> **Platform**: React + Vite + TypeScript + Supabase  

---

## Table of Contents

1. [Dashboard Overview](#1-dashboard-overview)
2. [Technology Stack](#2-technology-stack)
3. [Authentication & User Management](#3-authentication--user-management)
4. [Investment Report Generation](#4-investment-report-generation)
5. [Report Q&A (AI Chat)](#5-report-qa-ai-chat)
6. [Client Management (CRM)](#6-client-management-crm)
7. [Client Tracker (Pipeline)](#7-client-tracker-pipeline)
8. [Portfolio Analysis](#8-portfolio-analysis)
9. [Cash Flow Analysis](#9-cash-flow-analysis)
10. [Email Copilot](#10-email-copilot)
11. [Call Logs (Voice AI)](#11-call-logs-voice-ai)
12. [Automation Engine](#12-automation-engine)
13. [Property Listings](#13-property-listings)
14. [Data Services & Caching](#14-data-services--caching)
15. [Templates & Report Configuration](#15-templates--report-configuration)
16. [White Label / Branding](#16-white-label--branding)
17. [System Monitoring & Logging](#17-system-monitoring--logging)
18. [Data Import](#18-data-import)
19. [External Integrations](#19-external-integrations)
20. [Security Architecture](#20-security-architecture)
21. [Global Settings](#21-global-settings)
22. [Storage Buckets](#22-storage-buckets)
23. [Deployment & Environment](#23-deployment--environment)

---

## 1. Dashboard Overview

### Purpose

The NPC Property Dashboard is a comprehensive property investment analysis and client relationship management platform designed specifically for buyer's agents in the Australian property market. It serves as a centralized hub for:

- **Investment Analysis**: AI-powered property investment reports with financial projections, risk assessments, and market analysis
- **Client Relationship Management**: Full CRM capabilities for managing investor clients, their financial profiles, and property portfolios
- **Operational Automation**: Automated report generation, email handling, and call tracking
- **Business Intelligence**: Real-time monitoring, activity logging, and performance analytics

### Target Users

| Role | Description | Access Level |
|------|-------------|--------------|
| **Superadmin** | Platform owner with full system access | All modules, user management, integrations |
| **Admin (Sub-admin)** | Team members with configurable permissions | Module-specific access based on permission grants |

### Core Value Proposition

1. **Time Savings**: Automated generation of comprehensive 50+ page investment reports that would take hours manually
2. **Data Accuracy**: Integration with authoritative Australian data sources (ABS, Domain, RBA)
3. **Client Intelligence**: 360-degree view of client portfolios, borrowing capacity, and investment readiness
4. **Operational Efficiency**: Centralized email, calls, and calendar management with AI assistance

---

## 2. Technology Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| **React 18** | Component-based UI framework |
| **Vite** | Build tool and development server |
| **TypeScript** | Type-safe JavaScript |
| **Tailwind CSS** | Utility-first styling |
| **shadcn/ui** | Pre-built accessible component library |
| **React Router v6** | Client-side routing |
| **TanStack Query** | Server state management and caching |
| **Recharts** | Data visualization and charting |
| **pdf-lib** | Client-side PDF generation |
| **Framer Motion** | Animations (via Tailwind) |

### Backend

| Technology | Purpose |
|------------|---------|
| **Supabase** | Backend-as-a-Service (PostgreSQL, Auth, Storage) |
| **Supabase Edge Functions** | Serverless Deno functions for API integrations |
| **PostgreSQL** | Relational database with Row-Level Security |
| **Supabase Storage** | File storage for PDFs, logos, and documents |

### External Services

| Service | Purpose |
|---------|---------|
| **Perplexity AI** | Property research and data extraction |
| **OpenAI** | Conversational AI, transcription, and chart generation |
| **GoHighLevel** | CRM synchronization and pipeline management |
| **Microsoft Graph** | Outlook email integration |
| **Airtable** | Property listings data source |
| **Vapi** | Voice AI call handling |

---

## 3. Authentication & User Management

### Overview

The dashboard implements a **custom authentication system** (not Supabase Auth) using secure session-based authentication with HTTP-only cookies and session tokens. This provides full control over user management, role hierarchy, and permission granularity.

### Authentication Flow

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  Login Page  │────▶│ custom-auth-login   │────▶│  Session Created │
│  (Auth.tsx)  │     │  (Edge Function)    │     │  (Cookie + Token)│
└──────────────┘     └─────────────────────┘     └──────────────────┘
                              │
                              ▼
                     ┌─────────────────────┐
                     │  custom_users table │
                     │  user_sessions table│
                     └─────────────────────┘
```

### Session Management

- **HTTP-Only Cookies**: Secure session cookies prevent XSS attacks
- **Session Token Fallback**: For cross-origin scenarios, tokens are stored in `sessionStorage`
- **Session Expiry**: Configurable session duration with automatic cleanup
- **Concurrent Sessions**: Multiple device login support

### Role Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                        SUPERADMIN                           │
│  • Full system access                                       │
│  • User management (create/edit/delete admins)              │
│  • Integration configuration                                │
│  • Global settings                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      ADMIN (Sub-admin)                      │
│  • Module-specific access based on permissions              │
│  • View/Edit/Delete permissions per module                  │
│  • Cannot access User Management                            │
│  • Cannot modify integrations                               │
└─────────────────────────────────────────────────────────────┘
```

### Permission System

Each admin user can be granted granular permissions per module:

| Permission Type | Description |
|----------------|-------------|
| **Module Access** | Can view the module/page |
| **Can Edit** | Can create and modify records |
| **Can Delete** | Can remove records |

**Available Modules for Permission Control:**
- Overview, Listings, Calendar, Sources, Reports
- Generated Reports, Cash Flow, Report Q&A, Email Copilot
- Call Logs, Clients, Client Tracker, Portfolio Reports
- Charts, User Guide, Automation, Templates, Branding
- Integrations, Monitoring, Quality Assurance, Data Import
- Depreciation Comps, Error Logs, Activity Logs, Settings

### User Invitation Flow

1. Superadmin creates invitation with email and selected permissions
2. System generates secure invite token stored in `permission_invite_tokens`
3. Email sent to invitee with unique acceptance link
4. Invitee clicks link, sets password, and account is activated
5. Token is consumed and marked as used

### Password Reset Flow

1. User requests reset via email
2. Secure token generated and stored in `password_reset_tokens`
3. Reset link sent to user's email
4. User sets new password, token consumed
5. All existing sessions invalidated for security

### Database Tables

#### `custom_users`
Primary user account storage.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `username` | TEXT | Unique username for login |
| `email` | TEXT | User email address |
| `password_hash` | TEXT | Bcrypt-hashed password |
| `role` | TEXT | 'superadmin' or 'admin' |
| `is_active` | BOOLEAN | Account active status |
| `personal_mailbox` | TEXT | Assigned Outlook mailbox |
| `email_signature` | TEXT | Custom email signature |
| `created_at` | TIMESTAMP | Account creation time |
| `updated_at` | TIMESTAMP | Last modification time |

#### `user_sessions`
Active session tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Session ID |
| `user_id` | UUID | FK to custom_users |
| `session_token` | TEXT | Unique session token |
| `expires_at` | TIMESTAMP | Session expiration |
| `created_at` | TIMESTAMP | Session start time |
| `user_agent` | TEXT | Browser/client info |
| `ip_address` | TEXT | Client IP address |

#### `user_permissions`
Module-level permission grants.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK to custom_users |
| `module_key` | TEXT | Module identifier |
| `can_view` | BOOLEAN | View permission |
| `can_edit` | BOOLEAN | Edit permission |
| `can_delete` | BOOLEAN | Delete permission |
| `granted_by` | UUID | Superadmin who granted |
| `granted_at` | TIMESTAMP | Permission grant time |

#### `user_roles`
Role definitions (for extensibility).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Role name |
| `description` | TEXT | Role description |
| `permissions` | JSONB | Default permissions |

#### `password_reset_tokens`
Secure password reset tokens.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK to custom_users |
| `token` | TEXT | Secure reset token |
| `expires_at` | TIMESTAMP | Token expiration |
| `used_at` | TIMESTAMP | When token was used |

#### `permission_invite_tokens`
User invitation tokens.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `email` | TEXT | Invitee email |
| `token` | TEXT | Secure invite token |
| `permissions` | JSONB | Pre-configured permissions |
| `invited_by` | UUID | Inviting superadmin |
| `expires_at` | TIMESTAMP | Token expiration |
| `accepted_at` | TIMESTAMP | When accepted |

### Edge Functions

#### `custom-auth-login`
Handles user authentication.

**Request:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "username": "string",
    "role": "superadmin|admin",
    "permissions": [...]
  },
  "session_token": "string"
}
```

**Process:**
1. Validates credentials against `custom_users`
2. Verifies password hash with bcrypt
3. Creates session in `user_sessions`
4. Sets HTTP-only session cookie
5. Returns user data and session token

#### `custom-auth-logout`
Terminates user session.

**Process:**
1. Validates session token
2. Deletes session from `user_sessions`
3. Clears session cookie

#### `custom-auth-verify`
Validates active session.

**Process:**
1. Extracts session token from cookie or header
2. Validates against `user_sessions`
3. Checks expiration
4. Returns user data if valid

#### `admin-user-management`
CRUD operations for user accounts (superadmin only).

**Actions:**
- `list`: Get all users with permissions
- `create`: Create new user account
- `update`: Modify user details/permissions
- `delete`: Deactivate user account
- `invite`: Generate invitation token

#### `admin-password-reset`
Password reset token management.

**Actions:**
- `request`: Generate reset token and send email
- `validate`: Check token validity
- `reset`: Set new password and consume token

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `Auth.tsx` | `src/pages/Auth.tsx` | Login page |
| `AcceptInvite.tsx` | `src/pages/AcceptInvite.tsx` | Invitation acceptance |
| `UserManagement.tsx` | `src/pages/admin/UserManagement.tsx` | User CRUD interface |
| `useAuth.tsx` | `src/hooks/useAuth.tsx` | Authentication hook |
| `AuthContext.tsx` | `src/contexts/AuthContext.tsx` | Auth state provider |
| `ProtectedRoute.tsx` | `src/components/ProtectedRoute.tsx` | Route guard |

---

## 4. Investment Report Generation

### Overview

The Investment Report Generation system is the core feature of the dashboard, producing comprehensive AI-powered property investment analysis reports. Reports are generated using Perplexity AI for research and data gathering, with a structured 12-section architecture.

### Report Tiers

The system supports a three-tier report hierarchy:

| Tier | Name | Pages | Purpose | AI Engine |
|------|------|-------|---------|-----------|
| **Tier 1** | Investor's Compass | 50+ | Comprehensive in-depth analysis | Perplexity AI |
| **Tier 2** | Executive Briefing | ~20 | Condensed strategic summary | OpenAI GPT |
| **Tier 3** | Snapshot | 4-5 | Quick reference brief | OpenAI GPT |

Tier 2 and Tier 3 reports are derived by condensing the Tier 1 report content.

### Report Structure (12 Sections)

The Investor's Compass report follows a fixed 12-section structure:

| Section | ID | Content |
|---------|-----|---------|
| **1** | `section1` | Executive Summary, Property Overview |
| **2** | `section2` | Location Analysis, Suburb Profile |
| **3** | `section3` | Property Features, Building Specifications |
| **4** | `section4` | Market Analysis, Comparable Sales |
| **5** | `section5` | Financial Analysis, Purchase Costs |
| **6** | `section6` | Rental Assessment, Yield Analysis |
| **7** | `section7` | Cash Flow Projections (10-Year) |
| **8** | `section8` | Demographics, Population Trends |
| **9** | `section9` | Infrastructure & Amenities |
| **10** | `section10` | Risk Assessment (Flood, Bushfire, Crime) |
| **11** | `section11` | Risks & Recommendations, Final Conclusion |
| **12** | Dynamic | Template-Driven Sections (Disclaimer via Settings) |

### Property Data Input Methods

The system supports three methods for capturing property data:

#### 1. Manual Entry
Admin enters property details directly into form fields:
- Address, price, bedrooms, bathrooms, car spaces
- Land size, building size
- Weekly rent estimate
- Property type (house, unit, townhouse, land)
- New build vs existing property flag

#### 2. URL Scraping
Automatic extraction from property listing URLs:

**Process:**
1. Admin pastes property listing URL (Domain, REA, etc.)
2. `scrape-property-listing` function calls Perplexity AI
3. AI extracts structured JSON with property details
4. Data populates manual override fields
5. Report generation proceeds with extracted data

**Supported URLs:**
- domain.com.au
- realestate.com.au
- Other Australian property portals

#### 3. PDF Upload
Extraction from property brochures and house-and-land packages:

**Process:**
1. Admin uploads property PDF document
2. `parse-property-pdf` function processes document
3. Perplexity AI extracts property details
4. Data populates manual override fields

### Manual Overrides

All financial calculations can be manually overridden:

| Override Field | Description |
|---------------|-------------|
| `purchasePrice` | Property purchase price |
| `weeklyRent` | Expected weekly rental income |
| `landSize` | Land area in sqm |
| `buildSize` | Building area in sqm |
| `landPrice` | Land component price (new builds) |
| `buildPrice` | Construction price (new builds) |
| `bedrooms` | Number of bedrooms |
| `bathrooms` | Number of bathrooms |
| `carSpaces` | Parking spaces |
| `isNewBuild` | New construction flag |
| `depositPercent` | Deposit percentage |
| `interestRate` | Loan interest rate |
| `loanTerm` | Loan term in years |
| `councilRates` | Annual council rates |
| `waterRates` | Annual water rates |
| `strataFees` | Strata/body corporate fees |
| `insurance` | Annual insurance premium |
| `propertyManagement` | Management fee percentage |
| `maintenanceAnnual` | Annual maintenance budget |
| `vacancyRate` | Expected vacancy percentage |

### Generation Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Report Request │────▶│ generate-investment- │────▶│ investment_     │
│  (Frontend)     │     │ report (Edge Fn)     │     │ reports table   │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                                  │
                                  ▼
                        ┌──────────────────────┐
                        │    Perplexity AI     │
                        │  (sonar-pro model)   │
                        └──────────────────────┘
                                  │
                                  ▼
                        ┌──────────────────────┐
                        │  Section-by-Section  │
                        │    Generation        │
                        │  (12 iterations)     │
                        └──────────────────────┘
```

### Progress Tracking

The `last_completed_section` field (0-11) tracks generation progress:

| Value | Status |
|-------|--------|
| 0 | Starting / Section 1 in progress |
| 1-10 | Sections 2-11 completed |
| 11 | All sections complete |

**Resumption Logic:**
If generation fails mid-way, the system can resume from the last completed section without regenerating earlier content.

### Database Tables

#### `investment_reports`
Primary report storage.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `property_address` | TEXT | Full property address |
| `suburb` | TEXT | Property suburb |
| `state` | TEXT | Australian state |
| `postcode` | TEXT | Postal code |
| `property_type` | TEXT | house/unit/townhouse/land |
| `is_new_build` | BOOLEAN | New construction flag |
| `report_content` | TEXT | Full markdown report content |
| `financial_calculations` | JSONB | Computed financial metrics |
| `manual_overrides` | JSONB | User override values |
| `enhanced_data` | JSONB | AI-gathered market data |
| `status` | TEXT | pending/generating/completed/failed |
| `last_completed_section` | INTEGER | Progress tracker (0-11) |
| `report_tier` | TEXT | investors_compass/executive_briefing/snapshot |
| `parent_report_id` | UUID | FK to parent for condensed reports |
| `version` | INTEGER | Report version number |
| `pdf_url` | TEXT | Generated PDF storage URL |
| `created_by` | UUID | FK to custom_users |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `report_versions`
Version history for reports.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `report_id` | UUID | FK to investment_reports |
| `version_number` | INTEGER | Version sequence |
| `report_content` | TEXT | Snapshot of content |
| `financial_calculations` | JSONB | Snapshot of calculations |
| `created_at` | TIMESTAMP | Version creation time |
| `created_by` | UUID | User who created version |

#### `report_structure_templates`
Customizable report templates.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Template name |
| `description` | TEXT | Template description |
| `structure` | JSONB | Section definitions |
| `is_active` | BOOLEAN | Currently active template |
| `is_default` | BOOLEAN | Default template flag |
| `created_by` | UUID | Template creator |
| `created_at` | TIMESTAMP | Creation time |

### Edge Functions

#### `generate-investment-report`
Main report generation engine.

**Configuration:**
- Timeout: 900 seconds (15 minutes)
- Token limits per section: 2000-5000 tokens
- Model: Perplexity sonar-pro

**Process:**
1. Validate request and create report record
2. Fetch template structure from database
3. Gather property data (manual, scraped, or PDF)
4. Loop through 12 sections:
   - Build section-specific prompt
   - Call Perplexity AI
   - Append content to report
   - Update `last_completed_section`
5. Mark report as completed
6. Return report ID

#### `scrape-property-listing`
Extracts property data from listing URLs.

**Process:**
1. Receive property listing URL
2. Call Perplexity AI with extraction prompt
3. Parse structured JSON response
4. Return property details

#### `parse-property-pdf`
Extracts property data from PDF documents.

**Process:**
1. Receive PDF file or storage URL
2. Extract text content from PDF
3. Call Perplexity AI with extraction prompt
4. Return property details

#### `condense-investment-report`
Creates Tier 2/3 reports from Tier 1.

**Process:**
1. Fetch parent Tier 1 report
2. Apply condensation prompt based on target tier
3. Call OpenAI GPT-4
4. Create new report with parent reference
5. Return condensed report

#### `manage-investment-reports`
CRUD operations for reports.

**Actions:**
- `create`: Initialize new report record
- `update`: Modify report data/overrides
- `delete`: Remove report
- `regenerate`: Trigger report regeneration

#### `get-investment-reports`
Fetch reports with filtering.

**Filters:**
- Status (pending, completed, failed)
- Date range
- Property address search
- Created by user

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `Reports.tsx` | `src/pages/Reports.tsx` | Report generation interface |
| `GeneratedReports.tsx` | `src/pages/GeneratedReports.tsx` | Report listing |
| `ReportViewer.tsx` | `src/pages/ReportViewer.tsx` | Report preview |
| `InvestmentReportView.tsx` | `src/pages/InvestmentReportView.tsx` | Full report viewer |
| `InvestmentReportGenerator.tsx` | `src/components/reports/InvestmentReportGenerator.tsx` | Generation form |
| `ReportGenerationProgress.tsx` | `src/components/reports/ReportGenerationProgress.tsx` | Progress tracker |
| `PixelPerfectPDFGenerator.tsx` | `src/components/pdf/PixelPerfectPDFGenerator.tsx` | PDF export |

---

## 5. Report Q&A (AI Chat)

### Overview

The Report Q&A feature enables conversational analysis of investment reports using RAG (Retrieval-Augmented Generation). Users can upload reports and ask natural language questions to extract insights, generate summaries, and prepare client communications.

### Capabilities

- **Document Analysis**: Upload and analyze investment report PDFs
- **Natural Language Queries**: Ask questions about report content
- **TLDR Generation**: One-click executive summaries
- **Multi-Report Context**: Analyze multiple reports simultaneously
- **Conversation History**: Persist and review past conversations
- **Export Options**: Copy text or generate simple PDFs

### Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  PDF Upload     │────▶│  Text Extraction     │────▶│  Context Store  │
│  (Frontend)     │     │  (pdf-lib)           │     │  (In Memory)    │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                                                              │
┌─────────────────┐     ┌──────────────────────┐              │
│  User Question  │────▶│  report-qa           │◀─────────────┘
│  (Chat Input)   │     │  (Edge Function)     │
└─────────────────┘     └──────────────────────┘
                                  │
                                  ▼
                        ┌──────────────────────┐
                        │    OpenAI GPT-4      │
                        │  (Streaming Response)│
                        └──────────────────────┘
```

### Streaming Implementation

The chat uses Server-Sent Events (SSE) for real-time streaming:

1. Frontend sends message with report context
2. Edge function calls OpenAI with streaming enabled
3. Tokens are streamed back as they're generated
4. Frontend displays tokens incrementally
5. Final message saved to conversation history

### Authentication

Due to cross-origin cookie restrictions, the Report Q&A uses explicit session token authentication:

```typescript
const sessionToken = sessionStorage.getItem('session_token');
fetch('/functions/v1/report-qa', {
  headers: {
    'x-session-token': sessionToken,
  },
  body: JSON.stringify({
    session_token: sessionToken,  // Fallback in body
    ...
  })
});
```

### Database Tables

#### `report_qa_conversations`
Conversation threads.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK to custom_users |
| `title` | TEXT | Conversation title |
| `report_ids` | TEXT[] | Associated report IDs |
| `created_at` | TIMESTAMP | Creation time |
| `updated_at` | TIMESTAMP | Last activity |

#### `report_qa_messages`
Individual messages within conversations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `conversation_id` | UUID | FK to conversations |
| `role` | TEXT | 'user' or 'assistant' |
| `content` | TEXT | Message content |
| `created_at` | TIMESTAMP | Message time |

### Edge Functions

#### `report-qa`
Main conversational AI handler.

**Actions:**
- `chat`: Process user message and generate response
- `summarize`: Generate TLDR summary
- `history`: Fetch conversation history

**Request:**
```json
{
  "action": "chat",
  "reportContents": ["...report text..."],
  "userMessage": "What are the main risks?",
  "chatHistory": [...],
  "conversationId": "uuid",
  "stream": true
}
```

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `ReportQA.tsx` | `src/pages/ReportQA.tsx` | Main Q&A interface |
| `ConversationHistory.tsx` | `src/components/report-qa/ConversationHistory.tsx` | History sidebar |

---

## 6. Client Management (CRM)

### Overview

The Client Management module provides comprehensive CRM capabilities for managing investor clients. It captures detailed financial profiles, employment information, property portfolios, and borrowing capacity assessments.

### Client Profile Structure

Each client record contains:

#### Personal Information
- Primary contact: Name, DOB, gender, email, phone
- Secondary contact (partner): Same fields
- Residential status: Owner/renter
- Living situation: Type of dwelling
- Marital status
- Number of dependents
- Current address

#### Financial Profile
- Gross annual income (detailed breakdown)
- Monthly expenses (categorized)
- Assets (properties, vehicles, savings)
- Liabilities (loans, credit cards, HECS)
- Borrowing capacity (calculated)

#### Employment Details
- Employer name
- Occupation/role
- Employment type (full-time, part-time, casual, self-employed)
- Start date
- Current employment flag

### Income Breakdown

The system captures detailed income sources:

| Category | Description |
|----------|-------------|
| `gross_salary` | Base annual salary |
| `overtime_essential` | Regular overtime |
| `overtime_non_essential` | Occasional overtime |
| `bonus` | Annual bonus |
| `commission` | Sales commission |
| `allowance` | Work allowances |
| `other_taxable_income` | Other income sources |

### Expense Categories

| Category | Description |
|----------|-------------|
| `housing` | Rent/mortgage (if not in liabilities) |
| `utilities` | Power, gas, water, internet |
| `transport` | Vehicle, fuel, public transport |
| `insurance` | Health, life, car insurance |
| `groceries` | Food and household items |
| `childcare` | Childcare and education |
| `entertainment` | Leisure and subscriptions |
| `other` | Miscellaneous expenses |

### Property Portfolio

Each client can have multiple properties:

| Field | Description |
|-------|-------------|
| `address` | Property address |
| `property_type` | Investment/owner-occupied/PPOR |
| `value` | Estimated current value |
| `loan_remaining` | Outstanding mortgage |
| `interest_rate` | Current loan rate |
| `weekly_rental_income` | Rental income (if investment) |
| `monthly_expenses` | Itemized property costs |
| `net_monthly_cashflow` | Calculated cash flow |
| `ownership_percentage` | Share of ownership |

**SMSF Properties** (additional fields):
- Fund name, ABN
- Trustee name and type
- Compliance status
- Auditor name

### Borrowing Capacity Assessment

The system calculates borrowing capacity using lender-standard formulas:

**Inputs:**
- Gross income (shaded per lender rules)
- Living expenses (HEM benchmark comparison)
- Existing commitments
- Proposed loan terms

**Outputs:**
- Maximum borrowing capacity
- Monthly surplus
- Debt-to-income ratio
- Serviceability band (excellent/good/marginal/restricted)
- Stress-tested capacity (+3% buffer)

### Database Tables

#### `clients`
Main client records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `primary_first_name` | TEXT | Primary contact first name |
| `primary_surname` | TEXT | Primary contact surname |
| `primary_email` | TEXT | Primary email |
| `primary_mobile` | TEXT | Primary phone |
| `primary_dob` | DATE | Primary date of birth |
| `secondary_first_name` | TEXT | Secondary contact first name |
| `secondary_surname` | TEXT | Secondary contact surname |
| `secondary_email` | TEXT | Secondary email |
| `current_address` | TEXT | Residential address |
| `marital_status` | TEXT | Marital status |
| `dependents_count` | INTEGER | Number of dependents |
| `living_situation` | TEXT | Housing type |
| `residential_status` | TEXT | Owner/renter |
| `total_portfolio_value` | NUMERIC | Sum of property values |
| `total_debt` | NUMERIC | Sum of liabilities |
| `borrowing_capacity` | NUMERIC | Calculated capacity |
| `equity_release` | NUMERIC | Available equity |
| `is_favorite` | BOOLEAN | Starred client |
| `is_active` | BOOLEAN | Active status |
| `ghl_contact_id` | TEXT | GoHighLevel contact ID |
| `ghl_sync_status` | TEXT | Sync status |
| `created_by` | UUID | Creating user |
| `created_at` | TIMESTAMP | Creation time |

#### `client_income`
Income records per client.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `contact_type` | TEXT | 'primary' or 'secondary' |
| `gross_salary` | NUMERIC | Base salary |
| `overtime_essential` | NUMERIC | Regular overtime |
| `overtime_non_essential` | NUMERIC | Occasional overtime |
| `bonus` | NUMERIC | Annual bonus |
| `commission` | NUMERIC | Commission income |
| `allowance` | NUMERIC | Allowances |
| `other_taxable_income` | NUMERIC | Other income |
| `salary_frequency` | TEXT | weekly/fortnightly/monthly/annual |

#### `client_expenses`
Expense records per client.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `expense_category` | TEXT | Category code |
| `expense_name` | TEXT | Description |
| `monthly_amount` | NUMERIC | Monthly cost |
| `frequency` | TEXT | Payment frequency |
| `is_essential` | BOOLEAN | Essential expense flag |

#### `client_assets`
Non-property assets.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `asset_type` | TEXT | savings/vehicle/shares/super/other |
| `description` | TEXT | Asset description |
| `value` | NUMERIC | Current value |
| `institution_name` | TEXT | Bank/provider |
| `vehicle_type` | TEXT | For vehicles |
| `make_model` | TEXT | For vehicles |

#### `client_liabilities`
Debt records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `liability_type` | TEXT | mortgage/personal_loan/car_loan/credit_card/hecs/other |
| `provider_name` | TEXT | Lender name |
| `current_balance` | NUMERIC | Outstanding balance |
| `credit_limit` | NUMERIC | For credit cards |
| `monthly_repayment` | NUMERIC | Monthly payment |
| `interest_rate` | NUMERIC | Current rate |
| `repayment_type` | TEXT | P&I or IO |

#### `client_employment`
Employment history.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `contact_type` | TEXT | 'primary' or 'secondary' |
| `employer_name` | TEXT | Employer |
| `occupation_role` | TEXT | Job title |
| `employment_type` | TEXT | full_time/part_time/casual/self_employed |
| `start_date` | DATE | Employment start |
| `is_current` | BOOLEAN | Current job flag |

#### `client_properties`
Property portfolio entries.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `address` | TEXT | Property address |
| `property_type` | TEXT | investment/owner_occupied/ppor |
| `value` | NUMERIC | Estimated value |
| `loan_remaining` | NUMERIC | Outstanding loan |
| `interest_rate` | NUMERIC | Loan rate |
| `weekly_rental_income` | NUMERIC | Weekly rent |
| `monthly_rental_income` | NUMERIC | Monthly rent |
| `monthly_council_rates` | NUMERIC | Council rates |
| `monthly_water_rates` | NUMERIC | Water rates |
| `monthly_building_insurance` | NUMERIC | Insurance |
| `monthly_landlord_insurance` | NUMERIC | Landlord insurance |
| `monthly_body_corporate` | NUMERIC | Strata fees |
| `monthly_property_management` | NUMERIC | PM fees |
| `monthly_repairs_maintenance` | NUMERIC | Maintenance |
| `total_monthly_expenditure` | NUMERIC | Total expenses |
| `net_monthly_cashflow` | NUMERIC | Net cash flow |
| `ownership_percentage` | NUMERIC | Share owned |
| `smsf_fund_name` | TEXT | SMSF name |
| `smsf_abn` | TEXT | SMSF ABN |
| `smsf_trustee_name` | TEXT | Trustee |
| `smsf_trustee_type` | TEXT | Individual/corporate |
| `smsf_compliance_status` | TEXT | Compliance status |
| `smsf_auditor_name` | TEXT | Auditor |

#### `client_notes`
Notes and observations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `content` | TEXT | Note content |
| `note_type` | TEXT | general/financial/meeting/call |
| `ghl_note_id` | TEXT | GHL sync ID |
| `created_by` | UUID | Note author |
| `created_at` | TIMESTAMP | Creation time |

#### `client_files`
Document attachments.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `file_name` | TEXT | Original filename |
| `file_path` | TEXT | Storage path |
| `file_type` | TEXT | MIME type |
| `file_size` | INTEGER | Size in bytes |
| `category` | TEXT | Document category |
| `document_type` | TEXT | Specific type |
| `report_type` | TEXT | For investment reports |
| `description` | TEXT | File description |
| `is_vownet_form` | BOOLEAN | VOWnet form flag |
| `uploaded_by` | UUID | Uploader |
| `uploaded_at` | TIMESTAMP | Upload time |

#### `client_reminders`
Task reminders.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `title` | TEXT | Reminder title |
| `description` | TEXT | Details |
| `due_date` | TIMESTAMP | Due date |
| `reminder_type` | TEXT | call/email/meeting/task |
| `priority` | TEXT | low/medium/high |
| `status` | TEXT | pending/completed |
| `completed_at` | TIMESTAMP | Completion time |
| `created_by` | UUID | Creator |

#### `client_activities`
Activity timeline.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `activity_type` | TEXT | Activity type code |
| `title` | TEXT | Activity title |
| `description` | TEXT | Activity description |
| `metadata` | JSONB | Additional data |
| `created_by` | UUID | Actor |
| `created_at` | TIMESTAMP | Activity time |

#### `client_tags`
Tag definitions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Tag name |
| `color` | TEXT | Display color |
| `description` | TEXT | Tag description |
| `created_by` | UUID | Creator |

#### `client_tag_assignments`
Client-tag relationships.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `tag_id` | UUID | FK to client_tags |
| `assigned_by` | UUID | Assigner |
| `assigned_at` | TIMESTAMP | Assignment time |

#### `client_scores`
Investment readiness scores.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients (unique) |
| `overall_score` | INTEGER | 0-100 score |
| `cash_flow_score` | INTEGER | Cash flow health |
| `portfolio_health` | INTEGER | Portfolio score |
| `growth_potential` | INTEGER | Growth capacity |
| `risk_level` | TEXT | low/medium/high |
| `risk_factors` | JSONB | Identified risks |
| `calculation_notes` | TEXT | Scoring notes |
| `last_calculated_at` | TIMESTAMP | Calculation time |

#### `borrowing_capacity_assessments`
Borrowing capacity calculations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `gross_annual_income` | NUMERIC | Total income |
| `shaded_annual_income` | NUMERIC | Lender-shaded income |
| `living_expenses_monthly` | NUMERIC | Living expenses |
| `existing_commitments_monthly` | NUMERIC | Current debt payments |
| `borrowing_capacity` | NUMERIC | Maximum borrowing |
| `monthly_surplus` | NUMERIC | Income surplus |
| `serviceability_band` | TEXT | excellent/good/marginal/restricted |
| `dti_ratio` | NUMERIC | Debt-to-income |
| `assessment_rate` | NUMERIC | Rate used |
| `buffer_rate` | NUMERIC | Buffer applied |
| `stress_tested_capacity` | NUMERIC | +3% stress test |
| `loan_term_years` | INTEGER | Assumed term |
| `expense_method` | TEXT | HEM/declared |
| `income_breakdown` | JSONB | Income details |
| `expense_breakdown` | JSONB | Expense details |
| `liability_breakdown` | JSONB | Liability details |
| `assumptions` | JSONB | Calculation assumptions |
| `recommendations` | JSONB | Improvement suggestions |
| `warnings` | TEXT[] | Risk warnings |
| `calculated_by` | UUID | Calculator |
| `created_at` | TIMESTAMP | Calculation time |

### Edge Functions

#### `manage-client-data`
CRUD operations for client records.

**Actions:**
- `create`: Create new client
- `update`: Modify client data
- `delete`: Deactivate client
- `add_property`: Add property to portfolio
- `update_property`: Modify property
- `add_income`: Add income record
- `add_expense`: Add expense record
- `add_liability`: Add liability
- `add_asset`: Add asset
- `add_note`: Add client note
- `add_reminder`: Create reminder

#### `get-client-data`
Fetch client data with relationships.

**Returns:**
- Client record
- Income records
- Expenses
- Assets
- Liabilities
- Properties
- Notes
- Reminders
- Files
- Tags
- Scores
- Borrowing assessments

#### `calculate-borrowing-capacity`
Performs borrowing capacity calculation.

**Process:**
1. Gather all income sources
2. Apply lender shading rules
3. Calculate HEM benchmark
4. Compare declared vs HEM expenses
5. Calculate monthly surplus
6. Apply assessment rate + buffer
7. Compute maximum loan amount
8. Calculate DTI ratio
9. Determine serviceability band
10. Generate recommendations

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `ClientManagement.tsx` | `src/pages/ClientManagement.tsx` | Client list and CRUD |
| `ClientDetailModal.tsx` | `src/components/clients/ClientDetailModal.tsx` | Full client view |
| `ClientFinancialProfile.tsx` | `src/components/clients/ClientFinancialProfile.tsx` | Financial details |
| `ClientPropertyPortfolio.tsx` | `src/components/clients/ClientPropertyPortfolio.tsx` | Property list |
| `BorrowingCapacityCalculator.tsx` | `src/components/clients/BorrowingCapacityCalculator.tsx` | Capacity tool |

---

---

## 7. Client Tracker (Pipeline)

### Overview

The Client Tracker provides a Kanban-style pipeline view for managing client progression through the sales/onboarding process. It integrates with GoHighLevel (GHL) for bidirectional pipeline synchronization.

### Pipeline Stages

Default pipeline stages (customizable via GHL):

| Stage | Description |
|-------|-------------|
| New Lead | Initial inquiry |
| Qualification | Assessing fit |
| Strategy Session | Discovery meeting |
| Proposal | Presenting options |
| Negotiation | Deal discussion |
| Won | Converted client |
| Lost | Declined/inactive |

### GHL Integration

The tracker syncs with GHL pipelines:

**Sync Direction:**
- **GHL → Dashboard**: Pipeline stages, contact updates, opportunity changes
- **Dashboard → GHL**: Stage changes, note additions, contact updates

**Sync Triggers:**
- Manual sync button
- Automatic on client update
- Webhook from GHL (if configured)

### Database Tables

#### `ghl_pipelines`
Pipeline definitions from GHL.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `ghl_pipeline_id` | TEXT | GHL pipeline ID |
| `name` | TEXT | Pipeline name |
| `stages` | JSONB | Stage definitions |
| `is_active` | BOOLEAN | Active status |
| `last_synced_at` | TIMESTAMP | Last sync time |

#### `ghl_pipeline_stages`
Individual stage definitions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `pipeline_id` | UUID | FK to ghl_pipelines |
| `ghl_stage_id` | TEXT | GHL stage ID |
| `name` | TEXT | Stage name |
| `position` | INTEGER | Display order |

### Edge Functions

#### `sync-ghl-pipelines`
Fetches pipeline definitions from GHL.

#### `update-ghl-opportunity-stage`
Updates opportunity stage in GHL when changed locally.

#### `sync-client-to-ghl`
Pushes client updates to GHL contact.

#### `sync-notes-to-ghl`
Syncs client notes to GHL.

#### `import-clients-from-ghl`
Bulk imports contacts from GHL.

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `ClientTracker.tsx` | `src/pages/ClientTracker.tsx` | Pipeline Kanban view |
| `PipelineColumn.tsx` | `src/components/clients/PipelineColumn.tsx` | Stage column |
| `ClientCard.tsx` | `src/components/clients/ClientCard.tsx` | Draggable client card |

---

## 8. Portfolio Analysis

### Overview

Portfolio Analysis generates comprehensive reports analyzing a client's entire property portfolio. It aggregates data across multiple properties to provide portfolio-level insights.

### Report Contents

- **Portfolio Summary**: Total value, debt, equity, LVR
- **Cash Flow Analysis**: Aggregate income, expenses, net position
- **Property Breakdown**: Individual property performance
- **Diversification Analysis**: Geographic and type distribution
- **Risk Assessment**: Concentration risks, LVR exposure
- **Growth Projections**: Portfolio appreciation scenarios

### Configuration Options

| Option | Description |
|--------|-------------|
| `includeOwnerOccupied` | Include PPOR in calculations |
| `includeBorrowingCapacity` | Show borrowing section |
| `projectionYears` | Projection timeframe |

### Database Tables

#### `portfolio_analysis_reports`
Generated portfolio reports.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `report_data` | JSONB | Full report content |
| `summary_metrics` | JSONB | Key metrics |
| `pdf_url` | TEXT | Generated PDF URL |
| `created_by` | UUID | Report creator |
| `created_at` | TIMESTAMP | Creation time |

#### `portfolio_reviews`
Periodic review records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `review_date` | DATE | Review date |
| `review_type` | TEXT | annual/quarterly/ad-hoc |
| `findings` | JSONB | Review findings |
| `recommendations` | TEXT[] | Action items |
| `next_review_date` | DATE | Next scheduled review |
| `reviewed_by` | UUID | Reviewer |

### Edge Functions

#### `generate-portfolio-analysis`
Creates portfolio analysis report.

**Process:**
1. Fetch all client properties
2. Calculate aggregate metrics
3. Generate performance analysis
4. Create projections
5. Identify risks
6. Generate PDF
7. Store report

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `PortfolioReports.tsx` | `src/pages/PortfolioReports.tsx` | Report listing |
| `PortfolioAnalysisPDFGenerator.tsx` | `src/components/pdf/PortfolioAnalysisPDFGenerator.tsx` | PDF generation |
| `ClientPortfolioReview.tsx` | `src/components/clients/ClientPortfolioReview.tsx` | Review wizard |

---

## 9. Cash Flow Analysis

### Overview

The Cash Flow Analysis module enables detailed comparison between investment reports, providing side-by-side analysis of different properties or scenarios.

### Comparison Features

- **Property Comparison**: Compare 2-4 properties
- **Scenario Modeling**: Best/worst/likely cases
- **10-Year Projections**: Long-term cash flow modeling
- **ROI Metrics**: Yield, capital growth, total return
- **Break-even Analysis**: When investment turns positive

### Database Tables

#### `cash_flow_analyses`
Saved analysis sessions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `primary_report_id` | UUID | FK to investment_reports |
| `comparison_report_ids` | UUID[] | Reports being compared |
| `analysis_data` | JSONB | Analysis results |
| `investor_profile` | TEXT | Investor type |
| `created_by` | UUID | Creator |
| `created_at` | TIMESTAMP | Creation time |

#### `property_comparisons`
Property comparison records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Comparison name |
| `report_ids` | UUID[] | Reports compared |
| `comparison_metrics` | JSONB | Calculated metrics |
| `winner_report_id` | UUID | Best performing property |
| `analysis_notes` | TEXT | User notes |
| `created_by` | UUID | Creator |

### Edge Functions

#### `compare-cash-flow-reports`
Generates cash flow comparison.

#### `compare-investment-reports`
Full property comparison analysis.

#### `format-comparison-report`
Formats comparison for display/export.

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `CashFlowAnalysis.tsx` | `src/pages/CashFlowAnalysis.tsx` | Analysis interface |
| `ComparisonChart.tsx` | `src/components/analysis/ComparisonChart.tsx` | Visual comparison |
| `CashFlowTable.tsx` | `src/components/analysis/CashFlowTable.tsx` | Projection table |

---

## 10. Email Copilot

### Overview

Email Copilot provides AI-assisted email management with Outlook integration. It syncs emails from configured mailboxes and provides AI-powered draft responses.

### Capabilities

- **Inbox Sync**: Automatic email synchronization
- **Sent Folder Sync**: Track outgoing messages
- **AI Draft Replies**: Generate contextual responses
- **Client Linking**: Associate emails with client records
- **Multi-Mailbox**: Support for multiple team mailboxes
- **Thread View**: Conversation threading

### Email Sync Process

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│ Microsoft Graph │◀───▶│ outlook-email-sync   │────▶│ email_copilot_  │
│      API        │     │  (Edge Function)     │     │ emails table    │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
```

### Database Tables

#### `email_copilot_emails`
Synced email records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `outlook_id` | TEXT | Microsoft message ID |
| `internet_message_id` | TEXT | RFC message ID |
| `mailbox_email` | TEXT | Source mailbox |
| `subject` | TEXT | Email subject |
| `body_preview` | TEXT | Preview text |
| `body_content` | TEXT | Full body |
| `from_address` | TEXT | Sender email |
| `from_name` | TEXT | Sender name |
| `to_recipients` | JSONB | To addresses |
| `cc_recipients` | JSONB | CC addresses |
| `folder_type` | TEXT | inbox/sent |
| `is_read` | BOOLEAN | Read status |
| `has_attachments` | BOOLEAN | Has attachments |
| `received_at` | TIMESTAMP | Received time |
| `sent_at` | TIMESTAMP | Sent time |
| `linked_client_id` | UUID | FK to clients |
| `ai_draft_reply` | TEXT | AI-generated draft |
| `synced_at` | TIMESTAMP | Sync time |

#### `email_copilot_sent_replies`
Sent reply tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `original_email_id` | UUID | FK to emails |
| `reply_content` | TEXT | Sent content |
| `sent_by` | UUID | Sender user |
| `sent_at` | TIMESTAMP | Send time |
| `outlook_message_id` | TEXT | MS message ID |

### Edge Functions

#### `outlook-email-sync`
Synchronizes emails from Outlook.

**Process:**
1. Authenticate with Microsoft Graph
2. Fetch recent inbox messages
3. Fetch recent sent messages
4. Upsert to database
5. Match to client records

#### `send-email-reply`
Sends email via Microsoft Graph.

**Process:**
1. Compose reply message
2. Send via Graph API
3. Record in sent_replies
4. Update original email

#### `email-copilot`
AI draft generation.

**Process:**
1. Analyze email content
2. Retrieve client context
3. Generate contextual reply
4. Return draft

#### `outlook-manage-subscription`
Manages webhook subscriptions for real-time sync.

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `EmailCopilot.tsx` | `src/pages/EmailCopilot.tsx` | Main email interface |
| `EmailList.tsx` | `src/components/email/EmailList.tsx` | Email listing |
| `EmailViewer.tsx` | `src/components/email/EmailViewer.tsx` | Email reader |
| `EmailComposer.tsx` | `src/components/email/EmailComposer.tsx` | Reply composer |

---

## 11. Call Logs (Voice AI)

### Overview

The Call Logs module integrates with Vapi for Voice AI call handling. It captures call recordings, transcriptions, and provides AI-powered analysis including sentiment detection and key topic extraction.

### Call Data Captured

| Field | Description |
|-------|-------------|
| Call ID | Unique identifier |
| Phone Number | Caller number |
| Agent Name | AI agent that handled call |
| Duration | Call length |
| Recording URL | Audio file |
| Transcript | Full text transcription |
| Summary | AI-generated summary |
| Sentiment | Positive/neutral/negative |
| Topics | Extracted key topics |
| Cost | Vapi usage cost |
| Ended Reason | How call ended |

### Alert System

Admins can configure alert rules based on call criteria:

| Condition Type | Example |
|---------------|---------|
| Duration | Call > 5 minutes |
| Sentiment | Negative sentiment detected |
| Keyword | Contains "complaint" |
| Agent | Specific agent calls |
| Time | After-hours calls |

**Alert Actions:**
- In-app notification
- Email notification
- Weekly report inclusion

### Database Tables

#### `vapi_call_logs`
Call records from Vapi.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `vapi_call_id` | TEXT | Vapi call ID |
| `phone_number` | TEXT | Caller number |
| `agent_id` | TEXT | Vapi agent ID |
| `agent_name` | TEXT | Agent display name |
| `status` | TEXT | Call status |
| `ended_reason` | TEXT | End reason |
| `duration_seconds` | INTEGER | Call duration |
| `recording_url` | TEXT | Audio URL |
| `transcript` | TEXT | Full transcript |
| `summary` | TEXT | AI summary |
| `sentiment` | TEXT | Sentiment analysis |
| `key_topics` | TEXT[] | Extracted topics |
| `cost` | NUMERIC | Call cost |
| `started_at` | TIMESTAMP | Call start |
| `ended_at` | TIMESTAMP | Call end |
| `linked_client_id` | UUID | FK to clients |
| `tags` | UUID[] | Assigned tags |
| `notes` | TEXT | Manual notes |
| `created_at` | TIMESTAMP | Record creation |

#### `call_alert_rules`
Alert rule definitions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Rule name |
| `condition_type` | TEXT | What to check |
| `condition_operator` | TEXT | equals/contains/gt/lt |
| `condition_value` | TEXT | Threshold value |
| `is_positive` | BOOLEAN | Positive or negative alert |
| `notification_type` | TEXT | in_app/email/both |
| `is_enabled` | BOOLEAN | Rule active |
| `created_at` | TIMESTAMP | Creation time |

#### `call_alert_history`
Triggered alerts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `rule_id` | UUID | FK to alert_rules |
| `call_id` | UUID | FK to call_logs |
| `rule_name` | TEXT | Rule that triggered |
| `message` | TEXT | Alert message |
| `is_positive` | BOOLEAN | Alert type |
| `is_read` | BOOLEAN | Read status |
| `triggered_at` | TIMESTAMP | Trigger time |

#### `call_tags`
Tag definitions for calls.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Tag name |
| `color` | TEXT | Display color |
| `description` | TEXT | Tag description |

### Edge Functions

#### `vapi-call-webhook`
Receives call data from Vapi.

**Webhook Events:**
- `call.started`: Call initiated
- `call.ended`: Call completed
- `transcript.ready`: Transcript available

**Process:**
1. Validate webhook signature
2. Parse call data
3. Fetch agent name from Vapi API
4. Generate AI summary
5. Perform sentiment analysis
6. Store in database
7. Check alert rules
8. Trigger notifications

#### `manage-call-logs`
CRUD operations for call records.

#### `get-call-logs`
Fetch calls with filtering.

#### `manage-call-settings`
Configure call-related settings.

#### `clean-note-transcript`
Clean up transcript formatting.

#### `cleanup-stale-calls`
Remove old/incomplete records.

#### `voice-to-text`
Transcribe audio files using OpenAI Whisper.

#### `send-call-alert-email`
Send email notifications for alerts.

#### `send-weekly-call-report`
Generate and send weekly summary.

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `CallLogs.tsx` | `src/pages/CallLogs.tsx` | Call listing |
| `CallDetailModal.tsx` | `src/components/calls/CallDetailModal.tsx` | Call details |
| `TranscriptViewer.tsx` | `src/components/calls/TranscriptViewer.tsx` | Transcript display |
| `AlertRulesManager.tsx` | `src/components/calls/AlertRulesManager.tsx` | Alert configuration |
| `CallAnalytics.tsx` | `src/components/calls/CallAnalytics.tsx` | Call statistics |

---

## 12. Automation Engine

### Overview

The Automation Engine enables automatic generation of investment reports based on configurable triggers. When new property listings match defined criteria, reports are automatically generated.

### Trigger Criteria

| Criterion | Description |
|-----------|-------------|
| Price Range | Min/max purchase price |
| Location | Suburbs, postcodes, states |
| Property Type | House, unit, townhouse, land |
| Bedrooms | Minimum bedrooms |
| New Build | New construction only |

### Switch Architecture

Each automation is defined as a "switch" that can be independently enabled/disabled:

```
┌─────────────────────────────────────────────────────────────┐
│                    MASTER SWITCH                            │
│          (Enables/disables all automation)                  │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    Switch 1     │ │    Switch 2     │ │    Switch 3     │
│  Sydney Houses  │ │ Melbourne Units │ │  Brisbane Land  │
│  $800k-$1.2M    │ │   $500k-$700k   │ │   $400k-$600k   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Processing Flow

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  New Listing    │────▶│ auto-report-sync     │────▶│  Match against  │
│  (Airtable)     │     │  (Edge Function)     │     │  active switches│
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                                                              │
                                                              ▼
                                                    ┌─────────────────┐
                                                    │ If match found: │
                                                    │ Generate report │
                                                    └─────────────────┘
```

### Database Tables

#### `auto_report_master_settings`
Global automation settings.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (singleton) |
| `is_enabled` | BOOLEAN | Master switch |
| `updated_at` | TIMESTAMP | Last update |
| `updated_by` | UUID | Who toggled |

#### `auto_report_switches`
Individual automation rules.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Switch name |
| `description` | TEXT | Switch description |
| `criteria` | JSONB | Matching criteria |
| `is_enabled` | BOOLEAN | Switch active |
| `priority` | INTEGER | Processing priority |
| `created_by` | UUID | Creator |
| `created_at` | TIMESTAMP | Creation time |
| `updated_at` | TIMESTAMP | Last update |

**Criteria Schema:**
```json
{
  "priceMin": 500000,
  "priceMax": 800000,
  "suburbs": ["Sydney", "Parramatta"],
  "states": ["NSW"],
  "propertyTypes": ["house", "townhouse"],
  "minBedrooms": 3,
  "newBuildOnly": false
}
```

#### `auto_report_processed_listings`
Tracking of processed listings.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `listing_id` | TEXT | Airtable record ID |
| `listing_address` | TEXT | Property address |
| `switch_id` | UUID | FK to switches |
| `report_id` | UUID | FK to investment_reports |
| `processed_at` | TIMESTAMP | Processing time |
| `skipped` | BOOLEAN | Was skipped |
| `skip_reason` | TEXT | Why skipped |

#### `auto_report_generation_log`
Detailed generation logs.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `listing_id` | TEXT | Airtable record ID |
| `listing_address` | TEXT | Property address |
| `switch_id` | UUID | FK to switches |
| `switch_name` | TEXT | Switch name |
| `status` | TEXT | pending/success/failed |
| `report_id` | UUID | Generated report ID |
| `error_message` | TEXT | Error if failed |
| `created_at` | TIMESTAMP | Log time |
| `completed_at` | TIMESTAMP | Completion time |

### Edge Functions

#### `auto-report-sync`
Checks for new listings and triggers generation.

**Process:**
1. Fetch new/updated listings from Airtable
2. Check against processed_listings
3. For unprocessed listings:
   - Match against active switches
   - If match found, queue for generation
4. Call generate-investment-report
5. Log result

#### `auto-report-webhook`
Webhook endpoint for real-time triggers.

#### `manage-automation-settings`
CRUD for switches and settings.

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `Automation.tsx` | `src/pages/Automation.tsx` | Automation management |
| `AutomationSwitch.tsx` | `src/components/automation/AutomationSwitch.tsx` | Switch configuration |
| `AutomationLogs.tsx` | `src/components/automation/AutomationLogs.tsx` | Generation logs |

---

## 13. Property Listings

### Overview

The Property Listings module displays properties sourced from Airtable, providing a centralized view of available listings and enabling bulk report generation.

### Features

- **Listing Grid**: Visual property cards
- **Filtering**: By price, location, type
- **Sorting**: By date, price, suburb
- **Bulk Selection**: Select multiple for report generation
- **Quick Actions**: Generate report, view details

### Airtable Integration

Properties are sourced from an Airtable base with the following expected fields:

| Airtable Field | Dashboard Field |
|----------------|-----------------|
| Address | property_address |
| Price | purchase_price |
| Bedrooms | bedrooms |
| Bathrooms | bathrooms |
| Car Spaces | car_spaces |
| Land Size | land_size |
| Building Size | building_size |
| Property Type | property_type |
| Suburb | suburb |
| State | state |
| Postcode | postcode |
| URL | listing_url |
| Images | image_urls |

### Bulk Report Generation

Users can select multiple listings and generate reports in batch:

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│ Selected        │────▶│ generate-bulk-       │────▶│ bulk_generation │
│ Listings        │     │ reports              │     │ _jobs table     │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                                  │
                                  ▼ (for each)
                        ┌──────────────────────┐
                        │ generate-investment- │
                        │ report               │
                        └──────────────────────┘
```

### Database Tables

#### `bulk_generation_jobs`
Bulk generation job tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `property_ids` | TEXT[] | Selected Airtable IDs |
| `property_addresses` | TEXT[] | Property addresses |
| `total_reports` | INTEGER | Total to generate |
| `completed_reports` | INTEGER | Completed count |
| `failed_reports` | INTEGER | Failed count |
| `status` | TEXT | pending/processing/completed/failed |
| `error_message` | TEXT | Job-level error |
| `created_by` | UUID | Initiator |
| `started_at` | TIMESTAMP | Processing start |
| `completed_at` | TIMESTAMP | Processing end |

#### `bulk_generation_items`
Individual items within a job.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `job_id` | UUID | FK to jobs |
| `property_listing_id` | TEXT | Airtable ID |
| `property_address` | TEXT | Address |
| `status` | TEXT | pending/processing/completed/failed |
| `report_id` | UUID | Generated report ID |
| `error_message` | TEXT | Item-level error |
| `processing_time_seconds` | INTEGER | Generation time |
| `started_at` | TIMESTAMP | Start time |
| `completed_at` | TIMESTAMP | End time |

### Edge Functions

#### `airtable-proxy`
Fetches listings from Airtable.

**Configuration:**
- `AIRTABLE_TOKEN`: API token
- `AIRTABLE_BASE_ID`: Base identifier
- `AIRTABLE_TABLE_NAME`: Table name

#### `generate-bulk-reports`
Orchestrates bulk generation.

**Process:**
1. Create job record
2. Create item records for each property
3. Process items sequentially (to avoid rate limits)
4. Update progress after each
5. Mark job complete

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `Listings.tsx` | `src/pages/Listings.tsx` | Listing grid |
| `PropertyCard.tsx` | `src/components/listings/PropertyCard.tsx` | Property card |
| `BulkGenerationModal.tsx` | `src/components/listings/BulkGenerationModal.tsx` | Bulk generation |
| `BulkProgressTracker.tsx` | `src/components/listings/BulkProgressTracker.tsx` | Progress display |

---

## 14. Data Services & Caching

### Overview

The dashboard integrates with multiple Australian data services to provide accurate, authoritative data for investment reports. Data is cached to reduce API calls and improve performance.

### Data Sources

| Service | Data Provided | Cache Duration |
|---------|---------------|----------------|
| **ABS (Australian Bureau of Statistics)** | Demographics, census data, employment | 30 days |
| **Domain** | Property market data, median prices | 7 days |
| **RBA (Reserve Bank of Australia)** | Interest rates, economic indicators | 1 day |
| **BOM (Bureau of Meteorology)** | Climate data, weather patterns | 30 days |
| **BOCSAR** | Crime statistics | 30 days |
| **State RFS** | Bushfire risk ratings | 30 days |
| **AFRIP** | Flood risk mapping | 30 days |
| **Google Maps** | Walk/transport scores, distances | 7 days |

### Cache Tables

#### `abs_census_cache`
ABS census data by postcode.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `postcode` | TEXT | Postcode |
| `state` | TEXT | State code |
| `dataset` | TEXT | Dataset name |
| `data` | JSONB | Census data |
| `data_quality` | TEXT | Quality indicator |
| `fetched_at` | TIMESTAMP | Fetch time |
| `expires_at` | TIMESTAMP | Expiry time |

#### `climate_data_cache`
Weather and climate data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `postcode` | TEXT | Postcode |
| `suburb` | TEXT | Suburb name |
| `state` | TEXT | State code |
| `climate_zone` | TEXT | Climate classification |
| `temperature_data` | JSONB | Temperature stats |
| `rainfall_data` | JSONB | Rainfall stats |
| `humidity_data` | JSONB | Humidity stats |
| `extreme_weather` | JSONB | Extreme events |
| `projections` | JSONB | Climate projections |
| `data_quality` | TEXT | Quality indicator |
| `fetched_at` | TIMESTAMP | Fetch time |
| `expires_at` | TIMESTAMP | Expiry time |

#### `crime_statistics_cache`
Crime data by suburb.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `suburb` | TEXT | Suburb name |
| `postcode` | TEXT | Postcode |
| `state` | TEXT | State code |
| `data` | JSONB | Crime statistics |
| `data_quality` | TEXT | Quality indicator |
| `fetched_at` | TIMESTAMP | Fetch time |
| `expires_at` | TIMESTAMP | Expiry time |

#### `median_rent_cache`
Rental market data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `suburb` | TEXT | Suburb name |
| `postcode` | TEXT | Postcode |
| `state` | TEXT | State code |
| `property_type` | TEXT | House/unit |
| `bedrooms` | INTEGER | Bedroom count |
| `median_rent` | NUMERIC | Median weekly rent |
| `data` | JSONB | Additional data |
| `fetched_at` | TIMESTAMP | Fetch time |
| `expires_at` | TIMESTAMP | Expiry time |

#### `risk_assessment_cache`
Environmental risk data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `property_address` | TEXT | Full address |
| `suburb` | TEXT | Suburb |
| `postcode` | TEXT | Postcode |
| `flood_risk` | JSONB | Flood assessment |
| `bushfire_risk` | JSONB | Bushfire assessment |
| `other_hazards` | JSONB | Other risks |
| `data_quality` | TEXT | Quality indicator |
| `fetched_at` | TIMESTAMP | Fetch time |
| `expires_at` | TIMESTAMP | Expiry time |

#### `transport_data_cache`
Public transport accessibility.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `suburb` | TEXT | Suburb |
| `postcode` | TEXT | Postcode |
| `state` | TEXT | State code |
| `walk_score` | INTEGER | Walkability score |
| `transit_score` | INTEGER | Transit score |
| `bike_score` | INTEGER | Bike score |
| `nearest_stations` | JSONB | Station data |
| `fetched_at` | TIMESTAMP | Fetch time |
| `expires_at` | TIMESTAMP | Expiry time |

#### `bank_lending_rates_cache`
Current lending rates.

| Column | Type | Description |
|--------|------|-------------|
| `lender_id` | TEXT | Primary key |
| `lender_name` | TEXT | Bank name |
| `rates` | JSONB | Rate products |
| `fetched_at` | TIMESTAMP | Fetch time |
| `expires_at` | TIMESTAMP | Expiry time |

#### `stamp_duty_rates_cache`
State stamp duty rates.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `state` | TEXT | State code |
| `rates` | JSONB | Rate brackets |
| `concessions` | JSONB | Available concessions |
| `effective_date` | DATE | Rate effective date |
| `fetched_at` | TIMESTAMP | Fetch time |

### Reference Tables

#### `schools_directory`
School data by location.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `school_name` | TEXT | School name |
| `school_type` | TEXT | Primary/secondary/combined |
| `sector` | TEXT | Public/private/catholic |
| `suburb` | TEXT | Suburb |
| `postcode` | TEXT | Postcode |
| `state` | TEXT | State code |
| `latitude` | NUMERIC | Latitude |
| `longitude` | NUMERIC | Longitude |
| `icsea_score` | INTEGER | ICSEA rating |

#### `suburb_directory`
Suburb reference data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `suburb` | TEXT | Suburb name |
| `postcode` | TEXT | Postcode |
| `state` | TEXT | State code |
| `lga` | TEXT | Local government area |
| `region` | TEXT | Statistical region |
| `latitude` | NUMERIC | Center latitude |
| `longitude` | NUMERIC | Center longitude |

#### `land_tax_rates`
State land tax thresholds.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `state` | TEXT | State code |
| `threshold` | NUMERIC | Tax threshold |
| `rate` | NUMERIC | Tax rate |
| `effective_date` | DATE | Effective from |

### Edge Functions (Data Services)

#### `abs-data-service`
Fetches ABS census and demographic data.

#### `abs-employment-service`
Fetches employment and industry data.

#### `abs-seifa-service`
Fetches SEIFA (socioeconomic) indices.

#### `climate-data-service`
Fetches BOM climate data.

#### `crime-statistics-service`
Fetches crime statistics.

#### `school-data-service`
Fetches nearby school data.

#### `domain-data-service`
Fetches Domain property market data.

#### `sqm-rent-service`
Fetches SQM rental data.

#### `rba-data-service`
Fetches RBA economic indicators.

#### `cdr-lending-rates-service`
Fetches CDR lending rates.

#### `location-intelligence-service`
Aggregates location data (walk score, transit, amenities).

#### `public-transport-service`
Fetches public transport accessibility.

#### `risk-assessment-service`
Aggregates environmental risk data.

#### `update-stamp-duty-rates`
Updates stamp duty rate cache.

#### `investment-scoring-service`
Calculates property investment scores.

#### `financial-calculator-service`
Performs financial calculations.

#### `financial-validation-service`
Validates financial data accuracy.

---

## 15. Templates & Report Configuration

### Overview

The Templates module allows customization of report structures, chart configurations, and comparison analysis formats.

### Template Types

| Type | Purpose |
|------|---------|
| **Report Structure** | Defines section order and content |
| **Chart Configuration** | Chart styling and data mapping |
| **Comparison Template** | Comparison report format |
| **Branding Template** | Client-specific branding |

### Database Tables

#### `report_structure_templates`
Report section definitions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Template name |
| `description` | TEXT | Description |
| `structure` | JSONB | Section definitions |
| `is_active` | BOOLEAN | Currently active |
| `is_default` | BOOLEAN | Default template |
| `version` | INTEGER | Template version |
| `created_by` | UUID | Creator |
| `created_at` | TIMESTAMP | Creation time |
| `updated_at` | TIMESTAMP | Last update |

#### `report_templates`
General report templates.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Template name |
| `template_type` | TEXT | Template category |
| `content` | JSONB | Template content |
| `is_active` | BOOLEAN | Active status |
| `created_by` | UUID | Creator |

#### `comparison_analysis_templates`
Comparison report formats.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Template name |
| `description` | TEXT | Description |
| `settings` | JSONB | Comparison settings |
| `created_by` | UUID | Creator |

#### `chart_configurations`
Chart styling templates.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `template_name` | TEXT | Configuration name |
| `chart_type` | TEXT | bar/line/pie/etc. |
| `quickchart_config` | JSONB | Chart.js config |
| `default_styling` | JSONB | Style overrides |

#### `charts`
Generated chart records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `report_id` | UUID | FK to generated_reports |
| `title` | TEXT | Chart title |
| `chart_type` | TEXT | Chart type |
| `chart_config` | JSONB | Configuration |
| `image_data` | TEXT | Base64 image or URL |

#### `chart_analysis`
AI analysis of charts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `chart_id` | UUID | FK to charts |
| `analysis_text` | TEXT | AI analysis |
| `confidence_score` | NUMERIC | Confidence level |
| `model_used` | TEXT | AI model |

### Edge Functions

#### `manage-templates`
CRUD for templates.

#### `retrieve-template-context`
Fetches template for report generation.

#### `parse-template-document`
Parses uploaded template documents.

#### `generate-chart-images`
Creates chart images via QuickChart.

#### `generate-chart-analysis`
AI analysis of chart data.

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `Templates.tsx` | `src/pages/Templates.tsx` | Template management |
| `TemplateEditor.tsx` | `src/components/templates/TemplateEditor.tsx` | Template editing |
| `Charts.tsx` | `src/pages/Charts.tsx` | Chart gallery |

---

## 16. White Label / Branding

### Overview

The Branding (White Label) module enables complete dashboard customization for client-facing deployments, including logos, colors, and favicon.

### Customization Options

| Element | Description |
|---------|-------------|
| **Auth Page Logo** | Logo on login page |
| **Expanded Sidebar Logo** | Full logo in sidebar |
| **Collapsed Sidebar Icon** | Small icon when collapsed |
| **Favicon** | Browser tab icon |
| **Primary Color** | Main brand color |
| **Accent Color** | Secondary color |
| **Theme Mode** | Light/dark/system |

### Logo Handling

- **Upload**: Drag-and-drop or file select
- **Background Removal**: Automatic for transparent backgrounds
- **Storage**: Supabase `branding-assets` bucket
- **Dynamic Application**: Applied without page reload

### Color System

Colors are stored in HSL format and injected as CSS variables:

```css
:root {
  --primary: 220 70% 50%;
  --primary-foreground: 0 0% 100%;
  --accent: 280 60% 45%;
  /* ... */
}
```

### Database Tables

#### `whitelabel_settings`
Global branding configuration.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (singleton) |
| `auth_logo_url` | TEXT | Auth page logo |
| `sidebar_logo_url` | TEXT | Expanded logo |
| `sidebar_icon_url` | TEXT | Collapsed icon |
| `favicon_url` | TEXT | Favicon URL |
| `primary_color` | TEXT | HSL primary color |
| `accent_color` | TEXT | HSL accent color |
| `theme_mode` | TEXT | light/dark/system |
| `custom_css` | TEXT | Additional CSS |
| `updated_at` | TIMESTAMP | Last update |
| `updated_by` | UUID | Who updated |

#### `client_branding_profiles`
Client-specific branding (for PDF exports).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_name` | TEXT | Client/company name |
| `logo_path` | TEXT | Logo storage path |
| `primary_color` | TEXT | Primary brand color |
| `secondary_color` | TEXT | Secondary color |
| `accent_color` | TEXT | Accent color |
| `font_family` | TEXT | Brand font |
| `header_style` | JSONB | PDF header config |
| `footer_style` | JSONB | PDF footer config |
| `is_default` | BOOLEAN | Default profile |
| `is_active` | BOOLEAN | Active status |
| `created_by` | UUID | Creator |

### Storage Bucket

**`branding-assets`**
- Public bucket for logo access
- Organized by asset type: `/logos/`, `/favicons/`
- File naming: `{type}_{timestamp}.{ext}`

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `WhiteLabel.tsx` | `src/pages/WhiteLabel.tsx` | Branding settings |
| `LogoUploader.tsx` | `src/components/branding/LogoUploader.tsx` | Logo upload |
| `ColorPicker.tsx` | `src/components/branding/ColorPicker.tsx` | Color selection |
| `WhiteLabelContext.tsx` | `src/contexts/WhiteLabelContext.tsx` | Branding state |

---

## 17. System Monitoring & Logging

### Overview

The Monitoring module provides real-time visibility into system health, API performance, and user activity.

### Monitoring Features

| Feature | Description |
|---------|-------------|
| **API Health** | Status of external API integrations |
| **Response Times** | API latency tracking |
| **Error Rates** | Failure frequency |
| **Data Quality** | Data freshness indicators |
| **Activity Timeline** | User action history |

### Database Tables

#### `api_health_log`
API health check results.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `service_name` | TEXT | API/service name |
| `endpoint` | TEXT | API endpoint |
| `status` | TEXT | success/error |
| `response_time_ms` | INTEGER | Response time |
| `error_message` | TEXT | Error details |
| `data_quality` | TEXT | Data quality note |
| `user_id` | UUID | Triggering user |
| `created_at` | TIMESTAMP | Check time |

#### `activity_logs`
User activity tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK to custom_users |
| `username` | TEXT | Username |
| `action_type` | ENUM | Action category |
| `entity_type` | ENUM | Entity category |
| `entity_id` | TEXT | Related entity ID |
| `entity_name` | TEXT | Entity display name |
| `metadata` | JSONB | Additional context |
| `ip_address` | TEXT | Client IP |
| `user_agent` | TEXT | Browser/client |
| `created_at` | TIMESTAMP | Action time |

**Action Types:**
- `create`, `update`, `delete`
- `view`, `export`, `import`
- `login`, `logout`
- `generate`, `regenerate`

**Entity Types:**
- `report`, `client`, `property`
- `user`, `template`, `automation`
- `email`, `call`, `file`

### Edge Functions

#### `get-system-logs`
Fetches system logs with filtering.

**Modes:**
- `logs`: Activity log retrieval
- `health`: API health statistics

#### `get-activity-logs`
Fetches user activity logs.

#### `log-activity`
Records user actions.

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `Monitoring.tsx` | `src/pages/Monitoring.tsx` | Health dashboard |
| `ActivityLogs.tsx` | `src/pages/admin/ActivityLogs.tsx` | Activity timeline |
| `ErrorLogs.tsx` | `src/pages/ErrorLogs.tsx` | Error tracking |
| `APIHealthCard.tsx` | `src/components/monitoring/APIHealthCard.tsx` | Service status |

---

## 18. Data Import

### Overview

The Data Import module enables bulk import of client data from external sources, including CSV files and GoHighLevel contacts.

### Import Sources

| Source | Description |
|--------|-------------|
| **CSV Upload** | Spreadsheet import |
| **GoHighLevel** | CRM contact import |
| **Excel** | XLSX file import |

### CSV Import Process

1. Upload CSV file
2. Map columns to client fields
3. Validate data
4. Preview import
5. Execute import
6. View results

### Database Tables

#### `client_import_logs`
Import job tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `file_name` | TEXT | Source filename |
| `status` | TEXT | pending/processing/completed/failed |
| `clients_created` | INTEGER | New clients |
| `properties_created` | INTEGER | New properties |
| `errors` | JSONB | Error details |
| `imported_by` | UUID | Importer |
| `created_at` | TIMESTAMP | Start time |
| `completed_at` | TIMESTAMP | End time |

### Edge Functions

#### `manage-data-import`
Handles import processing.

#### `import-clients-from-ghl`
Imports contacts from GoHighLevel.

#### `import-schools-data`
Imports school directory data.

#### `import-suburb-directory`
Imports suburb reference data.

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `DataImport.tsx` | `src/pages/DataImport.tsx` | Import interface |
| `CSVMapper.tsx` | `src/components/import/CSVMapper.tsx` | Column mapping |
| `ImportPreview.tsx` | `src/components/import/ImportPreview.tsx` | Preview |

---

## 19. External Integrations

### Overview

The dashboard integrates with multiple external services to provide comprehensive functionality. All integration credentials are managed through Supabase secrets.

### Integration Summary

| Integration | Purpose | Required Secrets |
|-------------|---------|------------------|
| **Perplexity AI** | Property research, data extraction | `PERPLEXITY_API_KEY` |
| **OpenAI** | Chat AI, transcription, charts | `OPENAI_API_KEY` |
| **GoHighLevel** | CRM sync, pipeline management | `GHL_API_KEY`, `GHL_LOCATION_ID` |
| **Microsoft/Outlook** | Email sync, calendar | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` |
| **Airtable** | Property listings | `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME` |
| **Vapi** | Voice AI calls | `VAPI_API_KEY` |
| **Twilio** | SMS (optional) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| **Domain** | Property market data | `DOMAIN_API_KEY` |
| **Resend** | Email notifications | `RESEND_API_KEY` |

### Perplexity AI

**Usage:**
- Investment report research (sonar-pro model)
- Property listing URL scraping
- PDF document extraction
- Property expense estimation

**Configuration:**
```
Secret: PERPLEXITY_API_KEY
Model: sonar-pro
Max Tokens: 2000-5000 per section
```

### OpenAI

**Usage:**
- Report Q&A conversational AI (GPT-4)
- User Guide Assistant
- Audio transcription (Whisper)
- Chart generation (Python code execution)
- Report condensation (Tier 2/3)

**Configuration:**
```
Secret: OPENAI_API_KEY
Models: gpt-4o, whisper-1
```

### GoHighLevel

**Usage:**
- Contact/client synchronization
- Pipeline stage management
- Note syncing
- Calendar integration (read-only)

**Configuration:**
```
Secrets: GHL_API_KEY, GHL_LOCATION_ID
Sync: Bidirectional
```

### Microsoft / Outlook

**Usage:**
- Email inbox synchronization
- Sent folder tracking
- Email sending
- Calendar access

**Configuration:**
```
Secrets: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID
Auth: OAuth 2.0 Client Credentials
Scope: Mail.ReadWrite, Calendars.Read
```

### Airtable

**Usage:**
- Property listing source
- Data synchronization

**Configuration:**
```
Secrets: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME
```

### Vapi

**Usage:**
- Voice AI call handling
- Call transcription
- Call summary generation

**Configuration:**
```
Secret: VAPI_API_KEY
Webhook: /functions/v1/vapi-call-webhook
```

### Integration Management Edge Functions

#### `update-integration-secret`
Securely updates integration credentials.

**Allowed Secrets:**
- All integration API keys
- Configuration IDs
- Webhook URLs

#### `check-integration-secrets`
Verifies secret configuration status.

---

## 20. Security Architecture

### Overview

The dashboard implements a comprehensive security model based on service-role mediation, Row-Level Security (RLS), and secure session management.

### Security Principles

1. **Zero Trust Frontend**: All database operations mediated through Edge Functions
2. **Service Role Access**: Edge Functions use `service_role` for database access
3. **Session Verification**: Every request validates user session
4. **RLS Enforcement**: Database-level access control as backup

### Secure Mediation Pattern

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Edge Function      │────▶│    Database     │
│   (React)       │     │   (Deno)             │     │   (PostgreSQL)  │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
        │                         │                          │
        │                         │ 1. Verify session        │
        │                         │ 2. Check permissions     │
        │                         │ 3. Use service_role      │
        │                         │ 4. Execute query         │
        │                         │                          │
```

### invokeSecureFunction Pattern

All frontend data operations use a centralized pattern:

```typescript
const { data, error } = await invokeSecureFunction('edge-function-name', {
  action: 'read|create|update|delete',
  ...params
});
```

**Function Responsibilities:**
1. Extract session token from cookie or header
2. Validate session against `user_sessions`
3. Check user permissions for requested action
4. Execute database operation with `service_role`
5. Return sanitized response

### Session Authentication Flow

```
┌─────────────────┐
│  HTTP Request   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Cookie Check   │────▶│  Header Check   │
│  (session_id)   │ No  │(x-session-token)│
└────────┬────────┘     └────────┬────────┘
         │ Yes                   │ Yes
         ▼                       ▼
┌─────────────────────────────────────────┐
│     Validate against user_sessions      │
│     Check expiry, get user_id           │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│        Fetch user + permissions         │
│        from custom_users                │
└─────────────────────────────────────────┘
```

### Row-Level Security (RLS)

All tables have RLS enabled with policies restricting access:

**Common Patterns:**
- `authenticated` role: Basic access for logged-in users
- `service_role`: Bypass RLS for Edge Functions
- `anon`: Public access (minimal tables only)

**Example Policy:**
```sql
CREATE POLICY "Users can only view own data"
ON clients
FOR SELECT
TO authenticated
USING (created_by = auth.uid());
```

### Secure Storage

File uploads (PDFs, logos) use the `secure-storage` Edge Function:

**Process:**
1. Verify user session
2. Validate file type and size
3. Generate secure path
4. Upload with appropriate bucket policy
5. Return signed URL

### API Security

**CORS Configuration:**
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
};
```

**JWT Handling:**
- Edge Functions set `verify_jwt = false` in config
- Manual JWT validation in code for flexibility
- Custom session tokens for cross-origin scenarios

---

## 21. Global Settings

### Overview

Global Settings control dashboard-wide configurations that apply to all generated reports and system behavior.

### Settings Categories

| Category | Description |
|----------|-------------|
| **Contact Details** | Business contact information for reports |
| **Professional Disclaimer** | Legal disclaimer for report footers |
| **Report Defaults** | Default values for report generation |

### Contact Details

Fields:
- Company Name
- ABN
- Phone Number
- Email Address
- Website
- Business Address

### Professional Disclaimer

Configuration:
- Disclaimer text (multi-paragraph)
- Font size (small/medium/large)
- Enable/disable toggle

### Database Tables

#### `global_report_settings`
Key-value settings storage.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `setting_key` | TEXT | Setting identifier |
| `setting_value` | JSONB | Setting data |
| `updated_at` | TIMESTAMP | Last update |
| `updated_by` | UUID | Who updated |

**Setting Keys:**
- `contact_details`: Business contact info
- `professional_disclaimer`: Disclaimer configuration

### Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| `Settings.tsx` | `src/pages/Settings.tsx` | Settings interface |
| `GlobalReportSettings.tsx` | `src/components/templates/GlobalReportSettings.tsx` | Report settings |

---

## 22. Storage Buckets

### Overview

Supabase Storage is used for file storage across the dashboard.

### Bucket Configuration

| Bucket | Access | Purpose |
|--------|--------|---------|
| `branding-assets` | Public | Logos, favicons |
| `client-files` | Private | Client documents |
| `report-exports` | Private | Generated PDFs |
| `template-assets` | Private | Template resources |

### File Organization

```
branding-assets/
├── logos/
│   ├── auth_{timestamp}.png
│   ├── sidebar_{timestamp}.png
│   └── icon_{timestamp}.png
└── favicons/
    └── favicon_{timestamp}.ico

client-files/
└── {client_id}/
    ├── documents/
    ├── reports/
    └── forms/

report-exports/
└── {report_id}/
    ├── investors_compass_{timestamp}.pdf
    ├── executive_briefing_{timestamp}.pdf
    └── snapshot_{timestamp}.pdf
```

---

## 23. Deployment & Environment

### Environments

| Environment | Purpose | URL Pattern |
|-------------|---------|-------------|
| **Preview** | Development/testing | `*.lovable.app` |
| **Production** | Live deployment | Custom domain |

### Environment Variables

**Required Supabase Secrets:**

```
# Core
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# AI Services
PERPLEXITY_API_KEY
OPENAI_API_KEY

# Integrations
AIRTABLE_TOKEN
AIRTABLE_BASE_ID
AIRTABLE_TABLE_NAME
GHL_API_KEY
GHL_LOCATION_ID
VAPI_API_KEY
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_TENANT_ID
MICROSOFT_MAILBOX_EMAIL

# Optional
DOMAIN_API_KEY
RESEND_API_KEY
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
```

### Edge Function Deployment

Edge Functions deploy automatically on code push:
- Location: `supabase/functions/{function-name}/index.ts`
- Configuration: `supabase/config.toml`
- Timeout: Up to 900 seconds (configurable per function)

### Database Migrations

Schema changes managed via Supabase migrations:
- Location: `supabase/migrations/`
- Applied automatically on deployment

---

## Appendix A: Edge Function Reference

### Complete Function List

| Function | Purpose | Auth Required |
|----------|---------|---------------|
| `abs-data-service` | ABS census data | Yes |
| `abs-employment-service` | Employment data | Yes |
| `abs-seifa-service` | SEIFA indices | Yes |
| `admin-password-reset` | Password reset | Yes (Superadmin) |
| `admin-user-management` | User CRUD | Yes (Superadmin) |
| `airtable-proxy` | Airtable data fetch | Yes |
| `archive-old-reports` | Report archival | Yes |
| `auto-report-sync` | Automation trigger | Yes |
| `auto-report-webhook` | Automation webhook | No (Webhook) |
| `calculate-borrowing-capacity` | Capacity calculation | Yes |
| `cdr-lending-rates-service` | Lending rates | Yes |
| `check-integration-secrets` | Secret status | Yes |
| `clean-note-transcript` | Transcript cleanup | Yes |
| `cleanup-stale-calls` | Call cleanup | Yes |
| `climate-data-service` | Climate data | Yes |
| `compare-cash-flow-reports` | Cash flow comparison | Yes |
| `compare-investment-reports` | Report comparison | Yes |
| `condense-investment-report` | Report condensation | Yes |
| `crime-statistics-service` | Crime data | Yes |
| `custom-auth-login` | User login | No |
| `custom-auth-logout` | User logout | Yes |
| `custom-auth-verify` | Session validation | Yes |
| `data-conflict-resolver` | Data conflicts | Yes |
| `domain-data-service` | Domain API | Yes |
| `email-copilot` | AI email drafts | Yes |
| `estimate-property-expenses` | Expense estimation | Yes |
| `financial-calculator-service` | Financial calcs | Yes |
| `financial-validation-service` | Data validation | Yes |
| `fix-report-status` | Status correction | Yes |
| `format-comparison-report` | Report formatting | Yes |
| `generate-bulk-reports` | Bulk generation | Yes |
| `generate-chart-analysis` | Chart AI analysis | Yes |
| `generate-chart-images` | Chart images | Yes |
| `generate-charts-python` | Python charts | Yes |
| `generate-investment-report` | Report generation | Yes |
| `generate-portfolio-analysis` | Portfolio reports | Yes |
| `get-activity-logs` | Activity logs | Yes |
| `get-call-logs` | Call data | Yes |
| `get-client-data` | Client fetch | Yes |
| `get-investment-reports` | Report fetch | Yes |
| `get-system-logs` | System logs | Yes |
| `ghl-calendar` | GHL calendar | Yes |
| `ghl-calendar-test` | Calendar testing | Yes |
| `ghl-contact-search` | GHL search | Yes |
| `import-clients-from-ghl` | GHL import | Yes |
| `import-schools-data` | School import | Yes (Admin) |
| `import-suburb-directory` | Suburb import | Yes (Admin) |
| `investment-scoring-service` | Investment scoring | Yes |
| `location-intelligence-service` | Location data | Yes |
| `log-activity` | Activity logging | Yes |
| `manage-automation-settings` | Automation CRUD | Yes |
| `manage-call-logs` | Call CRUD | Yes |
| `manage-call-settings` | Call settings | Yes |
| `manage-client-data` | Client CRUD | Yes |
| `manage-data-import` | Import handling | Yes |
| `manage-investment-reports` | Report CRUD | Yes |
| `manage-templates` | Template CRUD | Yes |
| `migrate-comparison-scores` | Score migration | Yes (Admin) |
| `outlook-email-sync` | Email sync | Yes |
| `outlook-email-webhook` | Email webhook | No (Webhook) |
| `outlook-manage-subscription` | Webhook management | Yes |
| `parse-property-pdf` | PDF extraction | Yes |
| `parse-template-document` | Template parsing | Yes |
| `public-transport-service` | Transport data | Yes |
| `rba-data-service` | RBA data | Yes |
| `regenerate-report-qualitative` | Report regen | Yes |
| `report-qa` | Report Q&A chat | Yes |
| `report-schema-validator` | Schema validation | Yes |
| `retrieve-template-context` | Template fetch | Yes |
| `risk-assessment-service` | Risk data | Yes |
| `school-data-service` | School data | Yes |
| `scrape-property-listing` | URL scraping | Yes |
| `secure-storage` | File operations | Yes |
| `send-call-alert-email` | Alert emails | Yes |
| `send-email-reply` | Email sending | Yes |
| `send-weekly-call-report` | Weekly reports | Yes |
| `sqm-rent-service` | Rent data | Yes |
| `sync-client-to-ghl` | GHL sync | Yes |
| `sync-ghl-pipelines` | Pipeline sync | Yes |
| `sync-notes-to-ghl` | Note sync | Yes |
| `update-ghl-opportunity-stage` | Stage update | Yes |
| `update-integration-secret` | Secret update | Yes (Superadmin) |
| `update-stamp-duty-rates` | Rate update | Yes (Admin) |
| `user-guide-assistant` | Guide AI | Yes |
| `vapi-call-webhook` | Call webhook | No (Webhook) |
| `voice-to-text` | Transcription | Yes |

---

## Appendix B: Database Table Reference

### Complete Table List (56 Tables)

**Core Application:**
- `clients`
- `client_activities`
- `client_assets`
- `client_employment`
- `client_expenses`
- `client_files`
- `client_import_logs`
- `client_income`
- `client_liabilities`
- `client_notes`
- `client_properties`
- `client_reminders`
- `client_scores`
- `client_tag_assignments`
- `client_tags`

**Reports & Analysis:**
- `investment_reports`
- `report_versions`
- `report_structure_templates`
- `report_templates`
- `portfolio_analysis_reports`
- `portfolio_reviews`
- `cash_flow_analyses`
- `property_comparisons`
- `borrowing_capacity_assessments`
- `comparison_analysis_templates`

**AI & Q&A:**
- `report_qa_conversations`
- `report_qa_messages`
- `document_chunks`
- `chart_analysis`
- `charts`
- `chart_configurations`

**User Management:**
- `custom_users`
- `user_roles`
- `user_permissions`
- `user_sessions`
- `password_reset_tokens`
- `permission_invite_tokens`

**Communications:**
- `email_copilot_emails`
- `email_copilot_sent_replies`
- `vapi_call_logs`
- `call_alert_rules`
- `call_alert_history`
- `call_tags`

**Automation:**
- `auto_report_switches`
- `auto_report_master_settings`
- `auto_report_processed_listings`
- `auto_report_generation_log`
- `bulk_generation_jobs`
- `bulk_generation_items`

**Integrations:**
- `ghl_pipelines`
- `ghl_pipeline_stages`
- `integration_configs`

**Caches:**
- `abs_census_cache`
- `bank_lending_rates_cache`
- `climate_data_cache`
- `crime_statistics_cache`
- `economic_data_cache`
- `median_rent_cache`
- `risk_assessment_cache`
- `stamp_duty_rates_cache`
- `transport_data_cache`

**Reference Data:**
- `schools_directory`
- `suburb_directory`
- `land_tax_rates`
- `land_tax_addons`
- `land_tax_quarterly_splits`

**System:**
- `activity_logs`
- `api_health_log`
- `dashboard_modules`
- `global_report_settings`
- `whitelabel_settings`
- `client_branding_profiles`
- `generated_reports`

---

*Document generated: January 2026*  
*For questions or updates, contact the development team.*
