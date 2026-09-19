-- Build the temp set of REAL Lead-Pipeline opp IDs we know exist (147 real opps, only 144 of which are mapped — but we filter by what's IN the pipeline)
CREATE TEMP TABLE _real_lead_opps (id text PRIMARY KEY);
INSERT INTO _real_lead_opps (id) VALUES
('CQES8sHdly2AWMa8mlhG'),('5wTfe6UfbuvIbLfS2oke'),('dj8I315TkNb1uOZ2tZeQ'),('LSXuC08F7E4bLOAgzObr'),('q5JtYNgqwCoR0opXv5R7'),('ouMU9ebl5gSSURQbsmWG'),('BUHmUgi6WR0TitYfs3yp'),('rgUbTDbbLp0mI3V3Zlgn'),('xwgBABIDGGJXPK32fsfh'),('MnpOtPVK5klRSFGEpAdf'),('nWUkPDVmcjHfxN4D1aFF'),('FK2uScVvXDVdh8dqPoqS'),('tzAdd3qnkYbmxikrZ3PA'),('mjPgaeRyhDWHdodHuLws'),('mKVoJh2Lg8QThgU3wEVz'),('D72JT2rc1xv2tWyVTWkT'),('ifd8dfYQUD5AFXJkIhes'),('g1j9oScI4Rl1y37Ce1fu'),('5M7MNZZpEzKAmlOqoi5X'),('1th6Vw9nfm6zciMKLYkG'),('BLTmTwnC4jWnI5lL0FpJ'),('yrzvXEWX9Uoc30wlw2YC'),('0NqEetv6hBIATsDikxYE'),('UaVHNix8qToe5Hs97Cmd'),('UfmDOb78epX1ppKGMqJX'),('LCxjPbG5b1tfn68Bfkj3'),('DgOG5DfD6WNDqXXuuphO'),('mfCLYaIHrEkctuUOEQGP'),('EjIpDHMDYTyyh0yaa8If'),('pU3zPLdJCW66N6Oui4GD'),('rqSBw1YxJuGsfgZDJjRA'),('mrqo788PbYs8Dfea8vUY'),('eH0WUjdx0OG538jR6L7J'),('GaIO1pU2WjF1ka8Dn9ke'),('QawlB8AdMHtlbcACuRk6'),('DqZv7HNhoDhyRfUrMgCQ'),('yBSVzs91lkksiz18wcCM'),('dQs5xgH1U9haTtfglZHB'),('Whi2HcelZRbCdBVltF2m'),('NRkuJJvOcWNfhgKo5nk8'),('2ocn7f3cYBXQlNPgQsZj'),('VemD2a9JJUKRbsxm3sh0'),('HnbOYpCbcFE7IH7WBlbL'),('JJuMkj4KoCmKuuclVJwg'),('2U7Ew29zmJmzYm8PzMu8'),('z44iISgPSDaHsNNzt3ly'),('C2Mrpuqy03i6E2qA6Avd'),('eJyez6oMkqUhXZy0e99C'),('DzcccLdvZMhCg3mKCD6N'),('YLeFpfRZ6Q4TX5SqtUSF'),('3JazUuhPGCey5swbBUsw'),('5FDUsbWwZdK3naQdcWvY'),('pNONJshgutdbHoLXLPQ7'),('STLGbBQ1PPh8iXiLteIX'),('QWPaKzgVeue33dEN0dyq'),('EVLtH1chSaR8l9CKoIfB'),('cFrWkHn9T1yxRZr0GwuV'),('v92fqmazd6z2e8ASZbYG'),('xxM0b3jJwaxGzzvXaYNe'),('j8U4fFnSyNpxk2950qI7'),('18xWzEg3l7QedVyspMDG'),('5kwLlDAw35VmNJTX3OJp'),('VdZn4IZGfzSwd6dj7cst'),('npiGnlRsIdmdKhK1ZoL0'),('GowP0JCk4GjmA3LqFjPD'),('Aed1Io2UjsOG9h5QIKk4'),('hzO1aBPkfEpoCaFB9jAJ'),('Bixwaf9QV1SNf2p0MhLL'),('rqL1xH3Y1fXpqmqdIj9g'),('jI8WGIzpUcCYCvcWMFfQ'),('iaApO92CXIX4q1CxIrko'),('eOJdJn6AlUgLHsyyA0CE'),('3R14Y7oPw4rJfOxRVDjR'),('cufFc6l4ZGVe0Jgij2Wz'),('MwdMFBxzwjr4lIEXYobV'),('dd87F4nWQcNJFf9bHc13'),('eXbSZhQxVntNJAcjKqaj'),('H1CLYngDG4YbKqh8m8q1'),('hibYF8uKnaAkFWla5Nx5'),('5LJKaqwkmLeh3gctJqkI'),('fuhLKz880T5Rvj2RbX1b'),('iOHrdYq1GA06BZ2TDYfd'),('COclidYwiQgbp6uGrQVu'),('r6fe1xDHZLhc5Jhm566g'),('PHGrxxaukUGKHAE6pVni'),('MILPpANQT1yb1v2m0hnW'),('e6rWd9FYDbHoKnH8zRak'),('G47lRtqRhnYVZJ0cy095'),('DacGZVClJYBKX8kJszJY'),('FAQFFG21zQh0jKbEn7Lq'),('8dfWEWIOnshLLA6YnRJ1'),('pmLizpCc1Lw7EatkIJak'),('nCekOaGHTTzCCpAMDeZN'),('BuL9SmPjk2gtQtr6ynxd'),('KvcBO3WS57oB1wvFNKfE'),('UsfOdCVLQ5U2dTrqSvsC'),('TIrvO52qHAqEQWGcKrez'),('7nVUEGLe3SahgjhPrc5w'),('wvaQi6QfRwgLH66H9666'),('3Co1ynLNHAYg3oNSKdEW'),('ZEQJa04ZUNQdvZ0U1qHw'),('G0vbclALu45fceUeJT5B'),('UWfGGvOGmgMcvEuXYVfk'),('KeuVpwIiSMg1j2xaokGl'),('GElt96fO8gyP0pJjkzlC'),('GIzW22CsxzJDMMu0vDHa'),('Ipe33ANSuzshc5tgWy4Z'),('GOEVgujjXkhWajX6lXjZ'),('8024oPEECCTAC6UM8kno'),('rWrRDBA0KfwprNPjYPZQ'),('orcIeZfaKPTbo8yzayYg'),('hhiJkmvpMGZEQBOi5n2p'),('jxEkMig2YXScrAItgZql'),('tRlVRstjN2VWK5Af3TtL'),('HX6YxSSLz25It0oFSXRV'),('7F4ylzb3UGmeiQayWdiH'),('3w7ueHTSmBtIiahmql0t'),('WcMErbqS8EwVlFqYjHPI'),('vZ4uR8zLY6675bjkQvNk'),('vDWGJnQJpp1T8waGDKNj'),('ZQ6uQyn07jAr7yJRL7mJ'),('WbKFFBgJkevjeGlZwMaM'),('6WdVCfp0tMBiIdr3Zwof'),('3VoLd5MYydto4gOtfspk'),('dxath54kGfWBsFJt8lLF'),('91Ut2rWT3mNDk3Jsn96d'),('Uhb4JU8LlrBkkvUF6KNw'),('2qkuFiLAFCbHcmm8SUNG'),('bP7S6s8f08cNQ0A57Y7X'),('wNQ4HxRn5M4SYzDalnj0'),('QsJcZC12ex8WEmzi3PjP'),('dBZzzoeIDjXp8b9AGHDc'),('Jy6L9PkdiEXRX9vXw3NX'),('3T73kLNEKajO7Qzc1MFN'),('5dCldf8mqmO1TLqppywt'),('dyyoEwGRDdhPQyHC0iIQ'),('CWyJgH6tGBICnczSTWgZ'),('miyZlFg0Pqv0zTdBogqS'),('cjTNtAfUuEsHNZva1EjQ'),('5xDEV1vhFGmvdyT4XjOv'),('2aQOxmaoBBJc47lZ4Chl'),('RZfkEZQuANN8rcnW98Tv'),('3tNed0zEAQcbAY3dLfhT'),('d9ZlWGZZOVWON20WGeUi'),('gmkZ1y44U3BWbrKMRjw2'),('HG6AiTvJA0lkIVfUwAil'),('658rydUP4q3aUwukFzwR');

-- Capture the source_ids that are about to lose their phantom mapping
CREATE TEMP TABLE _phantom_sources AS
SELECT DISTINCT m.old_ghl_id AS source_id
FROM ghl_id_mapping m
WHERE m.resource_type = 'opportunity'
  AND m.new_ghl_id NOT IN (SELECT id FROM _real_lead_opps);

-- Delete the phantom mappings
DELETE FROM ghl_id_mapping
WHERE resource_type = 'opportunity'
  AND new_ghl_id NOT IN (SELECT id FROM _real_lead_opps);

-- Delete the corresponding migration_job_items so the worker re-attempts
DELETE FROM migration_job_items
WHERE source_id IN (SELECT source_id FROM _phantom_sources)
  AND job_id IN (SELECT id FROM migration_jobs WHERE domain = 'opportunities');

-- Report
DO $$
DECLARE
  remaining_mappings int;
  cleared_sources int;
BEGIN
  SELECT COUNT(*) INTO remaining_mappings FROM ghl_id_mapping WHERE resource_type='opportunity';
  SELECT COUNT(*) INTO cleared_sources FROM _phantom_sources;
  RAISE NOTICE 'Phantom mapping cleanup complete: cleared % source opps; % real mappings remain', cleared_sources, remaining_mappings;
END $$;