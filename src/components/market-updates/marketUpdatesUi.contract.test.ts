import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const read = (path:string) => readFileSync(path,'utf8');
const page = read('src/pages/MarketUpdates.tsx');
const archive = read('src/components/market-updates/MarketArchivePage.tsx');
const sources = read('src/components/market-updates/MarketSourcesAdminDialog.tsx');
const coverage = read('src/components/market-updates/MarketSourceCoveragePanel.tsx');
const desktopNavigation = read('src/components/layout/DashboardSidebar.tsx');
const mobileNavigation = read('src/components/layout/MobileSidebar.tsx');
const commandPalette = read('src/components/layout/GlobalCommandPalette.tsx');
const navigationRegistry = read('src/lib/navigation/registry.ts');
const breadcrumbs = read('src/components/aurixa/BreadcrumbRail.tsx');
const routes = read('src/App.tsx');

describe('Market Updates Phase 4 UI contract',()=>{
  it('uses the Market News Feed display name while retaining the compatible route and permission key',()=>{
    expect(page).toContain('>Market News Feed</h1>');
    // All navigation surfaces render the shared registry entry, which is
    // entitlement-gated (Scale or the market-updates add-on) — no surface
    // keeps a private copy, and none marks it always-visible.
    expect(navigationRegistry).toContain("title: 'Market News Feed', url: '/market-updates'");
    expect(navigationRegistry).toContain("moduleKey: 'market_updates'");
    expect(desktopNavigation).toContain('useNavigationVisibility');
    expect(mobileNavigation).toContain('useNavigationVisibility');
    expect(commandPalette).toContain('useNavigationVisibility');
    expect(breadcrumbs).toContain("'market-updates': 'Market News Feed'");
    // The route keeps its path but is entitlement-guarded.
    expect(routes).toContain('<Route path="market-updates" element={<ModuleGuard moduleKey="market_updates"><MarketUpdates /></ModuleGuard>} />');
    expect(page).toContain("useModulePermissions('market_updates')");
  });

  /*
   * One feed, one scope — not two scopes the reader switches between.
   *
   * This asserted `setFeedScope`, a Published/Held toggle that the page no
   * longer has and deliberately so: anything the classifier holds is merged
   * into the published feed on load and promoted server-side through the
   * audited publish path (`reconcileHeldIntoFeed`), so the reader never waits
   * behind a second tab and the database ends up matching what was shown. The
   * assertion outlived the design it described. `toContain('Held')` was
   * passing on identifier names and comment prose either way, which is why it
   * never caught the drift.
   *
   * What the retired candidate-review modal must not come back as is still
   * pinned below.
   */
  it('promotes held items into the single published feed rather than a second scope or a candidate review modal',()=>{
    expect(page).toContain('const [heldUpdates, setHeldUpdates] = useState<MarketUpdate[]>([])');
    expect(page).toContain('reconcileHeldIntoFeed');
    expect(page).toContain('<Badge variant="secondary" className="rounded-full">Published');
    expect(page).not.toContain('setFeedScope');
    expect(page).not.toContain('max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl');
    expect(page).not.toContain('reviewCandidates');
  });

  it('keeps Clear All in the filter container and preserves unrelated state',()=>{
    expect(page).toContain('Clear All');
    expect(page).toContain('disabled={!hasClearableFilters}');
    expect(page).toContain("clearMarketUpdateArticleFilters()");
    expect(page).not.toMatch(/const clearFilters = \(\) => \{[^}]*setActiveSegment/s);
    expect(page).not.toMatch(/const clearFilters = \(\) => \{[^}]*setActiveFreshness/s);
  });

  it('uses a deep-linkable archive page, fixed Sonner toast Undo, and permission-gated mutations',()=>{
    expect(page).toContain('archiveMarketUpdate(update.id)');
    expect(page).toContain('restoreMarketUpdate(updateId)');
    expect(page).toContain("action:{label:'Undo'");
    expect(page).toContain('canEditMarketUpdates && <Button');
    expect(archive).toContain('fetchMarketUpdateArchive');
    expect(page).toContain("navigate('/market-updates/archived')");
    expect(routes).toContain('<Route path="market-updates/archived" element={<ModuleGuard moduleKey="market_updates"><MarketArchivePage /></ModuleGuard>} />');
    expect(archive).toContain('Articles archived from the Market News Feed will appear here.');
    expect(archive).toContain('Clear All');
    expect(archive).toContain('Recently archived');
    expect(archive).toContain('aria-label={`Restore ${item.title}`}');
    expect(page).toContain('event.stopPropagation()');
    expect(page).toContain('archivePendingRef.current.has(update.id)');
    expect(archive).toContain('restoringRef.current.has(item.id)');
    expect(archive).toContain('disabled={restoring||!item.id}');
    expect(archive).not.toContain('disabled={Boolean(restoringId)}');
  });

  it('keeps archive actions independent of page-data warnings',()=>{
    expect(page).toContain('const operationalIssue = actionIssue ?? dataIssue ?? digestIssue');
    expect(page).toContain('disabled={archivePendingIds.has(update.id)||!update.id}');
    expect(page).not.toMatch(/disabled=\{[^}]*operationalIssue/);
  });

  it('does not render numerical intelligence confidence on Market Updates surfaces',()=>{
    expect(page).not.toContain('ConfidenceBar');
    expect(page).not.toContain('% conf');
    expect(page).not.toContain('AI confidence');
    expect(archive).not.toContain('confidence_score');
  });

  it('expands source administration and provides a wide wrapping geography area',()=>{
    expect(sources).toContain('max-w-7xl');
    expect(sources).toContain('aria-label="Market source registry"');
    expect(sources).toContain('Geography');
    expect(sources).toContain('whitespace-normal break-words');
    expect(coverage).toContain('min-h-[28rem] max-h-[70dvh]');
    expect(coverage).toContain('aria-label="Expanded source coverage"');
  });
});
