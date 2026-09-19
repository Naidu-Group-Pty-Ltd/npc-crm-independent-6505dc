import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Plus, X, Tag, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { logActivityDirect } from '@/hooks/useActivityLogger';

interface ClientTagsProps {
  clientId: string;
  compact?: boolean;
}

export function ClientTags({ clientId, compact = false }: ClientTagsProps) {
  /**
   * The cookie-authenticated gateway, not the plain browser client.
   *
   * `client_tags` and `client_tag_assignments` are scoped to `service_role`,
   * and this app's identity is a custom HttpOnly cookie — so the anon client
   * had its reads FILTERED to nothing (the tag list looked empty) and its
   * inserts refused outright ("new row violates row-level security policy").
   * Both tables are declared in `authenticated-data`, which verifies the staff
   * session server-side and stamps who created and who assigned.
   */
  const { supabase } = useAuthenticatedSupabase();
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3B82F6');
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  // Fetch all available tags
  const { data: allTags = [] } = useQuery({
    queryKey: ['client-tags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_tags')
        .select('*')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  // Fetch client's assigned tags
  const { data: assignedTags = [], isLoading } = useQuery({
    queryKey: ['client-tag-assignments', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_tag_assignments')
        .select('*, client_tags(*)')
        .eq('client_id', clientId);
      if (error) throw error;
      return data;
    }
  });

  // Assign tag mutation
  const assignTagMutation = useMutation({
    mutationFn: async (tagId: string) => {
      const { error } = await supabase
        .from('client_tag_assignments')
        .insert({ client_id: clientId, tag_id: tagId });
      if (error) throw error;
    },
    onSuccess: (_: any, tagId: string) => {
      queryClient.invalidateQueries({ queryKey: ['client-tag-assignments', clientId] });
      const tagName = allTags.find(t => t.id === tagId)?.name;
      logActivityDirect({
        actionType: 'client_tag_added',
        entityType: 'client',
        entityId: clientId,
        metadata: { tag_name: tagName }
      });
      toast.success('Tag added');
    },
    onError: (error) => {
      toast.error('Failed to add tag: ' + error.message);
    }
  });

  // Remove tag mutation
  const removeTagMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from('client_tag_assignments')
        .delete()
        .eq('id', assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-tag-assignments', clientId] });
      logActivityDirect({
        actionType: 'client_tag_removed',
        entityType: 'client',
        entityId: clientId,
      });
      toast.success('Tag removed');
    },
    onError: (error) => {
      toast.error('Failed to remove tag: ' + error.message);
    }
  });

  // Create new tag mutation
  const createTagMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('client_tags')
        .insert({ name: newTagName.trim(), color: newTagColor })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['client-tags'] });
      setNewTagName('');
      setShowCreate(false);
      // Auto-assign the new tag
      assignTagMutation.mutate(data.id);
    },
    onError: (error) => {
      toast.error('Failed to create tag: ' + error.message);
    }
  });

  const assignedTagIds = assignedTags.map(at => at.tag_id);
  const availableTags = allTags.filter(tag => !assignedTagIds.includes(tag.id));

  /**
   * The ten tag colours, each with the name a person would use for it.
   *
   * The name is not decoration. A swatch grid is a control whose only signal
   * is colour, which is exactly the signal a colour-blind operator does not
   * have and a screen reader never had — "button" ten times over. The name is
   * the accessible label and the tooltip, so the control can be operated
   * without seeing the difference between the red one and the orange one.
   */
  const colorPresets: Array<{ value: string; name: string }> = [
    { value: '#EF4444', name: 'Red' },
    { value: '#F59E0B', name: 'Amber' },
    { value: '#10B981', name: 'Green' },
    { value: '#3B82F6', name: 'Blue' },
    { value: '#8B5CF6', name: 'Violet' },
    { value: '#EC4899', name: 'Pink' },
    { value: '#6B7280', name: 'Grey' },
    { value: '#14B8A6', name: 'Teal' },
    { value: '#F97316', name: 'Orange' },
    { value: '#6366F1', name: 'Indigo' },
  ];
  const selectedColorName = colorPresets.find((preset) => preset.value === newTagColor)?.name;

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {isLoading ? (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
          </Badge>
        ) : (
          <>
            {assignedTags.slice(0, 3).map((assignment) => (
              <Badge 
                key={assignment.id}
                style={{ 
                  backgroundColor: `${assignment.client_tags?.color}20`,
                  color: assignment.client_tags?.color,
                  borderColor: `${assignment.client_tags?.color}40`
                }}
                className="text-xs"
              >
                {assignment.client_tags?.name}
              </Badge>
            ))}
            {assignedTags.length > 3 && (
              <Badge variant="secondary" className="text-xs">
                +{assignedTags.length - 3}
              </Badge>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Assigned Tags */}
      <div className="flex flex-wrap gap-2">
        {isLoading ? (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading...
          </Badge>
        ) : assignedTags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tags assigned</p>
        ) : (
          assignedTags.map((assignment) => (
            <Badge 
              key={assignment.id}
              style={{ 
                backgroundColor: `${assignment.client_tags?.color}20`,
                color: assignment.client_tags?.color,
                borderColor: `${assignment.client_tags?.color}40`
              }}
              className="gap-1 pr-1"
            >
              {assignment.client_tags?.name}
              <button
                onClick={() => removeTagMutation.mutate(assignment.id)}
                className="ml-1 hover:bg-black/10 rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}

        {/* Add Tag Button */}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-6 gap-1">
              <Plus className="h-3 w-3" />
              Add Tag
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            {showCreate ? (
              <div className="p-3 space-y-3">
                <Input
                  placeholder="Tag name..."
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  className="h-8"
                />
                <div className="space-y-1.5">
                  {/* The selection used to be a 2px border drawn INSIDE the
                      swatch, in a colour close to several of the swatches —
                      so on a dark popover nothing looked chosen at all. A ring
                      sits outside the circle, a tick sits on top of it, and
                      the chosen colour is named underneath, because a control
                      whose only signal is colour has no signal for the reader
                      most likely to need one. */}
                  <div role="radiogroup" aria-label="Tag colour" className="flex flex-wrap gap-1.5">
                    {colorPresets.map((preset) => {
                      const selected = newTagColor === preset.value;
                      return (
                        <button
                          key={preset.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={preset.name}
                          title={preset.name}
                          onClick={() => setNewTagColor(preset.value)}
                          className={`flex h-7 w-7 items-center justify-center rounded-full ring-offset-2 ring-offset-popover transition-shadow ${
                            selected
                              ? 'ring-2 ring-foreground'
                              : 'ring-1 ring-border hover:ring-2 hover:ring-foreground/40'
                          }`}
                          style={{ backgroundColor: preset.value }}
                        >
                          {selected && <Check className="h-3.5 w-3.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" />}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedColorName ? `${selectedColorName} selected` : 'Choose a colour'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    className="flex-1"
                    onClick={() => createTagMutation.mutate()}
                    disabled={!newTagName.trim() || createTagMutation.isPending}
                  >
                    {createTagMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      'Create'
                    )}
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => setShowCreate(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Command>
                <CommandInput placeholder="Search tags..." />
                <CommandList>
                  <CommandEmpty>
                    <div className="py-2">
                      <p className="text-sm text-muted-foreground mb-2">No tags found</p>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => setShowCreate(true)}
                        className="gap-1"
                      >
                        <Plus className="h-3 w-3" />
                        Create new tag
                      </Button>
                    </div>
                  </CommandEmpty>
                  <CommandGroup>
                    {availableTags.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        onSelect={() => {
                          assignTagMutation.mutate(tag.id);
                          setOpen(false);
                        }}
                        className="gap-2"
                      >
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandGroup>
                    <CommandItem 
                      onSelect={() => setShowCreate(true)}
                      className="gap-2"
                    >
                      <Plus className="h-3 w-3" />
                      Create new tag
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
