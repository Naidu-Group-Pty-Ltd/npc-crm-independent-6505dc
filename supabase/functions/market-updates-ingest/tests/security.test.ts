import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { boundedFetch, safeSourceExcerpt } from "../adapters/security.ts";

Deno.test("boundedFetch rejects a private initial target before fetching", async () => {
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetches++;
    return Promise.resolve(new Response("internal"));
  };
  try {
    await assertRejects(
      () => boundedFetch("http://127.0.0.1/metadata", ["127.0.0.1"]),
      Error,
      "Private network targets are forbidden",
    );
    assertEquals(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("boundedFetch rejects an IPv4-mapped loopback IPv6 target", async () => {
  await assertRejects(
    () => boundedFetch("http://[::ffff:127.0.0.1]/metadata", ["::ffff:7f00:1"]),
    Error,
    "Private network targets are forbidden",
  );
});

Deno.test("boundedFetch rejects reserved IPv6 documentation targets", async () => {
  await assertRejects(() => boundedFetch('http://[2001:db8::1]/',['2001:db8::1']),Error,'Private network targets are forbidden');
});

Deno.test("boundedFetch rejects reserved and metadata-network IPv4 targets", async () => {
  for (const address of ['100.64.0.1','169.254.169.254','192.0.2.1','198.51.100.10','203.0.113.5','224.0.0.1']) {
    await assertRejects(() => boundedFetch(`http://${address}/`,[address]),Error,'Private network targets are forbidden');
  }
});

Deno.test("source excerpts are transformative-storage bounded and honour link-only mode", () => {
  assertEquals(safeSourceExcerpt({copyright_mode:'link_and_metadata_only_unless_licensed'},'<p>Do not store me</p>'),null);
  const excerpt=safeSourceExcerpt({copyright_mode:'rss_excerpt_and_transformative_summary'},`<p>${'word '.repeat(500)}</p>`);
  assertEquals((excerpt?.length ?? 0) <= 700,true);
  assertEquals(excerpt?.includes('<p>'),false);
});

Deno.test("boundedFetch validates a redirect before following it", async () => {
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    fetches++;
    assertEquals(init?.redirect, "manual");
    return Promise.resolve(new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/metadata" },
    }));
  };
  try {
    await assertRejects(
      () => boundedFetch("https://93.184.216.34/feed", ["93.184.216.34", "127.0.0.1"]),
      Error,
      "Private network targets are forbidden",
    );
    assertEquals(fetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
