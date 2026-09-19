import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SearchInput } from '@/components/ui/search-input';
import {
  AlertCircle,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
  Trash2,
  Archive,
  Layers,
  Search,
  X,
  Upload,
  Download,
  Eye,
  Paperclip,
} from "lucide-react";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { useToast } from "@/hooks/use-toast";

type LibraryImage = {
  id: string;
  prompt: string;
  enhanced_prompt: string | null;
  model: string;
  aspect_ratio: string;
  width: number;
  height: number;
  status: string;
  public_url: string | null;
  thumbnail_url: string | null;
  source_report_id: string | null;
  tags: string[] | null;
  is_archived: boolean;
  created_at: string;
};

type Chapter = { section_key: string; section_title: string; order: number };

type Placement = {
  id: string;
  section_key: string;
  section_title: string;
  library_image_id: string;
  render_height: "compact" | "standard" | "tall" | "full_bleed";
  render_width: "content" | "full_bleed";
  object_fit: "cover" | "contain";
  focal: "top" | "center" | "bottom";
  rounded: boolean;
  library?: { public_url: string | null; prompt: string };
};

const MODEL_OPTIONS = [
  { value: "openai/gpt-image-2", label: "GPT-Image 2 (premium)" },
  { value: "openai/gpt-image-1-mini", label: "GPT-Image 1 Mini (fast)" },
  { value: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image" },
  { value: "google/gemini-3.1-flash-image-preview", label: "Nano Banana 2 (fast)" },
  { value: "google/gemini-2.5-flash-image", label: "Nano Banana" },
];

const ASPECT_OPTIONS = [
  { value: "16:9", label: "16:9 — wide banner" },
  { value: "3:2", label: "3:2 — editorial" },
  { value: "4:3", label: "4:3 — classic" },
  { value: "1:1", label: "1:1 — square" },
  { value: "3:4", label: "3:4 — portrait" },
  { value: "9:16", label: "9:16 — tall" },
  { value: "21:9", label: "21:9 — ultrawide" },
];

const HEIGHT_OPTIONS = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "tall", label: "Tall" },
  { value: "full_bleed", label: "Full page" },
];

const WIDTH_OPTIONS = [
  { value: "content", label: "Content width" },
  { value: "full_bleed", label: "Edge-to-edge" },
];

const FIT_OPTIONS = [
  { value: "cover", label: "Cover (fill)" },
  { value: "contain", label: "Contain (fit)" },
];

const FOCAL_OPTIONS = [
  { value: "top", label: "Top" },
  { value: "center", label: "Center" },
  { value: "bottom", label: "Bottom" },
];

interface Props {
  reportId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HeroImageStudio({ reportId, open, onOpenChange }: Props) {
  const { toast } = useToast();

  // Generation panel
  const [prompt, setPrompt] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [model, setModel] = useState("openai/gpt-image-2");
  const [aspect, setAspect] = useState("3:2");
  const [variations, setVariations] = useState(1);
  const [refImages, setRefImages] = useState<{ name: string; dataUrl: string }[]>([]);

  // Library
  const [library, setLibrary] = useState<LibraryImage[]>([]);
  const [libLoading, setLibLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [orientationFilter, setOrientationFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [thisReportOnly, setThisReportOnly] = useState(false);

  // Placements + chapters
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [previewPlacement, setPreviewPlacement] = useState<Placement | null>(null);

  // Load data
  const fetchLibrary = useCallback(async () => {
    setLibLoading(true);
    const { data, error } = await invokeSecureFunction<{ images: LibraryImage[] }>(
      "hero-image-studio",
      {
        action: "library_list",
        search: search || undefined,
        model: modelFilter === "all" ? undefined : modelFilter,
        orientation: orientationFilter === "all" ? undefined : orientationFilter,
        sourceReportId: thisReportOnly ? reportId : undefined,
        limit: 120,
      },
      { timeoutMs: 60_000 },
    );
    setLibLoading(false);
    if (error) {
      toast({ title: "Couldn't load library", description: error.message, variant: "destructive" });
      return;
    }
    setLibrary(data?.images || []);
  }, [search, modelFilter, orientationFilter, thisReportOnly, reportId, toast]);

  const fetchChaptersAndPlacements = useCallback(async () => {
    const [c, p] = await Promise.all([
      invokeSecureFunction<{ chapters: Chapter[] }>(
        "hero-image-studio",
        { action: "chapters_list", reportId },
        { timeoutMs: 30_000 },
      ),
      invokeSecureFunction<{ placements: Placement[] }>(
        "hero-image-studio",
        { action: "placements_list", reportId },
        { timeoutMs: 30_000 },
      ),
    ]);
    if (c.data?.chapters) setChapters(c.data.chapters);
    if (p.data?.placements) setPlacements(p.data.placements);
  }, [reportId]);

  useEffect(() => {
    if (open) {
      fetchLibrary();
      fetchChaptersAndPlacements();
    }
  }, [open, fetchLibrary, fetchChaptersAndPlacements]);

  // Refilter when filters change (debounce search slightly)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { fetchLibrary(); }, 250);
    return () => clearTimeout(t);
  }, [search, modelFilter, orientationFilter, thisReportOnly, open, fetchLibrary]);

  const placementsBySlug = useMemo(() => {
    const m = new Map<string, Placement>();
    for (const p of placements) m.set(p.section_key, p);
    return m;
  }, [placements]);

  // Actions
  const handleEnhance = async () => {
    if (!prompt.trim()) {
      toast({ title: "Add a prompt first", variant: "destructive" });
      return;
    }
    setEnhancing(true);
    const { data, error } = await invokeSecureFunction<{ enhanced: string }>(
      "hero-image-studio",
      { action: "enhance_prompt", prompt },
      { timeoutMs: 45_000 },
    );
    setEnhancing(false);
    if (error || !data?.enhanced) {
      toast({ title: "Enhance failed", description: error?.message, variant: "destructive" });
      return;
    }
    setPrompt(data.enhanced);
    toast({ title: "Prompt enhanced", description: "Edit it further or generate now." });
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast({ title: "Add a prompt first", variant: "destructive" });
      return;
    }
    const isGemini = model.startsWith("google/");
    if (refImages.length && !isGemini) {
      toast({
        title: "Reference images need a Gemini model",
        description: "Switch to Gemini 3 Pro Image or Nano Banana to use references.",
        variant: "destructive",
      });
      return;
    }
    setGenerating(true);
    const { data, error } = await invokeSecureFunction<{ images: LibraryImage[]; errors: string[] }>(
      "hero-image-studio",
      {
        action: "generate",
        prompt,
        model,
        aspectRatio: aspect,
        variations,
        sourceReportId: reportId,
        referenceImages: refImages.map((r) => r.dataUrl),
      },
      { timeoutMs: 220_000 },
    );
    setGenerating(false);
    if (error) {
      toast({ title: "Generation failed", description: error.message, variant: "destructive" });
      return;
    }
    const made = data?.images?.length || 0;
    toast({
      title: made > 0 ? `${made} image${made === 1 ? "" : "s"} generated` : "Generation failed",
      description: data?.errors?.length ? data.errors[0] : undefined,
      variant: made > 0 ? "default" : "destructive",
    });
    await fetchLibrary();
  };

  const readFileAsDataUrl = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });

  const decodeImageSize = (dataUrl: string): Promise<{ width: number; height: number }> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 1, height: 1 });
      img.src = dataUrl;
    });

  const handleAddReferenceImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files).slice(0, 4 - refImages.length);
    const next: { name: string; dataUrl: string }[] = [];
    for (const f of arr) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 8 * 1024 * 1024) {
        toast({ title: `${f.name} too large`, description: "Max 8MB per reference.", variant: "destructive" });
        continue;
      }
      next.push({ name: f.name, dataUrl: await readFileAsDataUrl(f) });
    }
    setRefImages((prev) => [...prev, ...next].slice(0, 4));
  };

  const handleRawUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        if (f.size > 20 * 1024 * 1024) {
          toast({ title: `${f.name} too large`, description: "Max 20MB.", variant: "destructive" });
          continue;
        }
        const dataUrl = await readFileAsDataUrl(f);
        const { width, height } = await decodeImageSize(dataUrl);
        const { error } = await invokeSecureFunction(
          "hero-image-studio",
          {
            action: "library_upload",
            fileBase64: dataUrl,
            contentType: f.type || "image/png",
            width,
            height,
            prompt: f.name,
            sourceReportId: reportId,
          },
          { timeoutMs: 120_000 },
        );
        if (error) {
          toast({ title: `Upload failed: ${f.name}`, description: error.message, variant: "destructive" });
        }
      }
      await fetchLibrary();
      toast({ title: "Upload complete" });
    } finally {
      setUploading(false);
    }
  };

  const downloadImage = async (img: LibraryImage) => {
    if (!img.public_url) return;
    try {
      const res = await fetch(img.public_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = (blob.type.split("/")[1] || "png").split("+")[0];
      a.download = `hero-${img.id.slice(0, 8)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      toast({ title: "Download failed", description: e?.message, variant: "destructive" });
    }
  };


  const placeImage = async (img: LibraryImage) => {
    if (!selectedSlug) {
      toast({ title: "Pick a chapter first", description: "Click a chapter slot on the right." });
      return;
    }
    const chapter = chapters.find((c) => c.section_key === selectedSlug);
    if (!chapter) return;
    const { error } = await invokeSecureFunction(
      "hero-image-studio",
      {
        action: "placement_set",
        reportId,
        sectionKey: chapter.section_key,
        sectionTitle: chapter.section_title,
        libraryImageId: img.id,
      },
      { timeoutMs: 20_000 },
    );
    if (error) {
      toast({ title: "Couldn't place image", description: error.message, variant: "destructive" });
      return;
    }
    await fetchChaptersAndPlacements();
    toast({ title: "Placed", description: `Used in "${chapter.section_title}".` });
  };

  const updatePlacement = async (p: Placement, patch: Partial<Placement>) => {
    setPlacements((prev) =>
      prev.map((x) => (x.section_key === p.section_key ? { ...x, ...patch } : x)),
    );
    const { error } = await invokeSecureFunction(
      "hero-image-studio",
      {
        action: "placement_set",
        reportId,
        sectionKey: p.section_key,
        sectionTitle: p.section_title,
        libraryImageId: p.library_image_id,
        renderHeight: patch.render_height ?? p.render_height,
        renderWidth: patch.render_width ?? p.render_width,
        objectFit: patch.object_fit ?? p.object_fit,
        focal: patch.focal ?? p.focal,
        rounded: patch.rounded ?? p.rounded,
      },
      { timeoutMs: 20_000 },
    );
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      await fetchChaptersAndPlacements();
    }
  };

  const clearPlacement = async (p: Placement) => {
    const { error } = await invokeSecureFunction(
      "hero-image-studio",
      { action: "placement_clear", reportId, sectionKey: p.section_key },
      { timeoutMs: 20_000 },
    );
    if (error) {
      toast({ title: "Couldn't remove", description: error.message, variant: "destructive" });
      return;
    }
    await fetchChaptersAndPlacements();
  };

  const archiveImage = async (img: LibraryImage) => {
    const { error } = await invokeSecureFunction(
      "hero-image-studio",
      { action: "library_update", libraryImageId: img.id, archive: !img.is_archived },
      { timeoutMs: 20_000 },
    );
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    fetchLibrary();
  };

  const deleteImage = async (img: LibraryImage) => {
    if (!confirm("Delete this image permanently?")) return;
    const { error } = await invokeSecureFunction(
      "hero-image-studio",
      { action: "library_delete", libraryImageId: img.id },
      { timeoutMs: 20_000 },
    );
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    fetchLibrary();
    fetchChaptersAndPlacements();
  };

  const orientationOf = (img: LibraryImage) =>
    img.width === img.height ? "square" : img.width > img.height ? "landscape" : "portrait";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:w-[94vw] sm:max-w-[1600px] h-[92vh] max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="shrink-0 px-5 sm:px-6 pt-5 pb-3 pr-14 border-b">
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            Hero Image Studio
          </DialogTitle>
          <DialogDescription>
            Generate, browse, and place chapter hero images. Library is shared across every report.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-y-auto lg:overflow-hidden">
          {/* ─── Generate panel ─── */}
          <aside className="min-h-[520px] min-w-0 border-b lg:min-h-0 lg:border-b-0 lg:col-span-3 xl:col-span-3 lg:border-r flex flex-col bg-muted/20 overflow-hidden">
            <div className="shrink-0 px-4 py-3 border-b">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" /> Generate
              </h3>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-4 space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Prompt</Label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g. Sweeping aerial of a Brisbane riverside neighbourhood at dusk"
                    rows={5}
                    className="min-h-[120px] text-xs resize-y"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleEnhance}
                    disabled={enhancing || generating}
                    className="w-full mt-1"
                  >
                    {enhancing ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                    )}
                    {enhancing ? "Enhancing…" : "Enhance prompt"}
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Model</Label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="h-9 text-xs min-w-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODEL_OPTIONS.map((m) => (
                        <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Aspect ratio</Label>
                  <Select value={aspect} onValueChange={setAspect}>
                    <SelectTrigger className="h-9 text-xs min-w-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASPECT_OPTIONS.map((a) => (
                        <SelectItem key={a.value} value={a.value} className="text-xs">{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs flex justify-between">
                    <span>Variations</span>
                    <span className="text-muted-foreground">{variations}</span>
                  </Label>
                  <Slider
                    value={[variations]}
                    onValueChange={(v) => setVariations(v[0])}
                    min={1}
                    max={4}
                    step={1}
                  />
                </div>

                {/* Reference images (Gemini only) */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex justify-between">
                    <span>Reference images</span>
                    <span className="text-muted-foreground">{refImages.length}/4</span>
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {refImages.map((r, i) => (
                      <div key={i} className="relative w-12 h-12 rounded border overflow-hidden bg-muted">
                        <img src={r.dataUrl} alt={r.name} className="w-full h-full object-cover" />
                        <button
                          onClick={() => setRefImages((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center"
                          title="Remove"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                    {refImages.length < 4 && (
                      <label className="w-12 h-12 rounded border-2 border-dashed flex items-center justify-center cursor-pointer hover:border-primary/60 hover:bg-muted/40">
                        <Paperclip className="h-4 w-4 text-muted-foreground" />
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => { handleAddReferenceImages(e.target.files); e.target.value = ""; }}
                        />
                      </label>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Gemini models only. Used as style/composition guidance.
                  </p>
                </div>

                <Button
                  onClick={handleGenerate}
                  disabled={generating || enhancing || !prompt.trim()}
                  className="w-full bg-gradient-to-r from-primary to-primary/70"
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-1" />
                  )}
                  {generating ? `Generating ${variations}…` : `Generate ${variations} image${variations === 1 ? "" : "s"}`}
                </Button>

                <div className="pt-2 border-t">
                  <Label className="text-xs mb-1.5 block">Or upload your own</Label>
                  <label className="block">
                    <Button
                      asChild
                      variant="outline"
                      className="w-full cursor-pointer"
                      disabled={uploading}
                    >
                      <span>
                        {uploading ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4 mr-1" />
                        )}
                        {uploading ? "Uploading…" : "Upload image"}
                      </span>
                    </Button>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => { handleRawUpload(e.target.files); e.target.value = ""; }}
                    />
                  </label>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Skip AI — embed your own photo directly in the PDF.
                  </p>
                </div>

                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Heads-up: variations run sequentially. Larger requests can take 30–90s each.
                </p>
              </div>
            </ScrollArea>
          </aside>

          {/* ─── Library ─── */}
          <section className="min-h-[520px] min-w-0 border-b lg:min-h-0 lg:border-b-0 lg:col-span-6 xl:col-span-6 flex flex-col lg:border-r overflow-hidden">
            <div className="shrink-0 px-4 py-3 border-b flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" /> Library
                <Badge variant="secondary" className="ml-1 text-[10px]">{library.length}</Badge>
              </h3>
              <div className="flex w-full flex-wrap items-center gap-2 xl:ml-auto xl:w-auto">
                <SearchInput
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search prompts"
                  containerClassName="min-w-[180px] flex-1 xl:flex-none"
                  className="h-8 text-xs w-full xl:w-56"
                  iconClassName="h-3.5 w-3.5 left-2"
                />
                <Select value={orientationFilter} onValueChange={setOrientationFilter}>
                  <SelectTrigger className="h-8 w-[132px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All shapes</SelectItem>
                    <SelectItem value="landscape" className="text-xs">Landscape</SelectItem>
                    <SelectItem value="portrait" className="text-xs">Portrait</SelectItem>
                    <SelectItem value="square" className="text-xs">Square</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={modelFilter} onValueChange={setModelFilter}>
                  <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All models</SelectItem>
                    {MODEL_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value} className="text-xs">
                        {m.label.split(" ")[0]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5">
                  <Switch
                    id="this-report"
                    checked={thisReportOnly}
                    onCheckedChange={setThisReportOnly}
                  />
                  <Label htmlFor="this-report" className="text-[11px] cursor-pointer">This report</Label>
                </div>
                <Button size="icon" variant="ghost" onClick={fetchLibrary} disabled={libLoading} className="h-8 w-8">
                  <RefreshCw className={`h-3.5 w-3.5 ${libLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="p-4">
                {libLoading && library.length === 0 ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : library.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-20 gap-2 text-muted-foreground">
                    <ImageIcon className="h-8 w-8 opacity-40" />
                    <p className="text-sm">No images yet. Use the generator on the left.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                    {library.map((img) => (
                      <div
                        key={img.id}
                        className="group border rounded-lg overflow-hidden bg-card hover:border-primary/40 transition"
                      >
                        <div className="aspect-[3/2] bg-muted overflow-hidden">
                          {img.public_url ? (
                            <img
                              src={img.public_url}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              {img.status === "failed" ? (
                                <AlertCircle className="h-5 w-5 text-destructive" />
                              ) : (
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                              )}
                            </div>
                          )}
                        </div>
                        <div className="p-2 space-y-1.5">
                          <p className="text-[11px] line-clamp-2 text-muted-foreground" title={img.prompt}>
                            {img.prompt}
                          </p>
                          <div className="flex items-center gap-1 flex-wrap">
                            <Badge variant="outline" className="text-[9px] py-0 px-1">{img.aspect_ratio}</Badge>
                            <Badge variant="outline" className="text-[9px] py-0 px-1">{orientationOf(img)}</Badge>
                          </div>
                          <div className="flex items-center gap-1 pt-1">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => placeImage(img)}
                              disabled={!selectedSlug}
                              className="flex-1 h-7 text-[11px]"
                              title={selectedSlug ? "Place in selected chapter" : "Pick a chapter first"}
                            >
                              Place
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => downloadImage(img)}
                              className="h-7 w-7"
                              title="Download"
                            >
                              <Download className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => archiveImage(img)}
                              className="h-7 w-7"
                              title={img.is_archived ? "Unarchive" : "Archive"}
                            >
                              <Archive className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteImage(img)}
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </section>

          {/* ─── Chapter placements ─── */}
          <aside className="min-h-[520px] min-w-0 lg:min-h-0 lg:col-span-3 xl:col-span-3 flex flex-col bg-muted/20 overflow-hidden">
            <div className="shrink-0 px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">Chapters</h3>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                Click a chapter to select it, then click <strong>Place</strong> on any library image.
              </p>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-3 space-y-2">
                {chapters.length === 0 && (
                  <p className="text-xs text-muted-foreground p-4 text-center">No chapters detected.</p>
                )}
                {chapters.map((c) => {
                  const p = placementsBySlug.get(c.section_key);
                  const selected = selectedSlug === c.section_key;
                  return (
                    <div
                      key={c.section_key}
                      onClick={() => setSelectedSlug(c.section_key)}
                      className={`border rounded-md overflow-hidden bg-card cursor-pointer transition ${
                        selected ? "ring-2 ring-primary border-primary" : "hover:border-primary/40"
                      }`}
                    >
                      <div className="px-3 py-2 flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-[12px] font-medium leading-snug break-words" title={c.section_title}>
                          {c.section_title}
                        </span>
                        {p && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => { e.stopPropagation(); setPreviewPlacement(p); }}
                              className="h-7 w-7 shrink-0"
                              title="Preview in PDF"
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => { e.stopPropagation(); clearPlacement(p); }}
                              className="h-7 w-7 shrink-0"
                              title="Remove"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                      {p?.library?.public_url ? (
                        <div className="aspect-[3/1] bg-muted overflow-hidden">
                          <img src={p.library.public_url} alt="" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="aspect-[3/1] bg-muted/40 flex items-center justify-center text-[10px] text-muted-foreground">
                          {selected ? "Selected · place an image" : "Empty"}
                        </div>
                      )}
                      {p && selected && (
                        <div className="p-2 space-y-1.5 border-t bg-background/50">
                          <PlacementControl label="Height" value={p.render_height} options={HEIGHT_OPTIONS}
                            onChange={(v) => updatePlacement(p, { render_height: v as any })} />
                          <PlacementControl label="Width" value={p.render_width} options={WIDTH_OPTIONS}
                            onChange={(v) => updatePlacement(p, { render_width: v as any })} />
                          <PlacementControl label="Fit" value={p.object_fit} options={FIT_OPTIONS}
                            onChange={(v) => updatePlacement(p, { object_fit: v as any })} />
                          <PlacementControl label="Focal" value={p.focal} options={FOCAL_OPTIONS}
                            onChange={(v) => updatePlacement(p, { focal: v as any })} />
                          <div className="flex items-center justify-between pt-0.5">
                            <Label className="text-[10px]">Rounded corners</Label>
                            <Switch
                              checked={p.rounded}
                              onCheckedChange={(v) => updatePlacement(p, { rounded: v })}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </aside>
        </div>
      </DialogContent>

      {/* PDF preview for a placement */}
      <Dialog open={!!previewPlacement} onOpenChange={(o) => !o && setPreviewPlacement(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              PDF preview — {previewPlacement?.section_title}
            </DialogTitle>
            <DialogDescription>
              Approximation of how this hero will appear on the rendered PDF page.
            </DialogDescription>
          </DialogHeader>
          {previewPlacement && (
            <div className="space-y-3">
              {/* A4-ish page wrapper at 595×842 scaled */}
              <div
                className="mx-auto border bg-white shadow-sm relative overflow-hidden"
                style={{ width: 480, height: 680 }}
              >
                {/* Header strip */}
                <div className="absolute top-0 left-0 right-0 h-6 bg-muted/40 border-b" />
                {(() => {
                  const heightPx = previewPlacement.render_height === "compact" ? 90
                    : previewPlacement.render_height === "tall" ? 220
                    : previewPlacement.render_height === "full_bleed" ? 680
                    : 150;
                  const fullBleed = previewPlacement.render_width === "full_bleed";
                  const radius = previewPlacement.rounded && previewPlacement.render_height !== "full_bleed" ? 8 : 0;
                  const inset = fullBleed ? 0 : 32;
                  const top = previewPlacement.render_height === "full_bleed" ? 0 : 32;
                  return (
                    <div
                      style={{
                        position: "absolute",
                        top,
                        left: inset,
                        right: inset,
                        height: heightPx,
                        borderRadius: radius,
                        overflow: "hidden",
                        background: "hsl(var(--muted))",
                      }}
                    >
                      {previewPlacement.library?.public_url && (
                        <img
                          src={previewPlacement.library.public_url}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: previewPlacement.object_fit,
                            objectPosition: previewPlacement.focal,
                          }}
                        />
                      )}
                    </div>
                  );
                })()}
                {/* Body placeholder */}
                {previewPlacement.render_height !== "full_bleed" && (
                  <div className="absolute left-8 right-8 bottom-8 space-y-2">
                    <div className="h-3 bg-muted rounded w-1/2" />
                    <div className="h-2 bg-muted/70 rounded w-full" />
                    <div className="h-2 bg-muted/70 rounded w-11/12" />
                    <div className="h-2 bg-muted/70 rounded w-10/12" />
                    <div className="h-2 bg-muted/70 rounded w-9/12" />
                  </div>
                )}
              </div>
              <div className="flex justify-center text-xs text-muted-foreground gap-3">
                <Badge variant="outline" className="text-[10px]">{previewPlacement.render_height}</Badge>
                <Badge variant="outline" className="text-[10px]">{previewPlacement.render_width}</Badge>
                <Badge variant="outline" className="text-[10px]">fit: {previewPlacement.object_fit}</Badge>
                <Badge variant="outline" className="text-[10px]">focal: {previewPlacement.focal}</Badge>
                {previewPlacement.rounded && <Badge variant="outline" className="text-[10px]">rounded</Badge>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function PlacementControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
      <Label className="text-[10px] shrink-0">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 min-w-0 text-[11px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
