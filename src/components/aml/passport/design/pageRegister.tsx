/**
 * The design's page register — order, numbering and audience.
 *
 * Separate from the workspace so the shell file exports only its component
 * (react-refresh), and so adding a page is a one-line edit in a file that
 * contains nothing else.
 */
import {
  IdentityPage,
  JourneyPage,
  OverviewPage,
  OwnershipPage,
  ScreeningPage,
  VerificationPage,
  type PassportPageProps,
} from "./pagesJourney";
import {
  EvidencePage,
  FundingPage,
  HistoryPage,
  PartnersPage,
  StampsPage,
  TransactionPage,
} from "./pagesRecord";

/** Order and numbering are part of the design, not a display preference. */
export const PASSPORT_PAGES: Array<{
  id: string;
  n: string;
  title: string;
  Component: (p: PassportPageProps) => JSX.Element;
  /** Pages the client audience never sees — the projection also omits their data. */
  commandOnly?: boolean;
}> = [
  { id: "journey", n: "00", title: "AML/CTF Journey", Component: JourneyPage },
  { id: "overview", n: "01", title: "Overview", Component: OverviewPage },
  { id: "identity", n: "02", title: "Identity", Component: IdentityPage },
  { id: "verification", n: "03", title: "Verification", Component: VerificationPage },
  { id: "ownership", n: "04", title: "Ownership & Control", Component: OwnershipPage },
  { id: "screening", n: "05", title: "Screening", Component: ScreeningPage, commandOnly: true },
  { id: "funding", n: "06", title: "Funding & EDD", Component: FundingPage, commandOnly: true },
  { id: "evidence", n: "07", title: "Evidence & Documents", Component: EvidencePage },
  { id: "transaction", n: "08", title: "Transaction", Component: TransactionPage },
  { id: "partners", n: "09", title: "Partner Access", Component: PartnersPage, commandOnly: true },
  { id: "stamps", n: "10", title: "Stamps & Certifications", Component: StampsPage },
  { id: "history", n: "11", title: "Passport History", Component: HistoryPage },
];
