/**
 * A PROPERTY'S PHOTOGRAPHS AND DOCUMENTS CONVERGE BESIDE IT, NEVER INSIDE IT.
 *
 * The Builders Network sends each property as one signed `stock.item.upserted`
 * event, and the main sweep (`builder_network_apply_inbound_events`) turns it
 * into the mirror row a card draws. The photographs and documents ride in the
 * same event under a versioned `media` block, and a SEPARATE sweep converges
 * them — the ranking converger's shape — so the property keeps working
 * whatever happens to its media.
 *
 * These run the REAL migrations, main sweep included, against a throwaway
 * Postgres. What they assert is the state the tables are left in, because
 * "replay makes no duplicates" and "a removed photo disappears" are claims
 * about rows, not about SQL text.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  postgresAvailable, startThrowawayPostgres, type ThrowawayPostgres,
} from './support/throwawayPostgres';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS = join(REPO_ROOT, 'supabase', 'migrations');
export const MEDIA_MIGRATION = '20261221090000_a_property_brings_its_photographs_and_documents.sql';

/** Every migration the network's tables and sweeps are built by, in order. */
function networkMigrations(): string[] {
  const all = readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort();
  const network = [
    '20261121000000_builder_network_mirror.sql',
    '20261122000000_builder_network_phase5_inbound_fk_release.sql',
    '20261123000000_builder_network_stock_mirror.sql',
    '20261124000000_builder_portal_decommission.sql',
    '20261124010000_builder_network_stock_selection_producer.sql',
    '20261201090000_builder_network_stock_consumer_and_agency_disclosure.sql',
    '20261201100000_agency_contact_name_falls_back_to_username.sql',
    '20261202090000_builder_marketplace_ranking.sql',
    '20261211000000_a_builder_route_installs_itself.sql',
    MEDIA_MIGRATION,
    '20261221100000_a_media_diagnostic_never_breaks_the_sweep.sql',
  ];
  for (const file of network) {
    if (!all.includes(file)) throw new Error(`missing migration ${file}`);
  }
  return network;
}

const runs = postgresAvailable();
const NETWORK_URL = 'https://network.example/functions/v1/builder-network-inbound';
const imageUrl = (id: string) =>
  `https://network.example/functions/v1/builder-network-stock-image?id=${id}`;

let db: ThrowawayPostgres;

describe.skipIf(!runs)('the media converger', () => {
  beforeAll(() => {
    db = startThrowawayPostgres();
    db.file(join(__dirname, 'support', 'builderNetworkStandins.sql'));
    for (const file of networkMigrations()) db.file(join(MIGRATIONS, file));
  }, 120_000);
  afterAll(() => db?.stop());

  // ------------------------------------------------------------------------
  // The world: a builder, its authorised connection, and the events it sends.
  // ------------------------------------------------------------------------
  let version = 0;
  const nextVersion = () => { version += 1; return version; };

  function connectionFor(organisationId: string, state = 'active'): string {
    return db.sql(`
      INSERT INTO public.builder_network_connections(
        network_connection_id, state, outbound_hmac_secret, network_inbound_url,
        builder_organisation_id)
      VALUES ('${randomUUID()}', '${state}', 'proof-secret', '${NETWORK_URL}', '${organisationId}')
      RETURNING id`);
  }

  type Photo = { id: string; content_type?: string };
  type Doc = { id: string; kind: string; label: string; url: string };

  function payload(
    itemId: string, organisationId: string,
    media: Record<string, unknown> | 'omit', extra: Record<string, unknown> = {},
  ) {
    const photos = media !== 'omit' && Array.isArray(media.photos) ? media.photos as Photo[] : [];
    const body: Record<string, unknown> = {
      id: itemId,
      organisation_id: organisationId,
      lifecycle_status: 'active',
      availability_status: 'available',
      address_line: '12 Proof Street',
      suburb: 'Testville',
      state: 'VIC',
      postcode: '3000',
      bedrooms: 4,
      organisation: { id: organisationId, legal_name: 'Proof Homes Pty Ltd' },
      ...(photos[0] ? {
        primary_image: {
          id: photos[0].id, source_stage: 'uploaded_document',
          verification_status: 'source_supplied', processing_status: 'ready', position: 0,
        },
      } : {}),
      ...extra,
    };
    // A block that names its own version is sent exactly as written, which is
    // how the malformed and unknown-version cases are expressed.
    if (media && media !== 'omit') {
      body.media = 'schema_version' in media
        ? media
        : { schema_version: 1, photos: [], documents: [], ...media };
    }
    return body;
  }

  function deliver(connectionId: string, body: Record<string, unknown>, sourceVersion = nextVersion()): string {
    const json = JSON.stringify(body).replace(/'/g, "''");
    return db.sql(`
      INSERT INTO public.builder_network_inbound_events(
        connection_id, event_type, dedupe_key, payload, source_version)
      VALUES ('${connectionId}', 'stock.item.upserted', 'proof:${randomUUID()}',
              '${json}'::jsonb, ${sourceVersion})
      RETURNING id`);
  }

  const applyMain = () => db.sql('SELECT * FROM public.builder_network_apply_inbound_events(500)');
  const applyMedia = () => db.sql('SELECT * FROM public.builder_network_apply_stock_media(500)');
  const settle = () => { applyMain(); applyMedia(); };

  const photos = (itemId: string) => db.sql(`
    SELECT upstream_image_id || ':' || position || ':' || external_url
    FROM public.builder_network_stock_item_photos
    WHERE stock_item_id = '${itemId}' ORDER BY position, upstream_image_id`)
    .split('\n').filter(Boolean);
  const photoIds = (itemId: string) => photos(itemId).map((row) => row.split(':')[0]);
  const documents = (itemId: string) => db.sql(`
    SELECT kind || '|' || label || '|' || url
    FROM public.builder_network_stock_item_documents
    WHERE stock_item_id = '${itemId}' ORDER BY position, document_key`)
    .split('\n').filter(Boolean);
  const item = (itemId: string) => db.sql(`
    SELECT organisation_id || '|' || lifecycle_status || '|' || address_line || '|' || bedrooms::int
    FROM public.builder_network_stock_items WHERE id = '${itemId}'`);
  const mediaState = (eventId: string) => db.sql(`
    SELECT (media_applied_at IS NOT NULL) || '|' || coalesce(media_apply_error, '')
    FROM public.builder_network_inbound_events WHERE id = '${eventId}'`);

  const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
  const asPhotos = (list: string[]): Photo[] => list.map((id) => ({ id, content_type: 'image/jpeg' }));

  let org: string;
  let conn: string;
  let itemId: string;
  beforeEach(() => {
    org = randomUUID();
    conn = connectionFor(org);
    itemId = randomUUID();
  });

  // --------------------------------------------------------------------------
  describe('how many photographs', () => {
    it('0 photos: a property with none has none, and still exists', () => {
      const event = deliver(conn, payload(itemId, org, { photos: [] }));
      settle();
      expect(photos(itemId)).toEqual([]);
      expect(item(itemId)).toBe(`${org}|active|12 Proof Street|4`);
      expect(mediaState(event)).toBe('true|');
    });

    it('1 photo: the one photograph, at position 0, served through the network door', () => {
      const [a] = ids(1);
      deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      settle();
      expect(photos(itemId)).toEqual([`${a}:0:${imageUrl(a)}`]);
    });

    it('several photos keep the order the network sent', () => {
      const list = ids(3);
      deliver(conn, payload(itemId, org, { photos: asPhotos(list) }));
      settle();
      expect(photoIds(itemId)).toEqual(list);
      expect(photos(itemId).map((row) => row.split(':')[1])).toEqual(['0', '1', '2']);
    });

    it('12 photos converge; a 13th is a composition error, refused whole and reported', () => {
      const twelve = ids(12);
      deliver(conn, payload(itemId, org, { photos: asPhotos(twelve) }));
      settle();
      expect(photoIds(itemId)).toEqual(twelve);

      const event = deliver(conn, payload(itemId, org, { photos: asPhotos(ids(13)) }));
      settle();
      // The previous, valid set stands; nothing half-applied.
      expect(photoIds(itemId)).toEqual(twelve);
      expect(mediaState(event)).toMatch(/^true\|refused:invalid_media/);
      expect(db.sql(`SELECT count(*) FROM public.portal_operational_events_log
        WHERE name = 'builder_network_media_refused' AND meta->>'event_id' = '${event}'`)).toBe('1');
    });
  });

  // --------------------------------------------------------------------------
  describe('converging to the current state', () => {
    it('an exact replay makes no duplicates', () => {
      const list = ids(3);
      const body = payload(itemId, org, { photos: asPhotos(list) });
      const first = deliver(conn, body, 50);
      settle();
      // The same event swept again, and the same payload delivered again.
      db.sql(`UPDATE public.builder_network_inbound_events SET media_applied_at = NULL WHERE id = '${first}'`);
      applyMedia();
      deliver(conn, body, 50);
      settle();
      expect(photoIds(itemId)).toEqual(list);
      expect(db.sql(`SELECT count(*) FROM public.builder_network_stock_item_photos
        WHERE stock_item_id = '${itemId}'`)).toBe('3');
    });

    it('a new order converges', () => {
      const [a, b, c] = ids(3);
      deliver(conn, payload(itemId, org, { photos: asPhotos([a, b, c]) }));
      settle();
      deliver(conn, payload(itemId, org, { photos: asPhotos([c, a, b]) }));
      settle();
      expect(photoIds(itemId)).toEqual([c, a, b]);
    });

    it('a removed photo disappears', () => {
      const [a, b, c] = ids(3);
      deliver(conn, payload(itemId, org, { photos: asPhotos([a, b, c]) }));
      settle();
      deliver(conn, payload(itemId, org, { photos: asPhotos([a, c]) }));
      settle();
      expect(photoIds(itemId)).toEqual([a, c]);
      deliver(conn, payload(itemId, org, { photos: [] }));
      settle();
      expect(photoIds(itemId)).toEqual([]);
    });

    it('a replaced photo converges', () => {
      const [a, b] = ids(2);
      deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      settle();
      deliver(conn, payload(itemId, org, { photos: asPhotos([b]) }));
      settle();
      expect(photos(itemId)).toEqual([`${b}:0:${imageUrl(b)}`]);
    });

    it('an older event arriving late cannot wind the gallery back', () => {
      const [a, b] = ids(2);
      deliver(conn, payload(itemId, org, { photos: asPhotos([b]) }), 900);
      settle();
      const stale = deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }), 800);
      settle();
      expect(photoIds(itemId)).toEqual([b]);
      expect(mediaState(stale)).toBe('true|superseded');
    });
  });

  // --------------------------------------------------------------------------
  describe('the order things arrive in', () => {
    it('waits for the property: media is not applied before the main sweep has run', () => {
      const [a] = ids(1);
      const event = deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      applyMedia(); // the media sweep ticks first
      expect(mediaState(event)).toBe('false|');
      expect(photoIds(itemId)).toEqual([]);
      applyMain();
      applyMedia();
      expect(photoIds(itemId)).toEqual([a]);
    });

    it('media arriving after the property converges onto it', () => {
      const [a] = ids(1);
      deliver(conn, payload(itemId, org, 'omit'));
      settle();
      expect(item(itemId)).toBe(`${org}|active|12 Proof Street|4`);
      deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      settle();
      expect(photoIds(itemId)).toEqual([a]);
    });
  });

  // --------------------------------------------------------------------------
  describe('whose property it is', () => {
    it('never attaches media to another organisation\'s property', () => {
      // Builder B owns the property.
      const orgB = randomUUID();
      const connB = connectionFor(orgB);
      const [ownPhoto, intruder] = ids(2);
      deliver(connB, payload(itemId, orgB, { photos: asPhotos([ownPhoto]) }));
      settle();

      // Builder A, over its own valid connection, names B's property as its own.
      const event = deliver(conn, payload(itemId, org, { photos: asPhotos([intruder]) }));
      settle();
      expect(photoIds(itemId)).toEqual([ownPhoto]);
      expect(item(itemId).split('|')[0]).toBe(orgB);
      expect(mediaState(event)).toMatch(/^true\|refused:/);
    });

    it('does not apply media for an organisation the connection does not name', () => {
      const other = randomUUID();
      const [a] = ids(1);
      const event = deliver(conn, payload(itemId, other, { photos: asPhotos([a]) }));
      settle();
      // The main sweep halts the relationship; the media sweep does nothing.
      expect(photoIds(itemId)).toEqual([]);
      expect(mediaState(event)).toBe('false|');
    });

    it('does not apply media over a revoked connection', () => {
      const [a, b] = ids(2);
      deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      settle();
      const event = deliver(conn, payload(itemId, org, { photos: asPhotos([b]) }));
      applyMain();
      db.sql(`UPDATE public.builder_network_connections SET state = 'revoked', revoked_at = now() WHERE id = '${conn}'`);
      applyMedia();
      expect(photoIds(itemId)).toEqual([a]);
      expect(mediaState(event)).toMatch(/^true\|refused:connection/);
    });
  });

  // --------------------------------------------------------------------------
  describe('backward compatibility', () => {
    it('an old payload with no media block is valid and changes nothing', () => {
      const [a] = ids(1);
      deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      settle();
      const legacy = deliver(conn, payload(itemId, org, 'omit'));
      settle();
      expect(mediaState(legacy)).toBe('true|no_media');
      expect(photoIds(itemId)).toEqual([a]);
      expect(item(itemId)).toBe(`${org}|active|12 Proof Street|4`);
    });

    it('a media block of a version this sweep does not know is refused, not guessed at', () => {
      const event = deliver(conn, payload(itemId, org, { schema_version: 2, photos: [] }));
      settle();
      expect(mediaState(event)).toBe('true|refused:unsupported_media_version');
    });

    it('the one-photo card is unchanged: the main sweep still writes the primary image', () => {
      const [a] = ids(1);
      deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      settle();
      expect(db.sql(`SELECT primary_image_id FROM public.builder_network_stock_items WHERE id = '${itemId}'`)).toBe(a);
      expect(db.sql(`SELECT id || '|' || external_url FROM public.builder_network_stock_item_images
        WHERE stock_item_id = '${itemId}'`)).toBe(`${a}|${imageUrl(a)}`);
    });
  });

  // --------------------------------------------------------------------------
  describe('documents', () => {
    const brochure: Doc = { id: 'a'.repeat(32), kind: 'brochure', label: 'Brochure', url: 'https://example.com/brochure.pdf' };
    const floor: Doc = { id: 'b'.repeat(32), kind: 'floor_plan', label: 'Floor Plan', url: 'https://example.com/floor.pdf' };

    it('sync independently of photographs, typed and labelled as the builder filed them', () => {
      const [a] = ids(1);
      deliver(conn, payload(itemId, org, { photos: asPhotos([a]), documents: [brochure, floor] }));
      settle();
      expect(documents(itemId)).toEqual([
        'brochure|Brochure|https://example.com/brochure.pdf',
        'floor_plan|Floor Plan|https://example.com/floor.pdf',
      ]);
      // Documents change, photographs do not move.
      deliver(conn, payload(itemId, org, { photos: asPhotos([a]), documents: [floor] }));
      settle();
      expect(documents(itemId)).toEqual(['floor_plan|Floor Plan|https://example.com/floor.pdf']);
      expect(photoIds(itemId)).toEqual([a]);
      // A document is never a photograph.
      expect(db.sql(`SELECT count(*) FROM public.builder_network_stock_item_photos
        WHERE external_url LIKE '%.pdf'`)).toBe('0');
    });

    it('refuses a link a browser would execute', () => {
      const event = deliver(conn, payload(itemId, org, {
        documents: [{ ...brochure, url: 'javascript:alert(1)' }],
      }));
      settle();
      expect(mediaState(event)).toMatch(/^true\|refused:invalid_media/);
      expect(documents(itemId)).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  describe('a media failure never breaks the property', () => {
    it('retries a failing apply a bounded number of times, then dead-letters it; the property stands', () => {
      const [a] = ids(1);
      const event = deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      applyMain();
      db.sql(`
        CREATE FUNCTION pg_temp_fail() RETURNS trigger LANGUAGE plpgsql AS
          $f$ BEGIN RAISE EXCEPTION 'simulated storage failure'; END $f$;
        CREATE TRIGGER fail_photos BEFORE INSERT ON public.builder_network_stock_item_photos
          FOR EACH ROW EXECUTE FUNCTION pg_temp_fail();`);
      try {
        for (let tick = 0; tick < 4; tick += 1) applyMedia();
        expect(db.sql(`SELECT media_apply_attempts || '|' || (media_applied_at IS NULL)
          FROM public.builder_network_inbound_events WHERE id = '${event}'`)).toBe('4|true');
        applyMedia();
        expect(mediaState(event)).toMatch(/^true\|dead:/);
        expect(db.sql(`SELECT count(*) FROM public.portal_operational_events_log
          WHERE name = 'builder_network_media_apply_dead'`)).not.toBe('0');
        // The property, and the card's own primary image, are untouched.
        expect(item(itemId)).toBe(`${org}|active|12 Proof Street|4`);
        expect(db.sql(`SELECT primary_image_id FROM public.builder_network_stock_items WHERE id = '${itemId}'`)).toBe(a);
        expect(db.sql(`SELECT processed_at IS NOT NULL FROM public.builder_network_inbound_events WHERE id = '${event}'`)).toBe('t');
      } finally {
        db.sql(`DROP TRIGGER fail_photos ON public.builder_network_stock_item_photos;
                DROP FUNCTION pg_temp_fail();`);
      }
      // The next event converges cleanly.
      deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      settle();
      expect(photoIds(itemId)).toEqual([a]);
    });

    it('a malformed media block leaves the property and its previous media as they were', () => {
      const [a] = ids(1);
      deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      settle();
      const event = deliver(conn, payload(itemId, org, { schema_version: 1, photos: 'not-a-list' }, {
        address_line: '14 Proof Street',
      }));
      settle();
      expect(mediaState(event)).toMatch(/^true\|refused:invalid_media/);
      expect(photoIds(itemId)).toEqual([a]);
      // The property itself still took the event's figures.
      expect(item(itemId)).toBe(`${org}|active|14 Proof Street|4`);
    });
  });

  // --------------------------------------------------------------------------
  describe('when the diagnostics recorder itself fails', () => {
    /*
     * PRODUCTION'S RECORDER RAISES ON ORDINARY METADATA. Its privacy screen is
     * `$.**.keyvalue()`, which walks into every scalar and `.keyvalue()`
     * refuses anything that is not an object — so any metadata carrying a
     * value makes `record_portal_operational_event` throw. Measured on the
     * first production proof: the refusal was rolled back and retried, and on
     * the fifth attempt the dead-letter path, calling the same recorder inside
     * the handler, would have aborted the whole sweep. The screen below is the
     * production expression verbatim.
     */
    const brokenRecorder = `
      CREATE OR REPLACE FUNCTION public.record_portal_operational_event(
        p_event_name text, p_severity text, p_request_id uuid, p_ref text, p_actor_type text,
        p_a text, p_b text, p_c text, p_d text, p_e text, p_f text, p_success boolean, p_meta jsonb)
      RETURNS void LANGUAGE plpgsql AS $f$
      BEGIN
        IF jsonb_path_exists(COALESCE(p_meta,'{}'), '$.**.keyvalue() ? (@.key like_regex "(?i)^(internal_notes|smr)$")') THEN
          RAISE EXCEPTION 'SENSITIVE_TELEMETRY_FIELD_FORBIDDEN';
        END IF;
        INSERT INTO public.portal_operational_events_log(name, severity, meta) VALUES (p_event_name, p_severity, p_meta);
      END $f$;`;
    const workingRecorder = `
      CREATE OR REPLACE FUNCTION public.record_portal_operational_event(
        p_event_name text, p_severity text, p_request_id uuid, p_ref text, p_actor_type text,
        p_a text, p_b text, p_c text, p_d text, p_e text, p_f text, p_success boolean, p_meta jsonb)
      RETURNS void LANGUAGE sql AS $f$
        INSERT INTO public.portal_operational_events_log(name, severity, meta) VALUES (p_event_name, p_severity, p_meta)
      $f$;`;

    beforeEach(() => { db.sql(brokenRecorder); });
    afterAll(() => { db.sql(workingRecorder); });

    it('reproduces production: the recorder throws on ordinary metadata', () => {
      expect(() => db.sql(`SELECT public.record_portal_operational_event('x', 'warning', gen_random_uuid(),
        'r', 'system', NULL, 'integration_worker', NULL, NULL, NULL, NULL, false, '{"reason":"x"}'::jsonb)`))
        .toThrow(/keyvalue/);
    });

    it('a refusal is still stamped, first time, and not retried', () => {
      const event = deliver(conn, payload(itemId, org, { photos: asPhotos(ids(13)) }));
      settle();
      expect(mediaState(event)).toBe('true|refused:invalid_media');
      expect(db.sql(`SELECT media_apply_attempts FROM public.builder_network_inbound_events WHERE id = '${event}'`)).toBe('0');
    });

    it('a dead letter does not abort the sweep, and the next event still converges', () => {
      const [a] = ids(1);
      const poisoned = deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      applyMain();
      db.sql(`
        CREATE FUNCTION pg_temp_fail2() RETURNS trigger LANGUAGE plpgsql AS
          $f$ BEGIN RAISE EXCEPTION 'simulated storage failure'; END $f$;
        CREATE TRIGGER fail_photos2 BEFORE INSERT ON public.builder_network_stock_item_photos
          FOR EACH ROW EXECUTE FUNCTION pg_temp_fail2();`);
      try {
        for (let tick = 0; tick < 5; tick += 1) applyMedia(); // must never throw
        expect(mediaState(poisoned)).toMatch(/^true\|dead:/);
      } finally {
        db.sql(`DROP TRIGGER fail_photos2 ON public.builder_network_stock_item_photos;
                DROP FUNCTION pg_temp_fail2();`);
      }
      deliver(conn, payload(itemId, org, { photos: asPhotos([a]) }));
      settle();
      expect(photoIds(itemId)).toEqual([a]);
    });
  });

  // --------------------------------------------------------------------------
  describe('the tables are the sweep\'s alone', () => {
    it('grants nothing to a browser role', () => {
      for (const table of [
        'builder_network_stock_item_photos',
        'builder_network_stock_item_documents',
        'builder_network_stock_item_media',
      ]) {
        expect(db.sql(`SELECT has_table_privilege('anon', 'public.${table}', 'SELECT')
          OR has_table_privilege('authenticated', 'public.${table}', 'SELECT')`)).toBe('f');
        expect(db.sql(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${table}'::regclass`)).toBe('t');
      }
      expect(db.sql(`SELECT has_function_privilege('authenticated',
        'public.builder_network_apply_stock_media(integer)', 'EXECUTE')`)).toBe('f');
    });
  });
});
