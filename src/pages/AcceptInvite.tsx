import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Database, AlertCircle, CheckCircle, Shield } from 'lucide-react';
import { BrandLogo } from '@/components/branding/BrandAssets';

interface InviteData {
  email: string;
  username: string | null;
  invite_type: 'magic_link' | 'temp_password';
  permissions: Array<{ module_key: string; can_view: boolean; can_edit: boolean; can_delete: boolean }>;
  invited_by: string;
}

export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { settings } = useWhiteLabel();

  const [invite, setInvite] = useState<InviteData | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (token) {
      verifyInvite();
    } else {
      setError('Invalid invite link');
      setIsLoading(false);
    }
  }, [token]);

  const verifyInvite = async () => {
    try {
      const { data, error } = await invokeSecureFunction('admin-user-management', {
        action: 'verify_invite', token
      });

      if (error || !data?.success) {
        setError(data?.error || 'Invalid or expired invite');
      } else {
        setInvite(data.invite);
      }
    } catch (err) {
      setError('Failed to verify invite');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (invite?.invite_type === 'magic_link') {
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await invokeSecureFunction('admin-user-management', {
        action: 'accept_invite', 
        token,
        password: invite?.invite_type === 'magic_link' ? password : undefined
      });

      if (error || !data?.success) {
        setError(data?.error || 'Failed to create account');
      } else {
        // Clear any existing session before redirecting to login
        localStorage.removeItem('session_token');
        
        setSuccess(`Account created successfully! Your username is: ${data.username}`);
        setTimeout(() => {
          navigate('/auth');
        }, 3000);
      }
    } catch (err) {
      setError('Failed to create account');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          {settings.authLogo ? (
            <BrandLogo slot="auth" className="mx-auto h-20 max-w-[280px] object-contain animate-pulse" fallbackClassName="mx-auto h-16 w-16" />
          ) : (
            <Database className="h-16 w-16 text-primary mx-auto animate-pulse" />
          )}
          <p className="text-muted-foreground">Verifying invite...</p>
        </div>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <AlertCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
            <CardTitle>Invalid Invite</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/auth')} className="w-full">
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle className="h-16 w-16 text-success mx-auto mb-4" />
            <CardTitle>Account Created!</CardTitle>
            <CardDescription>{success}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-muted-foreground mb-4">
              Redirecting to login...
            </p>
            <Button onClick={() => navigate('/auth')} className="w-full">
              Go to Login Now
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="flex justify-center mb-4">
            {settings.authLogo ? (
              <BrandLogo slot="auth" className="h-20 max-w-[280px] object-contain" fallbackClassName="h-16 w-16" />
            ) : (
              <Database className="h-16 w-16 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl">Accept Invitation</CardTitle>
          <CardDescription>
            You've been invited by <strong>{invite?.invited_by}</strong> to join {settings.companyName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={invite?.email || ''} disabled />
            </div>

            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={invite?.username || invite?.email?.split('@')[0] || ''} disabled />
            </div>

            {invite?.invite_type === 'magic_link' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="password">Create Password</Label>
                  <PasswordInput
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <PasswordInput
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    required
                    disabled={isSubmitting}
                  />
                </div>
              </>
            )}

            {invite?.invite_type === 'temp_password' && (
              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  You'll use the temporary password sent to your email. You can change it after logging in.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Your Access</Label>
              <div className="flex flex-wrap gap-1">
                {invite?.permissions.slice(0, 5).map((p) => (
                  <Badge key={p.module_key} variant="secondary" className="text-xs">
                    {p.module_key.replace('_', ' ')}
                  </Badge>
                ))}
                {(invite?.permissions.length || 0) > 5 && (
                  <Badge variant="outline" className="text-xs">
                    +{(invite?.permissions.length || 0) - 5} more
                  </Badge>
                )}
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating Account...' : 'Accept & Create Account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}