import { Calendar } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';

interface MessageDateSeparatorProps {
  date: Date;
}

export function MessageDateSeparator({ date }: MessageDateSeparatorProps) {
  const getDateLabel = () => {
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'EEEE, MMMM d, yyyy');
  };

  const getShortDateLabel = () => {
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'EEE, MMM d, yyyy');
  };

  return (
    <div className="flex items-center gap-3 py-4">
      <div className="flex-1 h-px bg-border" />
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full whitespace-nowrap">
        <Calendar className="h-3 w-3" />
        <span className="hidden sm:inline">{getDateLabel()}</span>
        <span className="sm:hidden">{getShortDateLabel()}</span>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// Helper function to check if we need a date separator between two messages
export function shouldShowDateSeparator(
  currentDate: Date,
  previousDate: Date | null
): boolean {
  if (!previousDate) return true;
  
  return (
    currentDate.getDate() !== previousDate.getDate() ||
    currentDate.getMonth() !== previousDate.getMonth() ||
    currentDate.getFullYear() !== previousDate.getFullYear()
  );
}
