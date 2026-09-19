import { useState } from 'react';
import { GHLEvent } from '@/hooks/useGHLCalendar';
import { cn } from '@/lib/utils';

interface DropZoneProps {
  date: Date;
  hour?: number;
  onDrop: (event: GHLEvent, date: Date, hour?: number) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function DropZone({
  date,
  hour,
  onDrop,
  children,
  className,
  disabled = false,
}: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only trigger if leaving the element entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    setIsDragOver(false);

    try {
      const eventData = e.dataTransfer.getData('application/json');
      if (eventData) {
        const event: GHLEvent = JSON.parse(eventData);
        onDrop(event, date, hour);
      }
    } catch (err) {
      console.error('Failed to parse dropped event:', err);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'transition-all duration-200',
        isDragOver && !disabled && 'bg-primary/20 ring-2 ring-primary/40 ring-inset',
        className
      )}
    >
      {children}
    </div>
  );
}
