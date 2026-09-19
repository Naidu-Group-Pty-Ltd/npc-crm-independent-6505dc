// Common weak passwords to check against
const COMMON_PASSWORDS = [
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'qwertyuiop', 'abc12345', 'abcd1234', 'admin123',
  'letmein', 'welcome', 'welcome1', 'iloveyou', 'sunshine', 'princess',
  'football', 'baseball', 'dragon', 'master', 'monkey', 'shadow', 'ashley',
  'michael', 'trustno1', 'passw0rd', 'starwars', 'batman', 'superman'
];

export interface PasswordValidationResult {
  isValid: boolean;
  error: string | null;
  strength: 'weak' | 'fair' | 'good' | 'strong';
  score: number; // 0-4
}

/**
 * Validates password strength and returns detailed feedback
 * @param password - The password to validate
 * @returns Validation result with error message if invalid
 */
export function validatePassword(password: string): PasswordValidationResult {
  // Check minimum length (8 characters per industry standards)
  if (password.length < 8) {
    return {
      isValid: false,
      error: 'Password must be at least 8 characters',
      strength: 'weak',
      score: 0
    };
  }

  // Check against common passwords
  if (COMMON_PASSWORDS.includes(password.toLowerCase())) {
    return {
      isValid: false,
      error: 'Password is too common. Please choose a stronger password',
      strength: 'weak',
      score: 0
    };
  }

  // Calculate password strength score
  let score = 0;
  const checks = {
    hasLowercase: /[a-z]/.test(password),
    hasUppercase: /[A-Z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
    hasLength12: password.length >= 12
  };

  if (checks.hasLowercase) score++;
  if (checks.hasUppercase) score++;
  if (checks.hasNumber) score++;
  if (checks.hasSpecial) score++;
  if (checks.hasLength12) score++;

  // Determine strength level
  let strength: 'weak' | 'fair' | 'good' | 'strong';
  if (score <= 1) {
    strength = 'weak';
  } else if (score === 2) {
    strength = 'fair';
  } else if (score === 3 || score === 4) {
    strength = 'good';
  } else {
    strength = 'strong';
  }

  // Require at least 2 character types for minimum security
  const characterTypes = [checks.hasLowercase, checks.hasUppercase, checks.hasNumber, checks.hasSpecial]
    .filter(Boolean).length;

  if (characterTypes < 2) {
    return {
      isValid: false,
      error: 'Password must include at least 2 of: lowercase, uppercase, numbers, or special characters',
      strength: 'weak',
      score: Math.min(score, 4)
    };
  }

  return {
    isValid: true,
    error: null,
    strength,
    score: Math.min(score, 4)
  };
}

/**
 * Simple validation for edge functions (returns just boolean and error)
 */
export function validatePasswordSimple(password: string): { isValid: boolean; error: string | null } {
  const result = validatePassword(password);
  return { isValid: result.isValid, error: result.error };
}

/**
 * Get password strength color for UI display
 */
export function getStrengthColor(strength: 'weak' | 'fair' | 'good' | 'strong'): string {
  switch (strength) {
    case 'weak': return 'text-destructive';
    case 'fair': return 'text-warning';
    case 'good': return 'text-info';
    case 'strong': return 'text-success';
  }
}

/**
 * Get password strength background color for progress bars
 */
export function getStrengthBgColor(strength: 'weak' | 'fair' | 'good' | 'strong'): string {
  switch (strength) {
    case 'weak': return 'bg-destructive';
    case 'fair': return 'bg-warning';
    case 'good': return 'bg-info';
    case 'strong': return 'bg-success';
  }
}
