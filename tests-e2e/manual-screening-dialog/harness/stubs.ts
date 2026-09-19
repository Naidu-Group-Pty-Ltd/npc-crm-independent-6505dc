/**
 * The two modules the dialog talks to the outside world through.
 *
 * Stubbed so the harness is a LAYOUT fixture and nothing else: no Supabase
 * client, no network, no auth. Everything the layout tests measure — the
 * dialog box, the outcome grid, the evidence grid, the footer — is the real
 * component rendering real classes in a real engine.
 */
export const amlCasesApi = {
  recordManualScreening: async () => ({
    check: { id: "harness" },
    outcome: "no_match",
    policy_required: true,
    voluntary: false,
    satisfies_obligation: true,
    party_state: "completed",
  }),
};

export const toast = () => {};
