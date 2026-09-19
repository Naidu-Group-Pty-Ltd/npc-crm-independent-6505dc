import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTeamUsers } from '@/hooks/useTeamUsers';
import { UserCircle } from 'lucide-react';

interface TeamUserSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  allowUnassigned?: boolean;
}

export function TeamUserSelect({
  value,
  onValueChange,
  placeholder = 'Assign to...',
  className,
  allowUnassigned = true,
}: TeamUserSelectProps) {
  const { data: users = [], isLoading } = useTeamUsers();

  return (
    <Select value={value} onValueChange={onValueChange}>
      {/* SelectValue mirrors the chosen item's content into the trigger, so
          the two-line name+email block used to spill out of the fixed-height
          pill. The trigger hides the email line and truncates the name; the
          dropdown list still shows both. */}
      <SelectTrigger className={className}>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left [&_.team-user-email]:hidden">
          <UserCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            <SelectValue placeholder={isLoading ? 'Loading...' : placeholder} />
          </span>
        </div>
      </SelectTrigger>
      <SelectContent>
        {allowUnassigned && (
          <SelectItem value="unassigned">
            <span className="text-muted-foreground">Unassigned</span>
          </SelectItem>
        )}
        {users.map((user) => (
          <SelectItem key={user.id} value={user.id}>
            <div className="flex min-w-0 flex-col">
              <span className="truncate">{user.username}</span>
              {user.email && <span className="team-user-email max-w-[16rem] truncate text-xs text-muted-foreground">{user.email}</span>}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
