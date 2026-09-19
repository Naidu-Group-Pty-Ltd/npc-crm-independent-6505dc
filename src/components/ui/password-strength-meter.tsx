import { validatePassword, getStrengthBgColor, getStrengthColor } from '@/utils/passwordValidation';
import { cn } from '@/lib/utils';

interface PasswordStrengthMeterProps {
  password: string;
  className?: string;
}

export function PasswordStrengthMeter({ password, className }: PasswordStrengthMeterProps) {
  if (!password) return null;

  const result = validatePassword(password);
  const widthPercent = ((result.score + 1) / 5) * 100;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div 
          className={cn("h-full transition-all duration-300", getStrengthBgColor(result.strength))}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
      <p className={cn(
        "text-xs capitalize",
        getStrengthColor(result.strength)
      )}>
        Password strength: {result.strength}
      </p>
    </div>
  );
}
