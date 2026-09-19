import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tag, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConversationTagsProps {
  tags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  compact?: boolean;
}

const predefinedTags = [
  { name: 'Important', color: 'bg-destructive/20 text-destructive border-destructive/30' },
  { name: 'Follow-up', color: 'bg-brand-500/20 text-brand-600 border-brand-500/30' },
  { name: 'Reviewed', color: 'bg-success/20 text-success border-success/30' },
  { name: 'Client Ready', color: 'bg-info/20 text-info border-info/30' },
  { name: 'Archive', color: 'bg-muted/20 text-muted-foreground border-border/30' },
];

const getTagColor = (tag: string) => {
  const predefined = predefinedTags.find(t => t.name.toLowerCase() === tag.toLowerCase());
  return predefined?.color || 'bg-primary/20 text-primary border-primary/30';
};

export function ConversationTags({ tags, onAddTag, onRemoveTag, compact }: ConversationTagsProps) {
  const [newTag, setNewTag] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const handleAddCustomTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      onAddTag(newTag.trim());
      setNewTag('');
    }
  };

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            className={cn("text-[10px] h-4 px-1.5", getTagColor(tag))}
          >
            {tag}
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="report-qa-toolbar-control h-8 gap-1.5 px-3 text-xs font-medium"
          data-active={tags.length > 0 ? 'true' : undefined}
          title="Conversation tags"
        >
          <Tag className="h-3 w-3" />
          Tags
          {tags.length > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {tags.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-3">
          <div className="text-sm font-medium">Conversation Tags</div>
          
          {/* Current tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className={cn("gap-1 pr-1", getTagColor(tag))}
                >
                  {tag}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-3 w-3 p-0 hover:bg-transparent"
                    onClick={() => onRemoveTag(tag)}
                  >
                    <X className="h-2 w-2" />
                  </Button>
                </Badge>
              ))}
            </div>
          )}

          {/* Predefined tags */}
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">Quick add</div>
            <div className="flex flex-wrap gap-1.5">
              {predefinedTags
                .filter(t => !tags.includes(t.name))
                .map((tag) => (
                  <Badge
                    key={tag.name}
                    variant="outline"
                    className={cn("cursor-pointer hover:opacity-80", tag.color)}
                    onClick={() => onAddTag(tag.name)}
                  >
                    <Plus className="h-2.5 w-2.5 mr-0.5" />
                    {tag.name}
                  </Badge>
                ))}
            </div>
          </div>

          {/* Custom tag input */}
          <div className="flex gap-1.5">
            <Input
              placeholder="Custom tag..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              className="h-7 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddCustomTag();
                }
              }}
            />
            <Button
              size="sm"
              className="h-7 px-2"
              onClick={handleAddCustomTag}
              disabled={!newTag.trim()}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
