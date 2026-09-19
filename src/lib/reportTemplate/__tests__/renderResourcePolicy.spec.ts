/**
 * The render boundary, judged where the renderer actually fetches.
 *
 * ## Why this file exists beside the Deno one
 *
 * `supabase/functions/render-template-pdf/resource-policy.test.ts` covers the
 * same module and is the one CI runs under Deno. This is its mirror in the
 * suite everyone actually runs, and it carries the cases that come from
 * *documents* rather than from attack strings — because the defect this file
 * was written for was not an attack that got through, it was two thirds of the
 * report catalogue being refused for its prose.
 *
 * Every attack case below is duplicated from the Deno suite on purpose. This
 * is a security boundary; a narrowing must be shown not to have opened
 * anything, in the suite that runs on every commit.
 */
import { describe, expect, it } from 'vitest';
import {
  assertSafeRenderResources,
  findForbiddenRenderResource,
  isAdmissibleRenderResource,
} from '../../../../supabase/functions/_shared/renderResourcePolicy.pure';

const PROJECT = 'https://project.supabase.co';
const refuses = (html: string) => expect(() => assertSafeRenderResources(html, PROJECT)).toThrow();
const admits = (html: string) => expect(() => assertSafeRenderResources(html, PROJECT)).not.toThrow();

describe('what the renderer may fetch', () => {
  it('admits an embedded payload and this project’s own storage', () => {
    admits('<img src="data:image/png;base64,AA==">');
    admits('<img src="https://project.supabase.co/storage/v1/object/sign/private/a.png?token=x&amp;y=1">');
  });

  it('refuses metadata, private ranges, arbitrary hosts and non-http schemes', () => {
    for (const src of [
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/image.png',
      'https://attacker.example/image.png',
      '//attacker.example/image.png',
      'file:///etc/passwd',
      'https://project.supabase.co/rest/v1/private_table',
    ]) {
      refuses(`<img src="${src}">`);
    }
  });

  it('refuses a fetchable reference in any attribute, not a list of known ones', () => {
    // `data-*` is fetched by nothing. It is judged anyway: guessing the fetch
    // list narrowly is how this boundary would be reopened, and the cost of
    // guessing widely is a loud refusal.
    refuses('<img data-xmlns="https://attacker.example/a.png">');
    refuses('<div poster="https://attacker.example/a.png"></div>');
    refuses('<img srcset="https://attacker.example/a.png 2x">');
    refuses('<img src=https://attacker.example/a.png>');
  });

  it('refuses a stylesheet body and an inline style that fetch', () => {
    refuses('<style>@import url("https://fonts.googleapis.com/css2?family=Lato");</style>');
    refuses('<style>.x{background:url(https://cdn.example.com/bg.png)}</style>');
    refuses('<div style="background:url(https://cdn.example.com/bg.png)"></div>');
  });

  it('refuses an entity-obfuscated network URL', () => {
    refuses('<img src="&#x68;ttp&colon;&sol;&sol;169.254.169.254/latest/meta-data/">');
  });

  it('permits XML namespace declarations, and nothing beside them', () => {
    admits('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    admits(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"></svg>`);
    admits("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    refuses('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://attacker.example/a.png"/></svg>');
    refuses('<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="http://169.254.169.254/latest/meta-data/"/></svg>');
  });

  it('ignores a base64 payload but reads a percent-encoded data URI', () => {
    admits('<img src="data:image/png;base64,AAAA//n1DaHZA6vzhqh0YG==">');
    admits('<div style="background:url(data:image/png;base64,QQ//BB=)"></div>');
    refuses(`<img src="data:image/svg+xml,%3Csvg%3E%3Cimage href='http://169.254.169.254/x'/%3E%3C/svg%3E">`);
    refuses('<img src="data:image/png;base64,QQ//BB="><img src="https://attacker.example/a.png">');
  });
});

describe('what the renderer only draws', () => {
  it('admits a report whose prose cites a website', () => {
    // The defect. 808 of 1,182 investment reports carry a URL in their content,
    // so this refused two thirds of the catalogue — and refused it invisibly,
    // because the caller fell back to its legacy generator and a document still
    // arrived.
    admits('<p>Council planning data is published at https://www.planning.nsw.gov.au/ '
      + 'and was checked on 14 August.</p>');
    admits('<p>Contact admin@npcservices.com.au or visit http://npcservices.com.au</p>');
    admits('<td>Source: https://www.abs.gov.au/statistics</td>');
  });

  it('admits a hyperlink, which is an annotation rather than a request', () => {
    // The renderer emits one for every link overlay and every contents row.
    admits('<a href="https://npcservices.com.au/disclosure">Read the disclosure</a>');
    admits('<a href="#anc-summary">Summary</a>');
  });

  it('still refuses a fetch smuggled into an anchor’s other attributes', () => {
    refuses('<a href="https://ok.example/x" style="background:url(https://attacker.example/a.png)">x</a>');
    refuses('<a href="https://ok.example/x" data-src="https://attacker.example/a.png">x</a>');
  });

  it('reports without throwing, for a caller that would rather say than fail', () => {
    expect(findForbiddenRenderResource('<p>see https://example.com</p>', PROJECT)).toBeNull();
    expect(findForbiddenRenderResource('<img src="https://attacker.example/a.png">', PROJECT))
      .toMatchObject({ reason: 'off_origin' });
  });
});

describe('the client-side half of the same rule', () => {
  it('agrees with the boundary about every kind of reference', () => {
    expect(isAdmissibleRenderResource('data:image/png;base64,AA==', PROJECT)).toBe(true);
    expect(isAdmissibleRenderResource(
      'https://project.supabase.co/storage/v1/object/sign/a/b.png?token=x', PROJECT)).toBe(true);
    expect(isAdmissibleRenderResource('https://images.unsplash.com/photo-1', PROJECT)).toBe(false);
    expect(isAdmissibleRenderResource('//attacker.example/a.png', PROJECT)).toBe(false);
    expect(isAdmissibleRenderResource('https://project.supabase.co/rest/v1/x', PROJECT)).toBe(false);
    // Nothing to normalise: empty, and document-relative.
    expect(isAdmissibleRenderResource('', PROJECT)).toBe(true);
    expect(isAdmissibleRenderResource('#anchor', PROJECT)).toBe(true);
  });
});
