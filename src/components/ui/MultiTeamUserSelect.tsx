import { useState } from 'react';
import { useTeamUsers } from '@/hooks/useTeamUsers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, ChevronsUpDown, UserCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MultiTeamUserSelectProps {
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiTeamUserSelect({
  value,
  onValueChange,
  placeholder = 'Assign team members...',
  className,
}: MultiTeamUserSelectProps) {
  const { data: users = [], isLoading } = useTeamUsers();
  const [open, setOpen] = useState(false);

  const toggleUser = (userId: string) => {
    if (value.includes(userId)) {
      onValueChange(value.filter(id => id !== userId));
    } else {
      onValueChange([...value, userId]);
    }
  };

  const removeUser = (userId: string) => {
    onValueChange(value.filter(id => id !== userId));
  };

  const selectedUsers = users.filter(u => value.includes(u.id));

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between h-auto min-h-10 py-1.5"
          >
            <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
              <UserCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {selectedUsers.length === 0 ? (
                <span className="text-muted-foreground text-sm">
                  {isLoading ? 'Loading...' : placeholder}
                </span>
              ) : (
                selectedUsers.map(user => (
                  <Badge
                    key={user.id}
                    variant="secondary"
                    className="text-xs gap-1 pr-1"
                  >
                    {user.username}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeUser(user.id);
                      }}
                      className="hover:text-destructive"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))
              )}
            </div>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[250px] p-0" align="start">
          <ScrollArea className="max-h-[200px]">
            <div className="p-1">
              {users.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {isLoading ? 'Loading...' : 'No team members found'}
                </p>
              ) : (
                users.map(user => (
                  <button
                    key={user.id}
                    onClick={() => toggleUser(user.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors text-left',
                      value.includes(user.id) && 'bg-accent'
                    )}
                  >
                    <Check
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        value.includes(user.id) ? 'opacity-100 text-primary' : 'opacity-0'
                      )}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{user.username}</span>
                      {user.email && (
                        <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}
