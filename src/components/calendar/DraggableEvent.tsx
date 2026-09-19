import { useState, useRef } from 'react';
import { GHLEvent } from '@/hooks/useGHLCalendar';
import { cn } from '@/lib/utils';

interface DraggableEventProps {
  event: GHLEvent;
  children: React.ReactNode;
  onDragStart?: (event: GHLEvent) => void;
  onDragEnd?: (event: GHLEvent) => void;
  className?: string;
  disabled?: boolean;
}

export function DraggableEvent({
  event,
  children,
  onDragStart,
  onDragEnd,
  className,
  disabled = false,
}: DraggableEventProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);

  const handleDragStart = (e: React.DragEvent) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify(event));
    e.dataTransfer.setData('text/plain', event.id);
    
    // Set a custom drag image
    if (dragRef.current) {
      const rect = dragRef.current.getBoundingClientRect();
      e.dataTransfer.setDragImage(dragRef.current, rect.width / 2, 20);
    }
    
    onDragStart?.(event);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    onDragEnd?.(event);
  };

  return (
    <div
      ref={dragRef}
      draggable={!disabled}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={cn(
        'cursor-grab active:cursor-grabbing transition-all duration-200',
        isDragging && 'opacity-50 scale-95 ring-2 ring-primary/50',
        disabled && 'cursor-default',
        className
      )}
    >
      {children}
    </div>
  );
}
