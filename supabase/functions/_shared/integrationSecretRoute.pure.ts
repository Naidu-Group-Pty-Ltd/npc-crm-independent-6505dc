/**
 * Where a key typed on the Integrations page is WRITTEN, and by whom.
 *
 * ## The defect this closes
 *
 * A credential typed on the Integrations page has TWO readers, and the page
 * had one button for each of them.
 *
 * **Save** writes a row into `integration_configs`. That row is read by
 * exactly one consumer — `_shared/workflow/stepExecutor.ts`'s `loadSecrets`,
 * which resolves the credentials a Workflow Playground step names. Nothing in
 * the product's own runtime reads it: `_shared/ghl-account.ts` does
 * `Deno.env.get('GOHIGHLEVEL_API_KEY')`, and so does every other consumer.
 *
 * **Sync to Supabase** writes the OTHER store, the project's function
 * environment, through the Supabase Management API — and needs a management
 * token to do it. That is a Supabase PERSONAL ACCESS TOKEN: it is scoped to an
 * ACCOUNT, not a project, so it can read and rewrite the secrets, database and
 * settings of every project the account owns, the prime's and Mission
 * Control's included. It must never be placed on a tenant's project, which is
 * why `SB_MANAGEMENT_ACCESS_TOKEN` reads `missing` in every clone's ledger.
 *
 * So one act was split across two buttons, and on a clone the second one could
 * not work at all. Measured 10 Sep 2026: the prime held 20
 * `integration_configs` rows and every single value was empty; NPC Test held
 * none, and `GOHIGHLEVEL_API_KEY` / `GOHIGHLEVEL_LOCATION_ID` were `missing`
 * in its ledger. Whichever button an operator pressed, the credential did not
 * arrive where the code that needs it looks.
 *
 * ## The same answer this platform has already given twice
 *
 * A credential that cannot be narrowed to one tenant does not travel; the CALL
 * travels. That is `diditStandaloneRoute.pure.ts` for identity verification
 * (an application-scoped key that can list every tenant's customers' passport
 * portraits) and `airtableListingsRoute.pure.ts` for Listings (a personal
 * access token carrying its whole base scope). This is the third, and the
 * shape is deliberately theirs: resolve a route, never a flag.
 *
 * - **`direct`** — this deployment holds a management token, so it writes its
 *   own project's secrets, exactly as it does today. That is the prime, and
 *   any deployment whose owner has supplied their own token.
 * - **`broker`** — this deployment has a Mission Control link instead. Mission
 *   Control holds the management token, resolves WHICH project from the
 *   caller's own key (`decideCloneSecretTarget` — the ref is a return value,
 *   never an argument) and writes there.
 * - **`unconfigured`** — neither. Said as a state rather than reported as the
 *   management token being absent, because on a clone that token is absent BY
 *   DESIGN and telling an operator to add one sends them to fetch exactly the
 *   credential this arrangement exists to keep off their project.
 *
 * ## Three rules
 *
 * **A brokered write names no project.** The `broker` branch has no
 * `projectRef` field at all, so nothing can put one in a brokered request even
 * by mistake — the same structural trick the listings broker uses to keep a
 * base id out of a brokered read. Mission Control derives the target from the
 * key it was presented.
 *
 * **What may be written is decided identically on both routes.** The refusals
 * (`deploymentIdentityRefusal`, `listingsPipelineRefusal`, the allow-list) run
 * BEFORE the route is consulted, so brokering can never become a way to write
 * a name the direct path refuses. Mission Control then applies its OWN
 * independent deny-list, because a broker that trusts its caller's validation
 * is not a broker.
 *
 * **Presence is not capability.** `direct` is chosen because this deployment
 * HOLDS a management token, and for a while that was read as "a value is set
 * under the name". A dead value then outranked a healthy broker and the page
 * told a tenant to rotate a Supabase account credential they must never hold.
 * `looksLikeManagementToken` is the difference between a token and a string,
 * and a direct write that is refused 401 now retries through the broker when
 * there is one rather than dead-ending.
 *
 * **Who refused is read from a header**, never guessed from a body:
 * `x-mission-control-refusal` is set on Mission Control's own refusals and
 * never on what it relays. "Your Mission Control key lacks a scope" and "the
 * Management API rejected the write" are both 4xx JSON and send an operator to
 * opposite remedies.
 *
 * Pure: no Deno, so the frontend tests import it too.
 */

/** Mission Control's path for a brokered integration-secret write. */
export const INTEGRATION_SECRETS_BROKER_PATH = '/api/public/integrations/secrets';

export type IntegrationSecretRoute =
  | {
      via: 'direct';
      /** Only the direct route knows a project, because only it holds the token. */
      projectRef: string;
      /** Which name the token came from, so a 401 can name it. */
      tokenSource: 'SB_MANAGEMENT_ACCESS_TOKEN' | 'SUPABASE_ACCESS_TOKEN';
      headers: Record<string, string>;
      /** The credential to redact from any error text on this route. */
      secret: string;
    }
  | {
      via: 'broker';
      /** Mission Control's ORIGIN. Any path the setting carried is trimmed. */
      missionControlUrl: string;
      /** What was trimmed, when the setting carried a path. Reported, never silent. */
      trimmedPath?: string;
      /**
       * Set when a management token WAS present and was discarded as unusable.
       *
       * Reported rather than swallowed: a value under that name on a tenant's
       * project is a setting somebody made, and brokering past it silently
       * leaves it there to confuse the next reader.
       */
      unusableManagementToken?: string;
      headers: Record<string, string>;
      secret: string;
    }
  | { via: 'unconfigured'; why: string };

/**
 * Read `MISSION_CONTROL_URL` as an ORIGIN, and say what was trimmed.
 *
 * Duplicated in shape from `airtableListingsRoute.pure.ts` and for the same
 * measured reason: a setting of `https://…/api` composed `…/api/api/public/…`,
 * which Mission Control's router answers 404 with none of its own headers on
 * it — indistinguishable, before the trim, from the vendor's own 404. It is
 * trimmed rather than refused (a deployment one concatenation from correct
 * should not be taken off the air) and REPORTED rather than trimmed silently
 * (a repair nobody is told about is a setting that stays wrong).
 */
export function missionControlOrigin(raw: string): { origin: string; trimmedPath?: string } {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return { origin: '' };
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, '');
    return path ? { origin: u.origin, trimmedPath: path } : { origin: u.origin };
  } catch {
    // Not parseable. Hand it back as it was: naming the setting in a failure
    // is more use than replacing it with an empty string, which reads as "not
    // configured" and sends an operator to the wrong remedy.
    return { origin: trimmed };
  }
}

/**
 * A Supabase project ref, read from this deployment's own `SUPABASE_URL`.
 *
 * The direct route writes to THIS project and no other — the ref is derived
 * here from the deployment's own URL rather than accepted from anywhere, which
 * is the clone-side counterpart of Mission Control's rule that a project ref
 * is a return value and never an argument.
 */
export function ownProjectRefFromUrl(supabaseUrl: string | null | undefined): string | null {
  const m = (supabaseUrl ?? '').match(/^https:\/\/([a-z0-9]{20})\./);
  return m ? m[1] : null;
}

/**
 * Whether a value can be a Supabase management token AT ALL.
 *
 * This is not validation — only Supabase can say whether a token is live, and
 * this deliberately does not try. It answers the cheaper question the resolver
 * actually needs: is this a token, or is it some other string sitting under
 * that name?
 *
 * The two have opposite consequences, which is why the difference is worth a
 * function. A Supabase personal access token is `sbp_` followed by its body.
 * Measured on `plisdzywzleljorrphxv` on 12 Sep 2026, the value under
 * `SB_MANAGEMENT_ACCESS_TOKEN` was not one: the Management API answered
 * `401 {"message":"JWT could not be decoded"}`, which is what it says when the
 * bearer is neither a PAT nor a JWT. That single dead value took the `direct`
 * route — which is chosen on PRESENCE — and so disabled a Mission Control
 * broker that was healthy at the same moment, and the page told a tenant to
 * rotate a Supabase account token they must never hold in the first place.
 *
 * So: a value that cannot be a token is ABSENT, not present. The prime is
 * untouched by this, because a real `sbp_` token still resolves `direct`.
 */
export function looksLikeManagementToken(raw: string | null | undefined): boolean {
  // The PREFIX is the discriminator and nothing else is. A length floor would
  // be guessing at a format Supabase is free to change, and the cost of
  // guessing wrong is the prime silently losing its direct route.
  return /^sbp_[A-Za-z0-9._-]+$/.test((raw ?? '').trim());
}

/**
 * The brokered route this deployment could use, or null.
 *
 * Split out because two callers need it: the resolver, and the retry that runs
 * when a direct write is refused. A broker that exists is a route that was
 * available all along, and a dead end with a working alternative beside it is
 * the defect this module keeps being repaired for.
 */
export function brokerRoute(input: {
  missionControlUrl: string | null | undefined;
  cloneApiKey: string | null | undefined;
}): Extract<IntegrationSecretRoute, { via: 'broker' }> | null {
  const mc = missionControlOrigin((input.missionControlUrl ?? '').trim());
  const cloneKey = (input.cloneApiKey ?? '').trim();
  if (!mc.origin || !cloneKey) return null;
  return {
    via: 'broker',
    missionControlUrl: mc.origin,
    ...(mc.trimmedPath ? { trimmedPath: mc.trimmedPath } : {}),
    headers: {
      'x-clone-api-key': cloneKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    secret: cloneKey,
  };
}

export function resolveIntegrationSecretRoute(input: {
  managementToken: string | null | undefined;
  /** Set when `SB_MANAGEMENT_ACCESS_TOKEN` supplied the token, for the message on a 401. */
  managementTokenSource?: 'SB_MANAGEMENT_ACCESS_TOKEN' | 'SUPABASE_ACCESS_TOKEN';
  supabaseUrl: string | null | undefined;
  missionControlUrl: string | null | undefined;
  cloneApiKey: string | null | undefined;
}): IntegrationSecretRoute {
  const presented = (input.managementToken ?? '').trim();
  // A value that cannot be a token is absent. See `looksLikeManagementToken`.
  const token = looksLikeManagementToken(presented) ? presented : '';
  const discarded = presented && !token
    ? `A value is set under ${input.managementTokenSource ?? 'SUPABASE_ACCESS_TOKEN'} but it is ` +
      'not shaped like a Supabase personal access token (those begin `sbp_`), so it was not used.'
    : '';
  const projectRef = ownProjectRefFromUrl(input.supabaseUrl);

  if (token && projectRef) {
    return {
      via: 'direct',
      projectRef,
      tokenSource: input.managementTokenSource ?? 'SUPABASE_ACCESS_TOKEN',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      secret: token,
    };
  }

  /*
   * A management token with no readable project ref is its own fault and never
   * a reason to broker: brokering it would write this operator's key onto
   * whichever project the Mission Control key resolves to, which may not be
   * the one they are looking at. Say which half is missing.
   */
  if (token && !projectRef) {
    return {
      via: 'unconfigured',
      why:
        'A management token is set but SUPABASE_URL does not name a project, so this deployment ' +
        'cannot say which project to write the secret onto.',
    };
  }

  const broker = brokerRoute(input);
  if (broker) {
    return discarded ? { ...broker, unusableManagementToken: discarded } : broker;
  }

  /*
   * Nothing works. When a value WAS presented, say that rather than "nothing
   * is configured": those send an operator to opposite remedies, and the
   * second one is a lie about a project that plainly has the name set.
   */
  if (discarded) {
    return {
      via: 'unconfigured',
      why:
        `${discarded} This deployment has no Mission Control link to fall back to either, so ` +
        'there is nowhere to write. Remove the value, or replace it with a real management token.',
    };
  }

  /*
   * Both routes, and who each one is for.
   *
   * The broker stays named FIRST, for the reason it always was: a clone told
   * to go and fetch a Supabase personal access token is being sent after the
   * one credential this arrangement exists to keep off its project.
   *
   * But naming it first is not the same as naming it for everyone, and the
   * message used to read as though it were. Measured 16 Sep 2026 on the prime:
   * the page said this, an operator followed it, and the broker would have
   * refused twice over — Mission Control rejects a prime-scoped key
   * (`clone_id` null) 403 `not_a_clone_key`, and `decideCloneSecretTarget`
   * refuses any target equal to `prime_config.supabase_project_ref` with
   * `target_is_prime`. Setting the pair would have moved the page from this
   * honest 400 to a 403, which is worse: it looks configured.
   */
  return {
    via: 'unconfigured',
    why:
      'This deployment can neither write its own secrets nor reach Mission Control. It needs ' +
      'either MISSION_CONTROL_URL and MISSION_CONTROL_CLONE_API_KEY — the ordinary arrangement ' +
      'for a workspace Mission Control PROVISIONED, whose own key is what names the project it ' +
      'may write to — or its own SB_MANAGEMENT_ACCESS_TOKEN, which is the route for a ' +
      'deployment that holds a management token of its own, the prime included. The broker ' +
      'serves provisioned workspaces only: it refuses a prime-scoped key, and refuses the ' +
      'prime\'s own project as a target, so setting that pair here would replace this message ' +
      'with a 403 rather than a working save.',
  };
}

/** The URL one brokered write is sent to. Only ever a brokered route. */
export function integrationSecretBrokerUrl(route: IntegrationSecretRoute): string {
  if (route.via !== 'broker') {
    throw new Error(`integrationSecretBrokerUrl called on a ${route.via} route`);
  }
  return `${route.missionControlUrl}${INTEGRATION_SECRETS_BROKER_PATH}`;
}

/**
 * Mission Control names itself on every answer — a refusal AND a relay.
 *
 * `x-mission-control-refusal` answers "did Mission Control refuse this, or did
 * the Management API?". It cannot answer the question one step out: did the
 * request reach Mission Control at all? It is absent on a relayed failure and
 * equally absent on a 404 from whatever other host `MISSION_CONTROL_URL`
 * happens to name. The endpoint header is a POSITIVE marker of arrival, which
 * is what lets its absence mean something.
 */
export const MISSION_CONTROL_REFUSAL_HEADER = 'x-mission-control-refusal';
export const MISSION_CONTROL_ENDPOINT_HEADER = 'x-mission-control-endpoint';

/** Which end produced a failing answer to a write. */
export type SecretWriteEnd = 'supabase' | 'mission_control' | 'not_mission_control' | 'unconfigured';

export interface SecretWriteFailure {
  readonly end: SecretWriteEnd;
  /** A stable code for a log line. Anything variable goes in `detail`. */
  readonly code: string;
  /** How to name that end to a person reading a message. */
  readonly service: string;
  readonly detail?: string;
}

export function describeSecretWriteFailure(
  route: IntegrationSecretRoute,
  response: { status: number; headers: Headers },
): SecretWriteFailure {
  if (route.via === 'unconfigured') {
    // Nothing was called, so nothing answered. Reported rather than thrown:
    // this runs on a failure path, and throwing here would replace a real
    // fault with a stack trace about the reporting of it.
    return { end: 'unconfigured', code: 'secret_write_not_configured', service: 'this deployment' };
  }

  if (route.via === 'direct') {
    return {
      end: 'supabase',
      code: `management_api_${response.status}`,
      service: 'the Supabase Management API',
      detail: `written directly, with ${route.tokenSource} held on this deployment`,
    };
  }

  const refusal = response.headers.get(MISSION_CONTROL_REFUSAL_HEADER);
  if (refusal) {
    return {
      end: 'mission_control',
      code: `mission_control_${refusal}`,
      service: 'Mission Control',
    };
  }

  if (response.headers.get(MISSION_CONTROL_ENDPOINT_HEADER) !== null) {
    return {
      end: 'supabase',
      code: `management_api_${response.status}`,
      service: 'the Supabase Management API',
      detail: 'brokered by Mission Control, which relayed this answer',
    };
  }

  return {
    end: 'not_mission_control',
    code: `mission_control_unreachable_${response.status}`,
    // Name what was ADDRESSED. "Something that is not Mission Control
    // answered" narrows the search; the URL ends it — and the host is often
    // right while the setting carried a path, which reads as the opposite
    // fault if the message asserts the host is wrong.
    service: `${route.missionControlUrl} (MISSION_CONTROL_URL)`,
    detail: route.trimmedPath
      ? `MISSION_CONTROL_URL carried the path ${route.trimmedPath}, read as its origin`
      : undefined,
  };
}
