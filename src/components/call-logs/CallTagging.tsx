import { useState, useEffect } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Tag, Plus, X, Settings, Trash2 } from 'lucide-react';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { useSecureCallLogs } from '@/hooks/useSecureCallLogs';
import { callLogBadgeBase } from './badgeStyles';

interface CallTag {
  id: string;
  name: string;
  color: string;
  description: string | null;
}

interface CallTaggingProps {
  callId: string;
  currentTags: string[];
  onTagsUpdated: (tags: string[]) => void;
  compact?: boolean;
}

const TAG_COLORS = [
  { name: 'red', class: 'bg-destructive/20 text-destructive border-destructive/30' },
  { name: 'amber', class: 'bg-brand-500/20 text-brand-400 border-brand-500/30' },
  { name: 'green', class: 'bg-success/20 text-success border-success/30' },
  { name: 'blue', class: 'bg-info/20 text-info border-info/30' },
  { name: 'purple', class: 'bg-accent/20 text-accent border-accent/30' },
  { name: 'orange', class: 'bg-warning/20 text-warning border-warning/30' },
  { name: 'pink', class: 'bg-accent/20 text-accent border-accent/30' },
  { name: 'gray', class: 'bg-muted/20 text-muted-foreground border-border/30' },
];

const getColorClass = (color: string) => {
  return `${callLogBadgeBase} ${TAG_COLORS.find(c => c.name === color)?.class || TAG_COLORS[7].class}`;
};

// Secure API helpers
async function fetchTagsSecure(): Promise<CallTag[]> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'list',
    table: 'call_tags',
  });
  
  if (error || !data?.success) {
    console.error('Error fetching tags:', error || data?.error);
    return [];
  }
  return data.items || [];
}

async function createTagSecure(name: string, color: string): Promise<{ success: boolean; error?: string; code?: string }> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'create',
    table: 'call_tags',
    data: { name, color },
  });
  
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error, code: data?.code };
  return { success: true };
}

async function deleteTagSecure(tagId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'delete',
    table: 'call_tags',
    recordId: tagId,
  });
  
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error };
  return { success: true };
}

export const CallTagging = ({ callId, currentTags, onTagsUpdated, compact = false }: CallTaggingProps) => {
  const { toast } = useToast();
  const { updateCallTags } = useSecureCallLogs();
  const [availableTags, setAvailableTags] = useState<CallTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [showManager, setShowManager] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('blue');

  useEffect(() => {
    fetchTags();
  }, []);

  const fetchTags = async () => {
    const tags = await fetchTagsSecure();
    setAvailableTags(tags);
  };

  const toggleTag = async (tagName: string) => {
    setLoading(true);
    try {
      const newTags = currentTags.includes(tagName)
        ? currentTags.filter(t => t !== tagName)
        : [...currentTags, tagName];

      const { error } = await updateCallTags(callId, newTags);

      if (error) throw error;

      onTagsUpdated(newTags);
      const wasRemoved = currentTags.includes(tagName);
      toast({
        title: wasRemoved ? 'Tag removed' : 'Tag added',
        description: `${tagName} ${wasRemoved ? 'removed from' : 'added to'} call`,
      });
      logActivityDirect({
        actionType: 'call_tagged',
        entityType: 'call_log',
        entityId: callId,
        entityName: tagName,
        metadata: { action: wasRemoved ? 'remove' : 'add', tag: tagName }
      });
    } catch (error) {
      console.error('Error updating tags:', error);
      toast({
        title: 'Error',
        description: 'Failed to update tags',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const createTag = async () => {
    if (!newTagName.trim()) return;
    
    setLoading(true);
    try {
      const result = await createTagSecure(newTagName.trim(), newTagColor);

      if (!result.success) {
        if (result.code === '23505') {
          toast({ title: 'Tag exists', description: 'A tag with this name already exists', variant: 'destructive' });
        } else {
          toast({ title: 'Error', description: result.error || 'Failed to create tag', variant: 'destructive' });
        }
        return;
      }

      toast({ title: 'Tag created', description: `"${newTagName}" tag created successfully` });
      setNewTagName('');
      setNewTagColor('blue');
      fetchTags();
    } finally {
      setLoading(false);
    }
  };

  const deleteTag = async (tagId: string, tagName: string) => {
    setLoading(true);
    try {
      const result = await deleteTagSecure(tagId);

      if (!result.success) {
        toast({ title: 'Error', description: result.error || 'Failed to delete tag', variant: 'destructive' });
        return;
      }

      toast({ title: 'Tag deleted', description: `"${tagName}" tag deleted` });
      fetchTags();
    } finally {
      setLoading(false);
    }
  };

  if (compact) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 gap-1">
            <Tag className="w-3.5 h-3.5" />
            {currentTags.length > 0 && (
              <span className="text-xs">{currentTags.length}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Tags</span>
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setShowManager(true)}>
                <Settings className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map(tag => (
                <Badge
                  key={tag.id}
                  className={`cursor-pointer transition-all ${getColorClass(tag.color)} ${
                    currentTags.includes(tag.name) ? 'ring-2 ring-offset-1 ring-offset-background' : 'opacity-60 hover:opacity-100'
                  }`}
                  onClick={() => toggleTag(tag.name)}
                >
                  {tag.name}
                </Badge>
              ))}
              {availableTags.length === 0 && (
                <span className="text-xs text-muted-foreground">No tags available</span>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Tags</span>
        </div>
        <Dialog open={showManager} onOpenChange={setShowManager}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 gap-1">
              <Settings className="w-3.5 h-3.5" />
              <span className="text-xs">Manage</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Manage Tags</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Create new tag */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Create New Tag</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Tag name..."
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    className="flex-1"
                  />
                  <Select value={newTagColor} onValueChange={setNewTagColor}>
                    <SelectTrigger className="w-24">
                      <div className={`w-4 h-4 rounded-full ${TAG_COLORS.find(c => c.name === newTagColor)?.class.split(' ')[0]}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {TAG_COLORS.map(color => (
                        <SelectItem key={color.name} value={color.name}>
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded-full ${color.class.split(' ')[0]}`} />
                            <span className="capitalize">{color.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={createTag} disabled={loading || !newTagName.trim()}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Existing tags */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Existing Tags</label>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {availableTags.map(tag => (
                    <div key={tag.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                      <Badge className={getColorClass(tag.color)}>{tag.name}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteTag(tag.id, tag.name)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Current tags display */}
      <div className="flex flex-wrap gap-1.5">
        {currentTags.map(tagName => {
          const tag = availableTags.find(t => t.name === tagName);
          return (
            <Badge
              key={tagName}
              className={`${getColorClass(tag?.color || 'gray')} cursor-pointer gap-1`}
              onClick={() => toggleTag(tagName)}
            >
              {tagName}
              <X className="w-3 h-3" />
            </Badge>
          );
        })}
      </div>

      {/* Add tags */}
      <div className="flex flex-wrap gap-1.5">
        {availableTags
          .filter(tag => !currentTags.includes(tag.name))
          .map(tag => (
            <Badge
              key={tag.id}
              className={`${getColorClass(tag.color)} opacity-50 hover:opacity-100 cursor-pointer`}
              onClick={() => toggleTag(tag.name)}
            >
              <Plus className="w-3 h-3 mr-1" />
              {tag.name}
            </Badge>
          ))}
      </div>
    </div>
  );
};

// Tag filter component for the call list
export const CallTagFilter = ({ 
  selectedTags, 
  onTagsChange,
  triggerClassName,
}: { 
  selectedTags: string[]; 
  onTagsChange: (tags: string[]) => void;
  triggerClassName?: string;
}) => {
  const [availableTags, setAvailableTags] = useState<CallTag[]>([]);

  useEffect(() => {
    const loadTags = async () => {
      const tags = await fetchTagsSecure();
      setAvailableTags(tags);
    };
    loadTags();
  }, []);

  const toggleTag = (tagName: string) => {
    onTagsChange(
      selectedTags.includes(tagName)
        ? selectedTags.filter(t => t !== tagName)
        : [...selectedTags, tagName]
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`gap-2 ${triggerClassName || ''}`}>
          <Tag className="h-4 w-4 shrink-0" />
          Tags
          {selectedTags.length > 0 && (
            <Badge variant="secondary" className={`${callLogBadgeBase} ml-1 h-5 px-1.5`}>
              {selectedTags.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 border-border dark:border-white/10 bg-background dark:bg-background/95 p-3 shadow-2xl shadow-sm dark:shadow-black/40 backdrop-blur-xl" align="start">
        <div className="space-y-3">
          <span className="text-sm font-semibold text-brand-100">Filter by Tags</span>
          <div className="flex flex-wrap gap-1.5">
            {availableTags.map(tag => (
              <Badge
                key={tag.id}
                className={`cursor-pointer transition-all ${getColorClass(tag.color)} ${
                  selectedTags.includes(tag.name) ? 'ring-2 ring-brand-300/70 ring-offset-1 ring-offset-background' : 'opacity-65 hover:opacity-100'
                }`}
                onClick={() => toggleTag(tag.name)}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
          {selectedTags.length > 0 && (
            <Button variant="ghost" size="sm" className="w-full h-7 text-xs" onClick={() => onTagsChange([])}>
              Clear all
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
