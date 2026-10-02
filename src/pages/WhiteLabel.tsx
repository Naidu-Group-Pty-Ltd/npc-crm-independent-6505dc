import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

// Lightweight in-app navigation guard.
// `useBlocker` from react-router-dom requires a data router (createBrowserRouter),
// but this app uses the classic <BrowserRouter>, so we implement a popstate-based
// guard that mirrors the subset of the blocker API we consume below.
type NavigationBlocker = {
  state: 'unblocked' | 'blocked';
  proceed: () => void;
  reset: () => void;
};

function useUnsavedChangesBlocker(when: boolean): NavigationBlocker {
  const [state, setState] = useState<'unblocked' | 'blocked'>('unblocked');
  const pendingUrlRef = useRef<string | null>(null);
  const allowNextPopRef = useRef(false);
  const whenRef = useRef(when);

  useEffect(() => {
    whenRef.current = when;
    if (!when) {
      setState('unblocked');
      pendingUrlRef.current = null;
    }
  }, [when]);

  useEffect(() => {
    if (!when) return;

    // Push a sentinel state so the first back-navigation triggers our handler
    // without actually leaving the page.
    const initialUrl = window.location.href;
    window.history.pushState({ __whiteLabelGuard: true }, '', initialUrl);

    const handlePopState = () => {
      if (allowNextPopRef.current || !whenRef.current) {
        allowNextPopRef.current = false;
        return;
      }
      // Re-pin the guard entry so the user stays on the page until they confirm.
      window.history.pushState({ __whiteLabelGuard: true }, '', initialUrl);
      pendingUrlRef.current = initialUrl;
      setState('blocked');
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [when]);

  const proceed = useCallback(() => {
    allowNextPopRef.current = true;
    setState('unblocked');
    pendingUrlRef.current = null;
    window.history.back();
  }, []);

  const reset = useCallback(() => {
    setState('unblocked');
    pendingUrlRef.current = null;
  }, []);

  return { state, proceed, reset };
}
import {
  assetStatusLabel,
  assetsAreValidating,
  assetsBlockSave,
  statusesOf,
  BRAND_SLOT_ORDER,
  type BrandAssetStatus,
} from '@/branding/brand-asset-validation';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Upload, 
  Image as ImageIcon, 
  Trash2, 
  Loader2, 
  Check,
  AlertCircle,
  Palette,
  Monitor,
  LogIn,
  PanelLeft,
  Globe,
  Minimize2,
  Sun,
  Moon,
  Laptop,
  Mail,
  FileText,
  Save,
  Undo2,
  ShieldAlert,
  Type
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FONT_OPTIONS, FONT_SCALE_OPTIONS, resolveFontStack } from '@/branding/brand-fonts';
import { useWhiteLabel, hexToHsl, hslToHex, ThemeMode, EmailSignatureSettings, WhiteLabelSettings } from '@/contexts/WhiteLabelContext';
import { removeBackground, loadImage, blobToBase64 } from '@/utils/backgroundRemoval';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { secureStorageUpload } from '@/hooks/useSecureStorage';
import { defaultBrandConfig, defaultEmailSignature } from '@/branding/brand-defaults';
import { getBrandAccessibilityChecks, getBrandImpactPreview } from '@/branding/accessibility';
import { getBrandAssetSrc, type BrandAssetSlot } from '@/branding/brand-assets';
import {
  clearPersistedDraft,
  loadPersistedDraft,
  loadStoredBrandPresets,
  savePersistedDraft,
  saveStoredBrandPresets,
  type StoredBrandPreset,
} from '@/branding/brand-draft-storage';
import { BrandPreviewShowcase } from '@/components/branding/BrandPreviewShowcase';
import { BrandAccessibilityPanel } from '@/components/branding/BrandAccessibilityPanel';
import { PageHero } from '@/components/layout/PageHero';

type SurfacePreview = 'auth' | 'sidebar' | 'browser';

/**
 * `empty` and `invalid` are deliberately distinct.
 *
 * An empty slot is a supported, intentional state: the brand resolver falls
 * back down the chain and finally to the platform's own artwork, which is the
 * only way a tenant can return to unbranded defaults. Classifying it as
 * `invalid` — as this once did — made every removal un-saveable, because
 * `hasInvalidAssets` disables the Save button.
 *
 * `invalid` means something stronger and much rarer: a URL *is* configured and
 * the browser cannot load it. That genuinely should block a save.
 */
type AssetValidationState = {
  status: BrandAssetStatus;
  detail: string;
  src: string | null;
  meta?: {
    width: number;
    height: number;
    aspectRatio: number;
    recommendation: string;
    compatibility: 'wide' | 'square' | 'flex';
  };
};

const BRAND_SLOT_LABELS: Record<BrandAssetSlot, string> = {
  auth: 'Auth slot',
  sidebar: 'Sidebar slot',
  'sidebar-icon': 'Sidebar icon slot',
  favicon: 'Browser tab slot',
  report: 'Report slot',
  'report-mono': 'Report slot (dark ground)',
};

/** Copy for a slot with nothing configured anywhere in its fallback chain. */
const EMPTY_SLOT_DETAIL = (slot: BrandAssetSlot) =>
  `No ${BRAND_SLOT_LABELS[slot].toLowerCase()} asset — this surface uses the platform default. Upload one to brand it.`;


function createDefaultDraft() {
  return {
    ...defaultBrandConfig,
    emailSignature: { ...defaultEmailSignature },
  };
}

function getAssetRecommendation(
  slot: BrandAssetSlot,
  width: number,
  height: number
): { recommendation: string; compatibility: 'wide' | 'square' | 'flex' } {
  const aspectRatio = width / Math.max(height, 1);

  if (slot === 'auth' || slot === 'sidebar') {
    return {
      recommendation: aspectRatio >= 2 ? 'Wide lockup fits this slot well.' : 'Use a wider lockup for cleaner horizontal placement.',
      compatibility: aspectRatio >= 2 ? 'wide' : 'flex',
    };
  }

  // A report mark prints at ~13mm on a 300dpi sheet — roughly 150px tall — and
  // is inlined into the render, so both dimensions and file size matter in a way
  // they do not for a screen asset.
  if (slot === 'report' || slot === 'report-mono') {
    const tallEnough = height >= 150;
    return {
      recommendation: tallEnough
        ? 'Resolution is sufficient for print at 300dpi.'
        : 'Upload at least 150px tall — this mark prints at ~13mm and will look soft.',
      compatibility: tallEnough ? 'flex' : 'flex',
    };
  }

  if (slot === 'sidebar-icon' || slot === 'favicon') {
    return {
      recommendation: aspectRatio >= 0.85 && aspectRatio <= 1.15 ? 'Square mark is ideal for this slot.' : 'Use a square brand mark for better balance in this slot.',
      compatibility: aspectRatio >= 0.85 && aspectRatio <= 1.15 ? 'square' : 'flex',
    };
  }

  return {
    recommendation: 'Asset dimensions are acceptable for this surface.',
    compatibility: 'flex' as const,
  };
}

function getResolvedAssetField(settings: typeof defaultBrandConfig, slot: BrandAssetSlot, resolvedSrc: string | null) {
  if (!resolvedSrc) return null;

  const sources: Array<{ key: BrandAssetSlot; value: string | null }> = [
    { key: 'auth', value: settings.authLogo },
    { key: 'sidebar', value: settings.sidebarLogo },
    { key: 'sidebar-icon', value: settings.sidebarIcon },
    { key: 'favicon', value: settings.favicon },
    { key: 'report', value: settings.reportLogo },
    { key: 'report-mono', value: settings.reportMonoLogo },
  ];

  return sources.find((source) => source.value === resolvedSrc)?.key ?? slot;
}

function validateImageAsset(slot: BrandAssetSlot, src: string) {
  return new Promise<AssetValidationState['meta'] | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const { recommendation, compatibility } = getAssetRecommendation(slot, image.naturalWidth, image.naturalHeight);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        aspectRatio: image.naturalWidth / Math.max(image.naturalHeight, 1),
        recommendation,
        compatibility,
      });
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

interface LogoUploadCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  currentLogo: string | null;
  logoType: BrandAssetSlot;
  onUpload: (url: string) => void;
  onRemove: () => void;
}

function LogoUploadCard({ title, description, icon, currentLogo, logoType, onUpload, onRemove }: LogoUploadCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [removeBackgroundEnabled, setRemoveBackgroundEnabled] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const uploadToSupabase = async (file: Blob, fileName: string): Promise<string> => {
    const fileExt = fileName.split('.').pop() || 'png';
    const filePath = `${logoType}/${Date.now()}.${fileExt}`;

    // No `upsert`: the mediated proxy generates a unique destination path for
    // browser callers, and it rejects the flag as an unauthorized replace.
    const uploadResult = await secureStorageUpload('branding-assets', filePath, file, {
      contentType: file.type || 'image/png',
    });

    if (!uploadResult.success) throw new Error(uploadResult.error || 'Upload failed');

    // Get public URL - branding-assets bucket has public read access
    const { data: urlData } = supabase.storage
      .from('branding-assets')
      .getPublicUrl(uploadResult.path || filePath);

    return urlData.publicUrl;
  };


  const processFile = async (file: File) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    setIsProcessing(true);

    try {
      let fileToUpload: Blob = file;
      
      if (removeBackgroundEnabled) {
        toast.info('Processing image...', { description: 'Removing background, this may take a moment' });
        const img = await loadImage(file);
        fileToUpload = await removeBackground(img);
      }

      // Upload to Supabase storage
      const publicUrl = await uploadToSupabase(fileToUpload, file.name);
      onUpload(publicUrl);
      toast.success(removeBackgroundEnabled ? 'Background removed and logo uploaded' : 'Logo uploaded successfully');
      logActivityDirect({
        actionType: 'whitelabel_logo_changed',
        entityType: 'whitelabel_settings',
        entityName: title,
        metadata: { logoType, action: 'upload' }
      });
    } catch (error) {
      console.error('Error processing image:', error);
      // The generic "try a different image" copy hid every real cause —
      // permission denials, expired sessions, size/type rejections — and sent
      // admins hunting for a fault in their artwork. Surface the actual reason.
      const reason = error instanceof Error ? error.message : String(error ?? '');
      const description = removeBackgroundEnabled && !reason
        ? 'Background removal failed. Try uploading without background removal.'
        : reason || 'Please try again with a different image.';
      toast.error('Logo upload failed', { description });
    } finally {

      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  }, [removeBackgroundEnabled]);

  const handleRemove = () => {
    // Deliberately does NOT delete the stored object. Remove only edits the
    // draft: the row still points at this file until "Save brand changes"
    // succeeds, so destroying it here left every branded surface showing a
    // broken image whenever the save was then rejected or discarded. An
    // unreferenced object in the bucket is a far cheaper problem.
    onRemove();
    toast.success('Logo removed from draft', {
      description: 'Save brand changes to apply it.',
    });
    logActivityDirect({
      actionType: 'whitelabel_logo_changed',
      entityType: 'whitelabel_settings',
      entityName: title,
      metadata: { logoType, action: 'remove' }
    });
  };

  return (
    <Card className="group min-w-0 overflow-hidden border-border/70 bg-card/95 shadow-lg shadow-background/5 transition-shadow hover:shadow-xl hover:shadow-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-sm transition-colors group-hover:bg-primary/15">
            {icon}
          </div>
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription className="break-words leading-5">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentLogo ? (
          <div className="space-y-4">
            <div className="relative flex h-36 w-full items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-[linear-gradient(135deg,hsl(var(--muted)/0.55),hsl(var(--background)/0.9))] p-4 shadow-inner">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.10),transparent_38%)]" />
              <img 
                src={currentLogo} 
                alt={`${title} preview`}
                className="relative max-h-full max-w-full object-contain drop-shadow-sm"
              />
              {isProcessing ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 text-muted-foreground backdrop-blur-sm">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-sm font-medium">Processing...</span>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button 
                variant="outline"
                size="sm" 
                className="min-h-10 min-w-0 border-primary/25 bg-primary/5 text-primary shadow-sm transition-all hover:-translate-y-0.5 hover:bg-primary/10 hover:text-primary hover:shadow-md hover:shadow-primary/10 focus-visible:ring-primary/40 disabled:hover:translate-y-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
              >
                <Upload className="h-4 w-4 mr-2" />
                Replace
              </Button>
              <Button 
                variant="outline"
                size="sm" 
                className="min-h-10 min-w-0 border-destructive/30 bg-destructive/5 text-destructive shadow-sm transition-all hover:-translate-y-0.5 hover:bg-destructive/10 hover:text-destructive hover:shadow-md hover:shadow-destructive/10 focus-visible:ring-destructive/40 disabled:hover:translate-y-0"
                onClick={handleRemove}
                disabled={isProcessing}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <div 
            aria-label={`Upload ${title}`}
            data-brand-upload-zone="true"
            className={`dashboard-upload-zone flex h-36 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center shadow-inner transition-all focus-within:ring-2 focus-within:ring-primary/30 ${
              isDragOver 
                ? 'scale-[1.01] border-primary bg-primary/10'
                : 'border-border/70 bg-background/60 hover:border-primary/60 hover:bg-primary/5'
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isProcessing ? (
              <>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
                <span className="text-sm font-medium text-foreground">Processing...</span>
                <span className="text-xs text-muted-foreground">
                  {removeBackgroundEnabled ? 'Removing background and uploading securely' : 'Uploading securely'}
                </span>
              </>
            ) : (
              <>
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors ${
                  isDragOver ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border bg-card text-muted-foreground'
                }`}>
                  <Upload className="h-6 w-6" />
                </div>
                <span className={`text-sm transition-colors ${isDragOver ? 'text-primary font-medium' : 'text-foreground'}`}>
                  {isDragOver ? 'Drop image here' : 'Drag & drop or click to upload'}
                </span>
                <span className="text-xs text-muted-foreground">PNG, JPG, SVG (max 5MB)</span>
              </>
            )}
          </div>
        )}

        {/* Background removal feature temporarily disabled */}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
      </CardContent>
    </Card>
  );
}

interface EmailBannerUploadProps {
  currentBanner: string | null;
  onUpload: (url: string) => void;
  onRemove: () => void;
}

function EmailBannerUpload({ currentBanner, onUpload, onRemove }: EmailBannerUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const uploadToSupabase = async (file: Blob, fileName: string): Promise<string> => {
    const fileExt = fileName.split('.').pop() || 'png';
    const filePath = `email-signature/${Date.now()}.${fileExt}`;
    
    const { data, error } = await supabase.storage
      .from('branding-assets')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from('branding-assets')
      .getPublicUrl(data.path);

    return urlData.publicUrl;
  };

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    setIsProcessing(true);

    try {
      const publicUrl = await uploadToSupabase(file, file.name);
      onUpload(publicUrl);
      toast.success('Banner uploaded successfully');
    } catch (error) {
      console.error('Error uploading banner:', error);
      toast.error('Failed to upload banner');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  }, []);

  const handleRemove = () => {
    // See LogoUploadCard.handleRemove: the stored object is left in place
    // until the row that references it has actually been updated.
    onRemove();
    toast.success('Banner removed from draft', {
      description: 'Save brand changes to apply it.',
    });
  };

  return (
    <div className="min-w-0 space-y-4">
      {currentBanner ? (
        <div className="space-y-4">
          <div className="relative flex h-36 w-full items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-[linear-gradient(135deg,hsl(var(--muted)/0.55),hsl(var(--background)/0.9))] p-4 shadow-inner">
            <img 
              src={currentBanner} 
              alt="Email banner preview"
              className="max-h-full max-w-full object-contain drop-shadow-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              className="min-h-10 min-w-0 border-primary/25 bg-primary/5 text-primary shadow-sm transition-all hover:-translate-y-0.5 hover:bg-primary/10 hover:text-primary hover:shadow-md hover:shadow-primary/10 focus-visible:ring-primary/40 disabled:hover:translate-y-0"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload className="h-4 w-4 mr-2" />
              Replace
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="min-h-10 min-w-0 border-destructive/30 bg-destructive/5 text-destructive shadow-sm transition-all hover:-translate-y-0.5 hover:bg-destructive/10 hover:text-destructive hover:shadow-md hover:shadow-destructive/10 focus-visible:ring-destructive/40 disabled:hover:translate-y-0"
              onClick={handleRemove}
              disabled={isProcessing}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div 
          aria-label="Upload signature banner"
          data-brand-upload-zone="true"
          className={`dashboard-upload-zone flex h-36 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center shadow-inner transition-all focus-within:ring-2 focus-within:ring-primary/30 ${
            isDragOver 
              ? 'scale-[1.01] border-primary bg-primary/10' 
              : 'border-border/70 bg-background/60 hover:border-primary/60 hover:bg-primary/5'
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isProcessing ? (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
              <span className="text-sm font-medium text-foreground">Uploading...</span>
            </>
          ) : (
            <>
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors ${
                isDragOver ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border bg-card text-muted-foreground'
              }`}>
                <Upload className="h-6 w-6" />
              </div>
              <span className={`text-sm transition-colors ${isDragOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                {isDragOver ? 'Drop image here' : 'Drag & drop or click to upload'}
              </span>
              <span className="text-xs text-muted-foreground">PNG, JPG (max 5MB) - Recommended: 600x100px</span>
            </>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}

export default function WhiteLabel() {
  const { settings, updateSettings, isLoading, currentTheme } = useWhiteLabel();
  const { canEdit: canEditWhiteLabel } = useModulePermissions('white_label');
  const [draftSettings, setDraftSettings] = useState(settings);
  const [activeSurfacePreview, setActiveSurfacePreview] = useState<SurfacePreview>('auth');
  const [assetValidation, setAssetValidation] = useState<Record<BrandAssetSlot, AssetValidationState>>({
    auth: { status: 'idle', detail: 'Waiting for validation.', src: null },
    sidebar: { status: 'idle', detail: 'Waiting for validation.', src: null },
    'sidebar-icon': { status: 'idle', detail: 'Waiting for validation.', src: null },
    favicon: { status: 'idle', detail: 'Waiting for validation.', src: null },
    report: { status: 'idle', detail: 'Waiting for validation.', src: null },
    'report-mono': { status: 'idle', detail: 'Waiting for validation.', src: null },
  });
  const [isSavingBrand, setIsSavingBrand] = useState(false);
  const [showLeavePrompt, setShowLeavePrompt] = useState(false);
  const [showResetPrompt, setShowResetPrompt] = useState(false);
  const [showPresetDialog, setShowPresetDialog] = useState(false);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<string | null>(null);
  const [availablePersistedDraft, setAvailablePersistedDraft] = useState<{ settings: WhiteLabelSettings; savedAt: string } | null>(null);
  const [savedPresets, setSavedPresets] = useState<StoredBrandPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const pendingNavigation = useRef<{ proceed: () => void; reset: () => void } | null>(null);
  const draftHistoryRef = useRef<WhiteLabelSettings[]>([]);
  const isApplyingHistoryRef = useRef(false);
  const impactPreview = useMemo(() => getBrandImpactPreview(draftSettings), [draftSettings]);

  // Track the last "known clean" settings so we only overwrite the local draft
  // when the source-of-truth actually changes AND the user has no in-flight
  // edits. Previously this effect ran on every `settings` reference change and
  // unconditionally called `setDraftSettings(settings)`, which could wipe the
  // user's in-progress changes after saving a draft or after any provider
  // re-render — making the editor feel "locked up".
  const lastSyncedSettingsRef = useRef<WhiteLabelSettings | null>(null);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    // First mount: bootstrap draft from live settings + load persisted draft.
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      setSavedPresets(loadStoredBrandPresets());

      const persistedDraft = loadPersistedDraft();
      if (persistedDraft) {
        const matchesLiveSettings =
          JSON.stringify(persistedDraft.settings) === JSON.stringify(settings);
        if (matchesLiveSettings) {
          clearPersistedDraft();
          setAvailablePersistedDraft(null);
        } else {
          setAvailablePersistedDraft(persistedDraft);
        }
      }

      setDraftSettings(settings);
      setLastDraftSavedAt(null);
      draftHistoryRef.current = [];
      lastSyncedSettingsRef.current = settings;
      return;
    }

    // Subsequent settings changes (e.g. after Save brand changes): only pull
    // the fresh values in when the local draft has no unsaved deviations from
    // the previously-synced settings. This prevents color/font/name edits made
    // right after a Save from being overwritten by a stale sync.
    const previousSynced = lastSyncedSettingsRef.current;
    const previousSyncedJson = previousSynced ? JSON.stringify(previousSynced) : null;
    const draftJson = JSON.stringify(draftSettings);
    const settingsJson = JSON.stringify(settings);

    if (settingsJson === previousSyncedJson) return; // nothing new
    lastSyncedSettingsRef.current = settings;

    // If the draft is still in sync with the previously-loaded settings, pull
    // in the new server truth. Otherwise the user has pending edits — keep
    // them and just remember the new baseline for future comparisons.
    if (draftJson === previousSyncedJson) {
      setDraftSettings(settings);
      setLastDraftSavedAt(null);
      draftHistoryRef.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const updateDraftSettings = useCallback((newSettings: Partial<typeof settings>) => {
    setDraftSettings((prev) => {
      if (!isApplyingHistoryRef.current) {
        draftHistoryRef.current = [...draftHistoryRef.current, prev].slice(-50);
      }

      return {
        ...prev,
        ...newSettings,
        emailSignature: {
          ...prev.emailSignature,
          ...(newSettings.emailSignature || {}),
        },
      };
    });
    setLastDraftSavedAt(null);
  }, []);

  const hasChanges = useMemo(() => JSON.stringify(draftSettings) !== JSON.stringify(settings), [draftSettings, settings]);
  const accessibilityChecks = useMemo(() => getBrandAccessibilityChecks(draftSettings), [draftSettings]);
  const hasCriticalChecks = accessibilityChecks.some((check) => check.status === 'critical');
  const blocker = useUnsavedChangesBlocker(hasChanges);

  useEffect(() => {
    if (blocker.state === 'blocked') {
      pendingNavigation.current = {
        proceed: blocker.proceed,
        reset: blocker.reset,
      };
      setShowLeavePrompt(true);
    }
    // Depend only on blocker.state — the hook returns a fresh object literal
    // each render, so `[blocker]` would fire this effect on every render.
  }, [blocker.state, blocker.proceed, blocker.reset]);

  useEffect(() => {
    if (!hasChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasChanges]);

  const assetValidationKey = useMemo(
    () => BRAND_SLOT_ORDER.map((slot) => `${slot}:${getBrandAssetSrc(draftSettings, slot) ?? ''}`).join('|'),
    [draftSettings]
  );

  useEffect(() => {
    let cancelled = false;

    const runAssetValidation = async () => {
      const validatingState = BRAND_SLOT_ORDER.reduce((acc, slot) => {
        const src = getBrandAssetSrc(draftSettings, slot);
        const resolvedFrom = getResolvedAssetField(draftSettings, slot, src);
        acc[slot] = {
          status: src ? 'validating' : 'empty',
          detail: src
            ? `Checking ${BRAND_SLOT_LABELS[slot].toLowerCase()} asset${resolvedFrom && resolvedFrom !== slot ? ` via ${BRAND_SLOT_LABELS[resolvedFrom].toLowerCase()} fallback` : ''}.`
            : EMPTY_SLOT_DETAIL(slot),
          src,
        };
        return acc;
      }, {} as Record<BrandAssetSlot, AssetValidationState>);

      if (!cancelled) {
        setAssetValidation(validatingState);
      }

      const results = await Promise.all(
        BRAND_SLOT_ORDER.map(async (slot) => {
          const src = getBrandAssetSrc(draftSettings, slot);
          const resolvedFrom = getResolvedAssetField(draftSettings, slot, src);

          if (!src) {
            // Nothing configured anywhere in this slot's fallback chain. That
            // is allowed — it is how a tenant returns to platform defaults —
            // so it must not block saving.
            return [slot, {
              status: 'empty',
              detail: EMPTY_SLOT_DETAIL(slot),
              src,
            }] as const;
          }

          const meta = await validateImageAsset(slot, src);
          return [slot, {
            status: meta ? 'valid' : 'invalid',
            detail: meta
              ? `${BRAND_SLOT_LABELS[slot]} is loading correctly${resolvedFrom && resolvedFrom !== slot ? ` using ${BRAND_SLOT_LABELS[resolvedFrom].toLowerCase()} fallback` : ''}.`
              : `${BRAND_SLOT_LABELS[slot]} could not be loaded. Re-upload the asset before saving.`,
            src,
            meta: meta ?? undefined,
          }] as const;
        })
      );

      if (!cancelled) {
        setAssetValidation(Object.fromEntries(results) as Record<BrandAssetSlot, AssetValidationState>);
      }
    };

    void runAssetValidation();

    return () => {
      cancelled = true;
    };
    // Only re-validate when the actual asset sources change — not on every
    // color/font/name edit, which would keep the Save button disabled while
    // assets re-validate on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetValidationKey]);


  /**
   * Only a *broken* asset blocks saving. This previously tested
   * `status !== 'valid'`, which counted every empty slot as a failure — so
   * removing a logo disabled the Save button and a tenant could never clear
   * their branding or return to the platform defaults.
   */
  const assetStatuses = useMemo(
    () => statusesOf(BRAND_SLOT_ORDER, (slot) => assetValidation[slot].status),
    [assetValidation]
  );
  const hasInvalidAssets = useMemo(() => assetsBlockSave(assetStatuses), [assetStatuses]);
  const isValidatingAssets = useMemo(() => assetsAreValidating(assetStatuses), [assetStatuses]);
  const canSaveBranding = hasChanges && canEditWhiteLabel && !hasCriticalChecks && !hasInvalidAssets && !isValidatingAssets && !isSavingBrand;
  const canUndoLastChange = draftHistoryRef.current.length > 0;
  const handleSaveDraft = useCallback(() => {
    try {
      const savedDraft = savePersistedDraft(draftSettings);
      setLastDraftSavedAt(savedDraft.savedAt);
      setAvailablePersistedDraft(savedDraft);
      toast.success('Draft saved', {
        description: 'Your draft was saved locally without changing live branding.',
      });
    } catch (error) {
      console.error('Failed to save local brand draft:', error);
      const description =
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? 'Browser storage is full. Remove old presets or use Save brand changes to publish this draft.'
          : 'We could not persist the draft locally. Your in-progress edits are still active — try Save brand changes instead.';
      toast.error('Draft not saved', { description });
    }
  }, [draftSettings]);


  const handleRestoreSavedDraft = useCallback(() => {
    if (!availablePersistedDraft) return;

    draftHistoryRef.current = [];
    setDraftSettings(availablePersistedDraft.settings);
    setLastDraftSavedAt(availablePersistedDraft.savedAt);
    setAvailablePersistedDraft(null);
    toast.success('Saved local draft restored');
  }, [availablePersistedDraft]);

  const handleUndoLastChange = useCallback(() => {
    const previousDraft = draftHistoryRef.current.at(-1);
    if (!previousDraft) return;

    draftHistoryRef.current = draftHistoryRef.current.slice(0, -1);
    isApplyingHistoryRef.current = true;
    setDraftSettings(previousDraft);
    setLastDraftSavedAt(null);
    toast.success('Last draft change undone');
  }, []);

  const handleResetDraft = useCallback(() => {
    draftHistoryRef.current = [...draftHistoryRef.current, draftSettings].slice(-50);
    setDraftSettings(createDefaultDraft());
    setLastDraftSavedAt(null);
    toast.success('Draft reset to brand defaults');
  }, [draftSettings]);

  const handleSavePreset = useCallback(() => {
    const trimmedName = presetName.trim();
    if (!trimmedName) {
      toast.error('Enter a preset name before saving');
      return;
    }

    const preset: StoredBrandPreset = {
      id: crypto.randomUUID(),
      name: trimmedName,
      settings: draftSettings,
      savedAt: new Date().toISOString(),
    };

    const nextPresets = [preset, ...savedPresets].slice(0, 12);
    setSavedPresets(nextPresets);
    saveStoredBrandPresets(nextPresets);
    setPresetName('');
    setShowPresetDialog(false);
    toast.success('Preset saved locally');
  }, [draftSettings, presetName, savedPresets]);

  const handleApplyPreset = useCallback((preset: StoredBrandPreset) => {
    draftHistoryRef.current = [...draftHistoryRef.current, draftSettings].slice(-50);
    setDraftSettings(preset.settings);
    setLastDraftSavedAt(null);
    toast.success(`Preset \"${preset.name}\" applied`);
  }, [draftSettings]);

  const handleDeletePreset = useCallback((presetId: string) => {
    const nextPresets = savedPresets.filter((preset) => preset.id !== presetId);
    setSavedPresets(nextPresets);
    saveStoredBrandPresets(nextPresets);
    toast.success('Preset removed');
  }, [savedPresets]);

  useEffect(() => {
    if (isApplyingHistoryRef.current) {
      isApplyingHistoryRef.current = false;
    }
  }, [draftSettings]);

  const handleKeepEditing = useCallback(() => {
    pendingNavigation.current?.reset();
    pendingNavigation.current = null;
    setShowLeavePrompt(false);
  }, []);

  const handleDiscardAndLeave = useCallback(() => {
    pendingNavigation.current?.proceed();
    pendingNavigation.current = null;
    setShowLeavePrompt(false);
  }, []);

  const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode; description: string }[] = [
    { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" />, description: 'Always use light theme' },
    { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" />, description: 'Always use dark theme' },
    { value: 'system', label: 'System', icon: <Laptop className="h-4 w-4" />, description: 'Follow device settings' },
  ];

  const handleSaveBranding = async () => {
    if (hasCriticalChecks) {
      toast.error('Resolve the critical brand checks before saving');
      return;
    }

    if (isValidatingAssets) {
      toast.error('Brand assets are still being checked — try again in a moment');
      return;
    }

    if (hasInvalidAssets) {
      toast.error('An uploaded brand asset could not be loaded', {
        description: 'Re-upload or remove the broken asset before saving.',
      });
      return;
    }

    if (isSavingBrand) return;
    setIsSavingBrand(true);
    try {
      const result = await updateSettings(draftSettings);

      // A save that the database never accepted must not look like one. This
      // previously toasted success and cleared the draft unconditionally, so a
      // rejected write reported "Branding settings saved" AND discarded the
      // user's edits — which is how removing a logo appeared to do nothing.
      if (!result.ok) {
        toast.error('Branding changes were not saved', {
          description: result.message,
          duration: 10000,
        });
        return;
      }

      clearPersistedDraft();
      setLastDraftSavedAt(null);
      setAvailablePersistedDraft(null);
      draftHistoryRef.current = [];
      toast.success('Branding settings saved');
      logActivityDirect({
        actionType: 'whitelabel_settings_updated',
        entityType: 'whitelabel_settings',
        entityName: 'Brand System',
        metadata: {
          companyName: draftSettings.companyName,
          hasAuthLogo: Boolean(draftSettings.authLogo),
          hasSidebarLogo: Boolean(draftSettings.sidebarLogo),
          hasSidebarIcon: Boolean(draftSettings.sidebarIcon),
          hasFavicon: Boolean(draftSettings.favicon),
        }
      });
    } finally {
      setIsSavingBrand(false);
    }
  };

  const brandingDraftActions = (
    <>
      <Badge variant="outline" className="min-h-10 max-w-full gap-2 rounded-full border-primary/30 bg-primary/10 px-4 py-2 text-primary shadow-sm shadow-primary/10 ring-1 ring-primary/10">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Palette className="h-3.5 w-3.5" />
        </span>
        <span className="truncate">Global Brand System</span>
      </Badge>
      <Badge
        variant="outline"
        className={hasChanges ? 'min-h-10 rounded-full border-warning/35 bg-warning/10 px-4 py-2 text-warning shadow-sm shadow-warning/10' : 'min-h-10 rounded-full border-success/35 bg-success/10 px-4 py-2 text-success shadow-sm shadow-success/10'}
      >
        {hasChanges ? 'Draft changes pending' : 'Live brand in sync'}
      </Badge>
      <Badge variant="outline" className="min-h-10 rounded-full border-border/70 bg-card/75 px-4 py-2 text-muted-foreground shadow-sm">
        Theme preview: <span className="ml-1 font-semibold capitalize text-foreground">{currentTheme}</span>
      </Badge>
      <Button className="min-h-10 bg-primary px-4 text-primary-foreground shadow-lg shadow-primary/25 ring-1 ring-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/30 focus-visible:ring-primary/50 disabled:hover:translate-y-0 disabled:shadow-none" onClick={handleSaveBranding} disabled={!canSaveBranding} aria-busy={isSavingBrand}>
        <Check className="mr-2 h-4 w-4" />
        Save brand changes
      </Button>
    </>
  );


  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/70 bg-card/95 px-5 py-4 text-muted-foreground shadow-xl shadow-background/10 ring-1 ring-primary/5">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm font-medium">Loading branding settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 overflow-x-hidden px-1 pb-10 sm:px-0">
      <PageHero
        eyebrow="BRAND STUDIO"
        title="Branding"
        subtitle="Manage logos, colours, browser identity, email signature, and dashboard theme defaults."
        imageVariant="branding"
        actions={brandingDraftActions}
      />

      <AlertDialog open={showLeavePrompt} onOpenChange={(open) => {
        if (!open) {
          handleKeepEditing();
          return;
        }
        setShowLeavePrompt(true);
      }}>
        <AlertDialogContent className="max-h-[min(90vh,720px)] overflow-y-auto border-border/70 bg-card/95 shadow-2xl ring-1 ring-primary/10">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved brand changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your draft differs from the saved brand settings. Leave now to discard the current draft, or stay and keep editing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleKeepEditing}>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardAndLeave}>Discard and leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showResetPrompt} onOpenChange={setShowResetPrompt}>
        <AlertDialogContent className="max-h-[min(90vh,720px)] overflow-y-auto border-border/70 bg-card/95 shadow-2xl ring-1 ring-primary/10">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this draft to defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the current draft with the default brand settings. Your live branding will stay unchanged until you explicitly save brand changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current draft</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              handleResetDraft();
              setShowResetPrompt(false);
            }}>
              Reset draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showPresetDialog} onOpenChange={setShowPresetDialog}>
        <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto border-border/70 bg-card/95 shadow-2xl ring-1 ring-primary/10">
          <DialogHeader>
            <DialogTitle>Save brand preset</DialogTitle>
            <DialogDescription>
              Store the current draft locally so operations can quickly reapply this branding combination later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="brand-preset-name">Preset name</Label>
              <Input
                id="brand-preset-name"
                className="min-h-11 min-w-0 border-border/80 bg-card/90 shadow-sm focus-visible:ring-primary/40"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder="e.g. Premium dark gold"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-primary focus-visible:ring-primary/40" onClick={() => setShowPresetDialog(false)}>Cancel</Button>
            <Button className="bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90 focus-visible:ring-primary/40" onClick={handleSavePreset}>Save preset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="dashboard-theme-section overflow-hidden border-primary/20 bg-gradient-to-br from-card via-card to-muted/20 shadow-xl shadow-primary/5">
        <CardContent className="relative flex flex-col gap-5 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/5 via-primary/35 to-primary/5" />
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">Brand System Draft</p>
              <Badge
                variant="outline"
                className={hasChanges ? 'rounded-full border-warning/35 bg-warning/10 px-3 py-1 text-warning shadow-sm shadow-warning/10' : 'rounded-full border-success/35 bg-success/10 px-3 py-1 text-success shadow-sm shadow-success/10'}
              >
                {hasChanges ? 'Unsaved changes' : 'In sync'}
              </Badge>
              {hasCriticalChecks && <Badge variant="outline" className="rounded-full border-destructive/40 bg-destructive/10 px-3 py-1 text-destructive shadow-sm shadow-destructive/10">Critical issues</Badge>}
              {hasInvalidAssets && <Badge variant="outline" className="rounded-full border-warning/40 bg-warning/10 px-3 py-1 text-warning shadow-sm shadow-warning/10">Asset validation required</Badge>}
            </div>
            <p className="max-w-2xl break-words text-sm text-muted-foreground">Review the draft control centre before publishing. Logos, colours, browser identity, email signature, and theme defaults continue to flow through the existing brand resolver.</p>
            {lastDraftSavedAt ? (
              <p className="mt-1 w-fit max-w-full rounded-full border border-success/25 bg-success/5 px-3 py-1 text-xs text-success shadow-sm shadow-success/10">Draft saved locally at {new Date(lastDraftSavedAt).toLocaleString('en-AU')}.</p>
            ) : null}
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            <Button variant="outline" className="min-h-10 min-w-0 border-border/70 bg-background/70 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5 hover:text-primary hover:shadow-md focus-visible:ring-primary/40 disabled:hover:translate-y-0" onClick={handleUndoLastChange} disabled={!canUndoLastChange || !canEditWhiteLabel}>
              <Undo2 className="mr-2 h-4 w-4" />
              Undo last change
            </Button>
            <Button variant="outline" className="min-h-10 min-w-0 border-primary/25 bg-primary/5 text-primary shadow-sm transition-all hover:-translate-y-0.5 hover:bg-primary/10 hover:text-primary hover:shadow-md hover:shadow-primary/10 focus-visible:ring-primary/40 disabled:hover:translate-y-0" onClick={handleSaveDraft} disabled={!canEditWhiteLabel}>
              <Save className="mr-2 h-4 w-4" />
              Save draft
            </Button>
            <Button variant="outline" className="min-h-10 min-w-0 border-primary/25 bg-primary/5 text-primary shadow-sm transition-all hover:-translate-y-0.5 hover:bg-primary/10 hover:text-primary hover:shadow-md hover:shadow-primary/10 focus-visible:ring-primary/40 disabled:hover:translate-y-0" onClick={() => setShowPresetDialog(true)} disabled={!canEditWhiteLabel}>
              <FileText className="mr-2 h-4 w-4" />
              Save preset
            </Button>
            <Button variant="outline" className="min-h-10 min-w-0 border-border/70 bg-background/70 text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:bg-muted/40 hover:text-foreground hover:shadow-md focus-visible:ring-primary/40 disabled:hover:translate-y-0" onClick={() => {
              setDraftSettings(settings);
              draftHistoryRef.current = [];
              clearPersistedDraft();
              setLastDraftSavedAt(null);
            }} disabled={!hasChanges}>Discard</Button>
            <Button variant="outline" className="min-h-10 min-w-0 border-destructive/30 bg-destructive/5 text-destructive shadow-sm transition-all hover:-translate-y-0.5 hover:bg-destructive/10 hover:text-destructive hover:shadow-md hover:shadow-destructive/10 focus-visible:ring-destructive/40 disabled:hover:translate-y-0" onClick={() => setShowResetPrompt(true)} disabled={!canEditWhiteLabel}>Reset to defaults</Button>
            <Button className="min-h-10 min-w-0 bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-1 ring-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/30 focus-visible:ring-primary/50 disabled:hover:translate-y-0 disabled:shadow-none" onClick={handleSaveBranding} disabled={!canSaveBranding} aria-busy={isSavingBrand}>
              <Check className="mr-2 h-4 w-4" />
              Save brand changes
            </Button>
          </div>
        </CardContent>
      </Card>

      {availablePersistedDraft ? (
        <Alert className="overflow-hidden border-warning/30 bg-warning/5 shadow-lg shadow-warning/10 ring-1 ring-warning/10">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-warning">Saved local draft available</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-words">
              Restore the draft you saved locally on {new Date(availablePersistedDraft.savedAt).toLocaleString('en-AU')} without changing the current live brand settings.
            </span>
            <div className="flex min-w-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                clearPersistedDraft();
                setAvailablePersistedDraft(null);
                toast.success('Saved local draft dismissed');
              }}>
                Dismiss
              </Button>
              <Button size="sm" onClick={handleRestoreSavedDraft}>
                Restore draft
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <Alert className="flex items-start gap-3 overflow-hidden border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 shadow-lg shadow-primary/5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
          <AlertCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <AlertTitle>How it works</AlertTitle>
          <AlertDescription className="text-sm leading-6">
            Drag and drop or click to upload your logo images. The background removal feature uses AI to automatically remove backgrounds. Logos are stored securely in the cloud and will persist across sessions.
          </AlertDescription>
        </div>
      </Alert>

      <Separator className="bg-border/60" />

      {/* Company Name */}
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-lg shadow-background/5">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
              <Monitor className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg">Brand name</CardTitle>
              <CardDescription className="break-words">This appears in the browser tab and dashboard shell.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="rounded-2xl border border-border/70 bg-background/60 p-3 shadow-inner sm:p-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                value={draftSettings.companyName}
                onChange={(e) => updateDraftSettings({ companyName: e.target.value })}
                placeholder="Enter company name"
                className="min-h-11 min-w-0 border-border/80 bg-card/90 font-medium shadow-sm focus-visible:ring-primary/30 sm:max-w-md"
              />
              <Badge variant="outline" className="min-h-10 w-fit max-w-full shrink-0 rounded-full border-primary/25 bg-primary/5 px-3 text-primary">
                <span className="truncate">Browser tab + shell brand name</span>
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Color Theme */}
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-lg shadow-background/5">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
              <Palette className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg">Brand colours</CardTitle>
              <CardDescription className="break-words">Choose primary actions and accent highlights without changing the approved dashboard surfaces.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Primary Color */}
            <div className="min-w-0 space-y-4 rounded-2xl border border-border/70 bg-background/60 p-4 shadow-inner">
              <div className="min-w-0 space-y-1">
                <Label className="text-sm font-medium">Primary colour</Label>
                <p className="text-xs text-muted-foreground">
                  Used for primary buttons, focus rings, active navigation, and chart emphasis
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative shrink-0 rounded-2xl border border-primary/20 bg-card p-2 shadow-sm transition-shadow hover:shadow-md">
                  <input
                    type="color"
                    aria-label="Primary color picker"
                     value={draftSettings.primaryColor ? hslToHex(draftSettings.primaryColor) : '#D4A017'}
                    onChange={(e) => {
                      const hsl = hexToHsl(e.target.value);
                       updateDraftSettings({ primaryColor: hsl });
                    }}
                    className="h-14 w-14 cursor-pointer overflow-hidden rounded-xl border-2 border-border bg-transparent transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    style={{ padding: 0 }}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="w-fit max-w-full rounded-full border border-border/70 bg-card px-3 py-1 text-sm font-mono shadow-sm">
                    {draftSettings.primaryColor ? hslToHex(draftSettings.primaryColor) : '#D4A017'}
                  </div>
                  <div className="max-w-full break-words rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground font-mono">
                    hsl({draftSettings.primaryColor || '43 74% 49%'})
                  </div>
                </div>
                {draftSettings.primaryColor && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="w-fit shrink-0 text-muted-foreground transition-all hover:bg-primary/5 hover:text-primary focus-visible:ring-primary/40"
                    onClick={() => {
                      updateDraftSettings({ primaryColor: null });
                    }}
                  >
                    Reset
                  </Button>
                )}
              </div>
              {/* Preview swatches */}
              <div className="flex flex-wrap gap-2 pt-1">
                <div 
                  className="h-10 w-10 rounded-xl border border-border/70 shadow-sm ring-1 ring-background transition-transform hover:-translate-y-0.5 hover:shadow-md"
                   style={{ backgroundColor: `hsl(${draftSettings.primaryColor || '43 74% 49%'})` }}
                  title="Primary"
                />
                <div 
                  className="h-10 w-10 rounded-xl border border-border/70 shadow-sm ring-1 ring-background transition-transform hover:-translate-y-0.5 hover:shadow-md"
                   style={{ backgroundColor: `hsl(${draftSettings.primaryColor || '43 74% 49%'} / 0.8)` }}
                  title="80%"
                />
                <div 
                  className="h-10 w-10 rounded-xl border border-border/70 shadow-sm ring-1 ring-background transition-transform hover:-translate-y-0.5 hover:shadow-md"
                   style={{ backgroundColor: `hsl(${draftSettings.primaryColor || '43 74% 49%'} / 0.5)` }}
                  title="50%"
                />
                <div 
                  className="h-10 w-10 rounded-xl border border-border/70 shadow-sm ring-1 ring-background transition-transform hover:-translate-y-0.5 hover:shadow-md"
                   style={{ backgroundColor: `hsl(${draftSettings.primaryColor || '43 74% 49%'} / 0.2)` }}
                  title="20%"
                />
              </div>
            </div>

            {/* Accent Color */}
            <div className="min-w-0 space-y-4 rounded-2xl border border-border/70 bg-background/60 p-4 shadow-inner">
              <div className="min-w-0 space-y-1">
                <Label className="text-sm font-medium">Accent colour</Label>
                <p className="text-xs text-muted-foreground">
                  Used for secondary emphasis, preview accents, and supporting chart colours
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative shrink-0 rounded-2xl border border-primary/20 bg-card p-2 shadow-sm transition-shadow hover:shadow-md">
                  <input
                    type="color"
                    aria-label="Accent color picker"
                     value={draftSettings.accentColor ? hslToHex(draftSettings.accentColor) : '#D4A017'}
                    onChange={(e) => {
                      const hsl = hexToHsl(e.target.value);
                       updateDraftSettings({ accentColor: hsl });
                    }}
                    className="h-14 w-14 cursor-pointer overflow-hidden rounded-xl border-2 border-border bg-transparent transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    style={{ padding: 0 }}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="w-fit max-w-full rounded-full border border-border/70 bg-card px-3 py-1 text-sm font-mono shadow-sm">
                    {draftSettings.accentColor ? hslToHex(draftSettings.accentColor) : '#D4A017'}
                  </div>
                  <div className="max-w-full break-words rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground font-mono">
                    hsl({draftSettings.accentColor || '43 74% 49%'})
                  </div>
                </div>
                {draftSettings.accentColor && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="w-fit shrink-0 text-muted-foreground transition-all hover:bg-primary/5 hover:text-primary focus-visible:ring-primary/40"
                    onClick={() => {
                      updateDraftSettings({ accentColor: null });
                    }}
                  >
                    Reset
                  </Button>
                )}
              </div>
              {/* Preview swatches */}
              <div className="flex flex-wrap gap-2 pt-1">
                <div 
                  className="h-10 w-10 rounded-xl border border-border/70 shadow-sm ring-1 ring-background transition-transform hover:-translate-y-0.5 hover:shadow-md"
                   style={{ backgroundColor: `hsl(${draftSettings.accentColor || '43 74% 49%'})` }}
                  title="Accent"
                />
                <div 
                  className="h-10 w-10 rounded-xl border border-border/70 shadow-sm ring-1 ring-background transition-transform hover:-translate-y-0.5 hover:shadow-md"
                   style={{ backgroundColor: `hsl(${draftSettings.accentColor || '43 74% 49%'} / 0.8)` }}
                  title="80%"
                />
                <div 
                  className="h-10 w-10 rounded-xl border border-border/70 shadow-sm ring-1 ring-background transition-transform hover:-translate-y-0.5 hover:shadow-md"
                   style={{ backgroundColor: `hsl(${draftSettings.accentColor || '43 74% 49%'} / 0.5)` }}
                  title="50%"
                />
                <div 
                  className="h-10 w-10 rounded-xl border border-border/70 shadow-sm ring-1 ring-background transition-transform hover:-translate-y-0.5 hover:shadow-md"
                   style={{ backgroundColor: `hsl(${draftSettings.accentColor || '43 74% 49%'} / 0.2)` }}
                  title="20%"
                />
              </div>
            </div>

            {/* Brand accent (gold) */}
            <div className="min-w-0 space-y-4 rounded-2xl border border-border/70 bg-background/60 p-4 shadow-inner md:col-span-2">
              <div className="min-w-0 space-y-1">
                <Label className="text-sm font-medium">Brand accent (gold)</Label>
                <p className="text-xs text-muted-foreground">
                  The signature brand highlight. Drives the <code className="font-mono">brand</code> token used for
                  premium flourishes and highlights across the app — in both light and dark. Semantic colours
                  (warning, success, error, info) are unaffected.
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative shrink-0 rounded-2xl border border-primary/20 bg-card p-2 shadow-sm transition-shadow hover:shadow-md">
                  <input
                    type="color"
                    aria-label="Brand accent color picker"
                    value={draftSettings.brandColor ? hslToHex(draftSettings.brandColor) : '#D4A017'}
                    onChange={(e) => {
                      updateDraftSettings({ brandColor: hexToHsl(e.target.value) });
                    }}
                    className="h-14 w-14 cursor-pointer overflow-hidden rounded-xl border-2 border-border bg-transparent transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    style={{ padding: 0 }}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="w-fit max-w-full rounded-full border border-border/70 bg-card px-3 py-1 text-sm font-mono shadow-sm">
                    {draftSettings.brandColor ? hslToHex(draftSettings.brandColor) : '#D4A017'}
                  </div>
                  <div className="max-w-full break-words rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground font-mono">
                    hsl({draftSettings.brandColor || '43 74% 49%'})
                  </div>
                </div>
                {draftSettings.brandColor && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit shrink-0 text-muted-foreground transition-all hover:bg-primary/5 hover:text-primary focus-visible:ring-primary/40"
                    onClick={() => updateDraftSettings({ brandColor: null })}
                  >
                    Reset
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {[1, 0.8, 0.5, 0.2].map((op) => (
                  <div
                    key={op}
                    className="h-10 w-10 rounded-xl border border-border/70 shadow-sm ring-1 ring-background"
                    style={{ backgroundColor: `hsl(${draftSettings.brandColor || '43 74% 49%'} / ${op})` }}
                    title={`${op * 100}%`}
                  />
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Typography */}
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-lg shadow-background/5">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
              <Type className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg">Typography</CardTitle>
              <CardDescription className="break-words">
                A global font applied to every text component across all pages. Choose a body font, an optional
                heading font, and an overall size.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Body font</Label>
              <Select
                value={draftSettings.fontFamily || 'system'}
                onValueChange={(v) => updateDraftSettings({ fontFamily: v === 'system' ? null : v })}
              >
                <SelectTrigger aria-label="Body font"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      <span style={{ fontFamily: f.stack }}>{f.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Heading font</Label>
              <Select
                value={draftSettings.headingFontFamily || 'inherit'}
                onValueChange={(v) =>
                  updateDraftSettings({ headingFontFamily: v === 'inherit' ? null : v })
                }
              >
                <SelectTrigger aria-label="Heading font"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Same as body</SelectItem>
                  {FONT_OPTIONS.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      <span style={{ fontFamily: f.stack }}>{f.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Text size</Label>
              <Select
                value={draftSettings.fontScale || 'default'}
                onValueChange={(v) => updateDraftSettings({ fontScale: v === 'default' ? null : v })}
              >
                <SelectTrigger aria-label="Text size"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FONT_SCALE_OPTIONS.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Live preview — light + dark, updates instantly with the selection */}
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              { mode: 'Light', bg: '42 82% 99%', fg: '34 20% 16%', muted: '33 14% 38%' },
              { mode: 'Dark', bg: '0 0% 7%', fg: '40 6% 90%', muted: '0 0% 55%' },
            ] as const).map((p) => {
              const bodyStack = resolveFontStack(draftSettings.fontFamily);
              const headingStack = draftSettings.headingFontFamily
                ? resolveFontStack(draftSettings.headingFontFamily)
                : bodyStack;
              const brand = draftSettings.brandColor || '43 74% 49%';
              const primary = draftSettings.primaryColor || (p.mode === 'Dark' ? '43 74% 49%' : '262 66% 46%');
              return (
                <div
                  key={p.mode}
                  className="rounded-2xl border border-border/70 p-5 shadow-sm"
                  style={{ backgroundColor: `hsl(${p.bg})`, color: `hsl(${p.fg})` }}
                >
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: `hsl(${p.muted})` }}>
                    {p.mode} preview
                  </div>
                  <div style={{ fontFamily: headingStack, fontSize: '1.35rem', fontWeight: 700 }}>
                    The quick brown fox
                  </div>
                  <p style={{ fontFamily: bodyStack, fontSize: '0.9rem', lineHeight: 1.6, color: `hsl(${p.muted})` }}>
                    Body copy — jumps over the lazy dog. 1234567890. This is how paragraph text renders across the dashboard.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <span
                      className="rounded-md px-3 py-1.5 text-xs font-semibold"
                      style={{ backgroundColor: `hsl(${primary})`, color: '#fff', fontFamily: bodyStack }}
                    >
                      Primary
                    </span>
                    <span
                      className="rounded-md px-3 py-1.5 text-xs font-semibold"
                      style={{ backgroundColor: `hsl(${brand})`, color: '#1a1204', fontFamily: bodyStack }}
                    >
                      Brand
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Dark Mode */}
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-lg shadow-background/5">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
              {currentTheme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg">Theme default</CardTitle>
              <CardDescription className="break-words">Choose the default dashboard theme while preserving the existing theme toggle behaviour.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                   onClick={() => {
                    updateDraftSettings({ darkModeDefault: option.value });
                  logActivityDirect({
                    actionType: 'whitelabel_theme_changed',
                    entityType: 'whitelabel_settings',
                    metadata: { theme: option.value }
                  });
                }}
                className={`flex min-w-0 flex-col items-center gap-3 rounded-2xl border p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                   draftSettings.darkModeDefault === option.value
                    ? 'border-primary bg-primary/10 shadow-primary/10 ring-1 ring-primary/25'
                    : 'border-border/70 bg-background/60'
                }`}
              >
                <div className={`rounded-2xl p-3 shadow-sm ${
                   draftSettings.darkModeDefault === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {option.icon}
                </div>
                <div className="min-w-0 space-y-1 text-center">
                  <p className="font-medium text-sm">{option.label}</p>
                  <p className="break-words text-xs text-muted-foreground">{option.description}</p>
                </div>
              </button>
            ))}
          </div>
          <p className="mt-4 w-fit max-w-full rounded-full border border-border/70 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
            Runtime theme: <span className="font-medium capitalize">{currentTheme}</span>
          </p>
        </CardContent>
      </Card>

      {/* Logo Upload Cards */}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <LogoUploadCard
          title="Auth Page Logo"
          description="Displayed prominently on the login page (recommended: wide format)"
          icon={<LogIn className="h-5 w-5 text-primary" />}
          currentLogo={draftSettings.authLogo}
          logoType="auth"
          onUpload={(url) => { updateDraftSettings({ authLogo: url }); logActivityDirect({ actionType: 'whitelabel_logo_uploaded', entityType: 'whitelabel_settings', metadata: { logo_type: 'auth' } }); }}
          onRemove={() => { updateDraftSettings({ authLogo: null }); logActivityDirect({ actionType: 'whitelabel_logo_removed', entityType: 'whitelabel_settings', metadata: { logo_type: 'auth' } }); }}
        />

        <LogoUploadCard
          title="Sidebar Logo"
          description="Displayed in the expanded sidebar (recommended: horizontal)"
          icon={<PanelLeft className="h-5 w-5 text-primary" />}
          currentLogo={draftSettings.sidebarLogo}
          logoType="sidebar"
          onUpload={(url) => { updateDraftSettings({ sidebarLogo: url }); logActivityDirect({ actionType: 'whitelabel_logo_uploaded', entityType: 'whitelabel_settings', metadata: { logo_type: 'sidebar' } }); }}
          onRemove={() => { updateDraftSettings({ sidebarLogo: null }); logActivityDirect({ actionType: 'whitelabel_logo_removed', entityType: 'whitelabel_settings', metadata: { logo_type: 'sidebar' } }); }}
        />

        <LogoUploadCard
          title="Collapsed Sidebar Icon"
          description="Shown when sidebar is minimized (recommended: square, 32x32)"
          icon={<Minimize2 className="h-5 w-5 text-primary" />}
          currentLogo={draftSettings.sidebarIcon}
          logoType="sidebar-icon"
          onUpload={(url) => { updateDraftSettings({ sidebarIcon: url }); logActivityDirect({ actionType: 'whitelabel_logo_uploaded', entityType: 'whitelabel_settings', metadata: { logo_type: 'sidebar-icon' } }); }}
          onRemove={() => { updateDraftSettings({ sidebarIcon: null }); logActivityDirect({ actionType: 'whitelabel_logo_removed', entityType: 'whitelabel_settings', metadata: { logo_type: 'sidebar-icon' } }); }}
        />

        <LogoUploadCard
          title="Favicon"
          description="Browser tab icon (recommended: square, 32x32)"
          icon={<Globe className="h-5 w-5 text-primary" />}
          currentLogo={draftSettings.favicon}
          logoType="favicon"
          onUpload={(url) => { updateDraftSettings({ favicon: url }); logActivityDirect({ actionType: 'whitelabel_logo_uploaded', entityType: 'whitelabel_settings', metadata: { logo_type: 'favicon' } }); }}
          onRemove={() => { updateDraftSettings({ favicon: null }); logActivityDirect({ actionType: 'whitelabel_logo_removed', entityType: 'whitelabel_settings', metadata: { logo_type: 'favicon' } }); }}
        />

        <LogoUploadCard
          title="Report Logo"
          description="Printed on generated PDFs — cover, contents and closing page (recommended: wide, at least 150px tall)"
          icon={<FileText className="h-5 w-5 text-primary" />}
          currentLogo={draftSettings.reportLogo}
          logoType="report"
          onUpload={(url) => { updateDraftSettings({ reportLogo: url }); logActivityDirect({ actionType: 'whitelabel_logo_uploaded', entityType: 'whitelabel_settings', metadata: { logo_type: 'report' } }); }}
          onRemove={() => { updateDraftSettings({ reportLogo: null }); logActivityDirect({ actionType: 'whitelabel_logo_removed', entityType: 'whitelabel_settings', metadata: { logo_type: 'report' } }); }}
        />

        <LogoUploadCard
          title="Report Logo (dark ground)"
          description="Knockout mark for the dark report cover and closing page. Falls back to the report logo if unset."
          icon={<FileText className="h-5 w-5 text-primary" />}
          currentLogo={draftSettings.reportMonoLogo}
          logoType="report-mono"
          onUpload={(url) => { updateDraftSettings({ reportMonoLogo: url }); logActivityDirect({ actionType: 'whitelabel_logo_uploaded', entityType: 'whitelabel_settings', metadata: { logo_type: 'report-mono' } }); }}
          onRemove={() => { updateDraftSettings({ reportMonoLogo: null }); logActivityDirect({ actionType: 'whitelabel_logo_removed', entityType: 'whitelabel_settings', metadata: { logo_type: 'report-mono' } }); }}
        />
      </div>

      <Card className="border-border/70 bg-card/95 shadow-lg shadow-background/5">
        <CardHeader>
          <CardTitle>Live brand preview</CardTitle>
          <CardDescription>Review dashboard, portal, browser identity, and email signature surfaces before saving.</CardDescription>
        </CardHeader>
        <CardContent>
          <BrandPreviewShowcase settings={draftSettings} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-background/10 ring-1 ring-primary/5">
        <CardHeader className="border-b border-border/60 bg-background/35">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-sm shadow-primary/10">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle>Accessibility & Brand Health</CardTitle>
              <CardDescription>Contrast and slot coverage are validated against your current draft before it can be saved globally.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-4 sm:p-6">
          <div className="rounded-2xl border border-border/70 bg-background/55 p-4 shadow-inner">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Compliance snapshot</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Readiness, asset coverage, and contrast checks use the current draft values and continue to block publishing when critical issues are present.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {BRAND_SLOT_ORDER.map((slot) => {
              const validation = assetValidation[slot];
              const isValid = validation.status === 'valid';
              // Empty reads as neutral, not as a problem: it is a legitimate
              // choice that hands the surface to the platform default.
              const isInvalid = validation.status === 'invalid';

              return (
                <div
                  key={slot}
                  className={`min-w-0 overflow-hidden rounded-2xl border p-4 shadow-lg transition-colors ${
                    isValid
                      ? 'border-success/30 bg-success/5 shadow-success/10 ring-1 ring-success/10'
                      : isInvalid
                        ? 'border-warning/35 bg-warning/5 shadow-warning/10 ring-1 ring-warning/10'
                        : 'border-border bg-muted/20 shadow-background/5 ring-1 ring-border/50'
                  }`}
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-foreground">{BRAND_SLOT_LABELS[slot]}</p>
                      <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{validation.detail}</p>
                      {validation.meta ? (
                        <div className="mt-3 space-y-1 rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs leading-5 text-muted-foreground shadow-inner">
                          <p className="break-words">{validation.meta.width}×{validation.meta.height}px · {validation.meta.aspectRatio.toFixed(2)}:1 aspect</p>
                          <p className="break-words">{validation.meta.recommendation}</p>
                        </div>
                      ) : null}
                    </div>
                    <Badge variant="outline" className={`w-fit shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${isValid ? 'border-success/35 bg-success/10 text-success shadow-sm shadow-success/10' : isInvalid ? 'border-warning/35 bg-warning/10 text-warning shadow-sm shadow-warning/10' : 'border-border bg-muted/40 text-muted-foreground'}`}>
                      {assetStatusLabel(validation.status)}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
          <BrandAccessibilityPanel checks={accessibilityChecks} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-background/10 ring-1 ring-primary/5">
        <CardHeader className="border-b border-border/60 bg-background/35">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-sm shadow-primary/10">
              <Monitor className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle>Impact preview</CardTitle>
              <CardDescription>See which shared surfaces will update when this draft becomes the live brand configuration.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-4 sm:p-6">
          <div className="rounded-2xl border border-border/70 bg-background/55 p-4 shadow-inner">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Executive impact summary</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">These surfaces inherit the same saved brand system when the draft is committed, making it easier to review shell, controls, data views, and assets before publishing.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {impactPreview.map((item) => (
              <div key={item.id} className="dashboard-section-band min-w-0 space-y-3 overflow-hidden rounded-2xl border border-border/70 bg-background/60 p-4 shadow-lg shadow-background/10 ring-1 ring-primary/5">
                <Badge variant="outline" className="w-fit max-w-full rounded-full border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary shadow-sm shadow-primary/10"><span className="truncate">{item.surface}</span></Badge>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-foreground">{item.label}</p>
                  <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
          {savedPresets.length > 0 ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Saved presets</p>
                <p className="text-sm text-muted-foreground">Apply or remove previously saved local brand combinations.</p>
              </div>
              <div className="grid gap-3">
                {savedPresets.map((preset) => (
                  <div key={preset.id} className="dashboard-section-band flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-foreground">{preset.name}</p>
                      <p className="text-xs text-muted-foreground">Saved {new Date(preset.savedAt).toLocaleString('en-AU')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleDeletePreset(preset.id)}>Remove</Button>
                      <Button size="sm" onClick={() => handleApplyPreset(preset)}>Apply preset</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-background/10 ring-1 ring-primary/5">
        <CardHeader className="border-b border-border/60 bg-background/35">
          <CardTitle>Preview each surface</CardTitle>
          <CardDescription>Inspect auth, sidebar, and browser-tab styling in isolation before saving.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <Tabs value={activeSurfacePreview} onValueChange={(value) => setActiveSurfacePreview(value as SurfacePreview)} className="min-w-0 space-y-5">
            <TabsList className="grid h-auto w-full min-w-0 grid-cols-1 gap-2 rounded-[1.35rem] border border-border/70 bg-background/70 p-1.5 shadow-inner shadow-background/10 sm:grid-cols-3">
              <TabsTrigger className="min-h-10 min-w-0 rounded-2xl px-3 py-2.5 font-semibold text-muted-foreground transition-all hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 data-[state=active]:border data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/25" value="auth">Auth</TabsTrigger>
              <TabsTrigger className="min-h-10 min-w-0 rounded-2xl px-3 py-2.5 font-semibold text-muted-foreground transition-all hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 data-[state=active]:border data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/25" value="sidebar">Sidebar</TabsTrigger>
              <TabsTrigger className="min-h-10 min-w-0 rounded-2xl px-3 py-2.5 font-semibold text-muted-foreground transition-all hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 data-[state=active]:border data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/25" value="browser"><span className="block min-w-0 truncate">Browser tab</span></TabsTrigger>
            </TabsList>

            <TabsContent value="auth" className="space-y-3">
              <Label className="text-sm font-medium">Authentication surfaces</Label>
              <div className="overflow-hidden rounded-[1.75rem] border border-border/60 bg-card p-4 shadow-lg shadow-background/10 sm:p-6">
                <div className="mx-auto flex max-w-md min-w-0 flex-col items-center gap-4 rounded-[1.5rem] border border-border/60 bg-background px-5 py-10 text-center shadow-xl ring-1 ring-primary/5 sm:px-6">
                  {getBrandAssetSrc(draftSettings, 'auth') ? (
                    <img src={getBrandAssetSrc(draftSettings, 'auth') || ''} alt="Auth logo preview" className="h-14 max-w-full object-contain drop-shadow-sm sm:max-w-[220px]" />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <LogIn className="h-6 w-6" />
                    </div>
                  )}
                  <div className="min-w-0 space-y-1">
                    <p className="break-words text-lg font-semibold text-foreground">{draftSettings.companyName}</p>
                    <p className="text-sm leading-6 text-muted-foreground">Sign in to continue to your branded workspace.</p>
                  </div>
                  <div className="grid w-full gap-3">
                    <div className="h-11 rounded-xl border border-border/60 bg-muted/40 shadow-inner" />
                    <div className="h-11 rounded-xl bg-primary shadow-lg shadow-primary/25" />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="sidebar" className="space-y-3">
              <Label className="text-sm font-medium">Sidebar shell surfaces</Label>
              <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_96px]">
                <div className="overflow-hidden rounded-[1.5rem] border border-border/60 bg-card shadow-xl shadow-background/10 ring-1 ring-primary/5">
                  <div className="flex min-w-0 items-center gap-3 border-b border-border/60 bg-sidebar/95 p-4 text-sidebar-foreground">
                    {getBrandAssetSrc(draftSettings, 'sidebar') ? (
                      <img src={getBrandAssetSrc(draftSettings, 'sidebar') || ''} alt="Sidebar logo preview" className="h-10 max-w-[140px] object-contain drop-shadow-sm" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
                        <PanelLeft className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{draftSettings.companyName}</p>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/65">Internal dashboard</p>
                    </div>
                  </div>
                  <div className="space-y-2 p-3">
                    {['Overview', 'Clients', 'Pipeline'].map((item, index) => (
                      <div key={item} className={`min-w-0 rounded-xl px-3 py-2.5 text-sm shadow-sm ${index === 0 ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sidebar-primary/15' : 'bg-sidebar-accent/10 text-sidebar-foreground/80'}`}>
                        <span className="block min-w-0 truncate">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="overflow-hidden rounded-[1.5rem] border border-border/60 bg-card shadow-xl shadow-background/10 ring-1 ring-primary/5">
                  <div className="flex items-center justify-center border-b border-border/60 bg-sidebar/95 p-4 text-sidebar-foreground">
                    {getBrandAssetSrc(draftSettings, 'sidebar-icon') ? (
                      <img src={getBrandAssetSrc(draftSettings, 'sidebar-icon') || ''} alt="Sidebar icon preview" className="h-10 w-10 object-contain" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
                        <Minimize2 className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 p-3">
                    {[1, 2, 3].map((item) => (
                      <div key={item} className="h-10 rounded-xl bg-muted/40" />
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="browser" className="space-y-3">
              <Label className="text-sm font-medium">Browser tab + favicon surface</Label>
              <div className="overflow-hidden rounded-[1.75rem] border border-border/60 bg-card p-4 shadow-lg shadow-background/10 ring-1 ring-primary/5">
                <div className="rounded-2xl border border-border/60 bg-background p-4 shadow-inner">
                  <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 shadow-sm">
                    {getBrandAssetSrc(draftSettings, 'favicon') ? (
                      <img src={getBrandAssetSrc(draftSettings, 'favicon') || ''} alt="Favicon preview" className="h-8 w-8 shrink-0 rounded-lg object-contain drop-shadow-sm" />
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Globe className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{draftSettings.companyName} Dashboard</p>
                      <p className="truncate text-xs text-muted-foreground">Browser tab preview with resolved favicon slot</p>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Separator />

      {/* Email Signature Configuration */}
      <div className="min-w-0 space-y-2 rounded-[1.75rem] border border-border/70 bg-card/80 p-5 shadow-lg shadow-background/5 ring-1 ring-primary/5">
        <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
          <Mail className="h-6 w-6 text-primary" />
          Email Copilot Signature
        </h2>
        <p className="break-words text-muted-foreground">
          Configure the email signature that will be attached to all outgoing emails from the Email Copilot
        </p>
      </div>

      {/* Email Signature Banner */}
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-background/10 ring-1 ring-primary/5">
        <CardHeader className="border-b border-border/60 bg-background/35">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Signature Banner</CardTitle>
              <CardDescription className="break-words">Upload a banner image to display at the top of your email signature</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <EmailBannerUpload
            currentBanner={draftSettings.emailSignature.banner}
            onUpload={(url) => updateDraftSettings({ 
              emailSignature: { ...draftSettings.emailSignature, banner: url } 
            })}
            onRemove={() => updateDraftSettings({ 
              emailSignature: { ...draftSettings.emailSignature, banner: null } 
            })}
          />
        </CardContent>
      </Card>

      {/* Email Signature Body */}
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-background/10 ring-1 ring-primary/5">
        <CardHeader className="border-b border-border/60 bg-background/35">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Signature Details</CardTitle>
              <CardDescription className="break-words">Configure the contact information and text that appears in your email signature</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 p-4 sm:p-6">
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sig-name">Name</Label>
              <Input
                id="sig-name"
                className="min-h-11 min-w-0 border-border/80 bg-card/90 shadow-sm focus-visible:ring-primary/40"
                value={draftSettings.emailSignature.name}
                onChange={(e) => updateDraftSettings({ 
                  emailSignature: { ...draftSettings.emailSignature, name: e.target.value } 
                })}
                placeholder="John Smith"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sig-title">Title / Role</Label>
              <Input
                id="sig-title"
                className="min-h-11 min-w-0 border-border/80 bg-card/90 shadow-sm focus-visible:ring-primary/40"
                value={draftSettings.emailSignature.title}
                onChange={(e) => updateDraftSettings({ 
                  emailSignature: { ...draftSettings.emailSignature, title: e.target.value } 
                })}
                placeholder="Property Investment Specialist"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sig-phone">Phone Number</Label>
              <Input
                id="sig-phone"
                className="min-h-11 min-w-0 border-border/80 bg-card/90 shadow-sm focus-visible:ring-primary/40"
                value={draftSettings.emailSignature.phone}
                onChange={(e) => updateDraftSettings({ 
                  emailSignature: { ...draftSettings.emailSignature, phone: e.target.value } 
                })}
                placeholder="+61 400 000 000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sig-email">Email Address</Label>
              <Input
                id="sig-email"
                type="email"
                className="min-h-11 min-w-0 border-border/80 bg-card/90 shadow-sm focus-visible:ring-primary/40"
                value={draftSettings.emailSignature.email}
                onChange={(e) => updateDraftSettings({ 
                  emailSignature: { ...draftSettings.emailSignature, email: e.target.value } 
                })}
                placeholder="contact@yourcompany.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sig-website">Website</Label>
              <Input
                id="sig-website"
                className="min-h-11 min-w-0 border-border/80 bg-card/90 shadow-sm focus-visible:ring-primary/40"
                value={draftSettings.emailSignature.website}
                onChange={(e) => updateDraftSettings({ 
                  emailSignature: { ...draftSettings.emailSignature, website: e.target.value } 
                })}
                placeholder="www.yourcompany.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sig-address">Address</Label>
              <Input
                id="sig-address"
                className="min-h-11 min-w-0 border-border/80 bg-card/90 shadow-sm focus-visible:ring-primary/40"
                value={draftSettings.emailSignature.address}
                onChange={(e) => updateDraftSettings({ 
                  emailSignature: { ...draftSettings.emailSignature, address: e.target.value } 
                })}
                placeholder="123 Business St, Sydney NSW 2000"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="sig-disclaimer">Disclaimer / Legal Text</Label>
            <Textarea
              id="sig-disclaimer"
              className="min-h-32 min-w-0 resize-y overflow-auto break-words leading-6 focus-visible:ring-primary/40"
              value={draftSettings.emailSignature.disclaimer}
              onChange={(e) => updateDraftSettings({ 
                emailSignature: { ...draftSettings.emailSignature, disclaimer: e.target.value } 
              })}
              placeholder="Legal disclaimer text..."
              rows={4}
            />
            <p className="break-words text-xs text-muted-foreground">
              This text will appear at the bottom of your email signature as a legal disclaimer
            </p>
          </div>

          {/* Email Signature Preview */}
          <div className="space-y-3 border-t border-border/60 pt-4">
            <Label className="text-sm font-medium">Email Signature Preview</Label>
            <div className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background p-4 shadow-inner">
              {draftSettings.emailSignature.banner && (
                <img 
                  src={draftSettings.emailSignature.banner} 
                  alt="Email banner" 
                  className="mb-4 max-h-24 max-w-full object-contain"
                />
              )}
              <div className="min-w-0 space-y-1">
                <p className="break-words font-semibold text-foreground">{draftSettings.emailSignature.name || 'Your Name'}</p>
                <p className="break-words text-sm text-muted-foreground">{draftSettings.emailSignature.title || 'Your Title'}</p>
                <div className="space-y-0.5 pt-2 text-sm text-muted-foreground">
                  {draftSettings.emailSignature.phone && <p className="break-words">📞 {draftSettings.emailSignature.phone}</p>}
                  {draftSettings.emailSignature.email && <p className="break-words">✉️ {draftSettings.emailSignature.email}</p>}
                  {draftSettings.emailSignature.website && <p className="break-words">🌐 {draftSettings.emailSignature.website}</p>}
                  {draftSettings.emailSignature.address && <p className="break-words">📍 {draftSettings.emailSignature.address}</p>}
                </div>
              </div>
              {draftSettings.emailSignature.disclaimer && (
                <p className="mt-4 max-h-40 overflow-auto break-words border-t border-border/60 pt-4 text-xs italic leading-5 text-muted-foreground">
                  {draftSettings.emailSignature.disclaimer}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Reset Section */}
      <Card className="overflow-hidden border-destructive/50 bg-card/95 shadow-xl shadow-destructive/10 ring-1 ring-destructive/10">
        <CardHeader className="border-b border-destructive/20 bg-destructive/5">
          <CardTitle className="text-destructive">Reset Branding</CardTitle>
          <CardDescription className="break-words">Reset the current draft back to defaults before deciding whether to save it globally.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <Button 
            variant="destructive" 
            className="min-h-10 shadow-lg shadow-destructive/20 focus-visible:ring-destructive/40" 
            onClick={() => setShowResetPrompt(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Reset draft to defaults
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
