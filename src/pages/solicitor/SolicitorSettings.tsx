import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Building2, KeyRound, Mail, MapPin, Phone, PlayCircle, ShieldCheck, UserCog,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SolicitorPortalShell } from '@/components/solicitor-portal/SolicitorPortalShell';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { smartCapitalize } from '@/lib/nameUtils';

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
        <Icon className="h-4 w-4 text-primary" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium text-foreground">{value?.trim() || '—'}</p>
      </div>
    </div>
  );
}

/**
 * Solicitor Portal settings — mirrors the Finance Portal settings surface:
 * a read-only profile summary, security controls, and portal help.
 */
export default function SolicitorSettings() {
  const { user } = useSolicitorPortalAuth();
  const navigate = useNavigate();

  const displayName = smartCapitalize(user?.name) || 'Solicitor';
  const states = user?.practising_states ?? [];

  return (
    <SolicitorPortalShell
      title="Settings"
      description="Manage your profile visibility, account security and portal preferences."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCog className="h-4 w-4 text-primary" aria-hidden /> Your profile
            </CardTitle>
            <CardDescription>
              Shown to the referring team on every matter. Contact your practice administrator to change these details.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <DetailRow icon={UserCog} label="Name" value={displayName} />
            <Separator />
            <DetailRow icon={Mail} label="Email" value={user?.email} />
            <Separator />
            <DetailRow icon={Building2} label="Firm" value={user?.firm_name} />
            <Separator />
            <DetailRow icon={Phone} label="Phone" value={user?.phone} />
            <Separator />
            <div className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                <MapPin className="h-4 w-4 text-primary" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Practising states</p>
                {states.length ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {states.map((state) => (
                      <Badge key={state} variant="outline" className="font-medium">{state}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-medium text-foreground">—</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Security
              </CardTitle>
              <CardDescription>
                Matter data may be privileged. Review your signed-in devices regularly and rotate your password if
                anything looks unfamiliar.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 sm:flex-row">
              <Button asChild variant="outline" className="justify-start gap-2 rounded-xl">
                <Link to="/solicitor/settings/security">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Session security
                  <ArrowRight className="ml-auto h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <Button
                variant="outline"
                className="justify-start gap-2 rounded-xl"
                onClick={() => navigate('/solicitor/change-password')}
              >
                <KeyRound className="h-4 w-4" aria-hidden /> Change password
                <ArrowRight className="ml-auto h-4 w-4" aria-hidden />
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PlayCircle className="h-4 w-4 text-primary" aria-hidden /> Portal help
              </CardTitle>
              <CardDescription>Replay the guided tour of the portal at any time.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="gap-2 rounded-xl"
                onClick={() => window.dispatchEvent(new CustomEvent('solicitor:start-tour'))}
              >
                <PlayCircle className="h-4 w-4" aria-hidden /> Replay portal tour
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </SolicitorPortalShell>
  );
}
