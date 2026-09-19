/**
 * Command Centre — Agreement Templates.
 *
 * This route (`/partner-agreements`) used to be the Agreement Centre register:
 * a lifecycle workspace where staff drafted an agreement, ran it through
 * internal review, issued it into a partner's portal, answered their change
 * requests and counter-signed it.
 *
 * That workflow has been retired. The route is KEPT rather than removed so the
 * bookmarks and in-app links that point here land on the thing people actually
 * still need, instead of a 404 that reads as a fault.
 *
 * What is left is a download desk. See `templateResource.pure.ts`.
 *
 * ## Why this page carries a Back control when most do not
 *
 * It is `paletteOnly` in the navigation registry — there is no sidebar entry
 * for it. Every way in is a one-way door: the ⌘K palette, the Finance Partners
 * admin page, one of the four retired routes redirecting here, or a bookmark.
 * Without a Back control the only way out is the browser's own button, and on
 * a redirected arrival even that lands somewhere unhelpful. `pageBack.ts`
 * explains what this one does instead.
 */
import { useEffect } from 'react';
import { ArrowLeft, FileSignature } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import AgreementTemplateResources from '@/components/agreement-templates/AgreementTemplateResources';
import { downloadAgreementTemplateDocx } from '@/lib/agreements/templateDownloads';
import { backLabel, navigateBack, resolveBackTarget } from '@/lib/navigation/pageBack';

/**
 * Where Back goes when there is no app history to step into.
 *
 * The Overview, rather than the Finance Partners admin page that links here:
 * this route is gated on the `agreements` module and that one on admin rights,
 * so the named destination has to be one that everybody who can reach this
 * page can also reach.
 */
const FALLBACK_PATH = '/dashboard';
const FALLBACK_LABEL = 'Dashboard';

export default function AgreementTemplates() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Agreement Templates | Command Centre';
  }, []);

  // Resolved once per render rather than inside the handler, so the label and
  // the click cannot disagree about which of the two things is going to happen.
  const backTarget = resolveBackTarget();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        onClick={() => navigateBack(navigate, FALLBACK_PATH)}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {backLabel(backTarget, FALLBACK_LABEL)}
      </Button>

      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <FileSignature className="h-6 w-6 text-primary" />
          Agreement Templates
        </h1>
      </header>

      {/* No brand is applied. The supplied cover is built around a
          `<<COMPANY NAME>>` placeholder, and both portals hand over the same
          bytes — see `templateDownloads.ts`. */}
      <AgreementTemplateResources onDownloadDocx={downloadAgreementTemplateDocx} />
    </div>
  );
}
