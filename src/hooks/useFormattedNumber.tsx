import { useState, useCallback } from 'react';

/**
 * Formats a number with commas for display
 */
export function formatNumberWithCommas(value: string | number): string {
  if (value === '' || value === null || value === undefined) return '';
  
  // Remove existing commas and non-numeric characters except decimal point and minus
  const numericValue = String(value).replace(/[^0-9.-]/g, '');
  
  if (numericValue === '' || numericValue === '-') return numericValue;
  
  // Split by decimal point
  const parts = numericValue.split('.');
  const integerPart = parts[0];
  const decimalPart = parts.length > 1 ? '.' + parts[1] : '';
  
  // Add commas to integer part
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  return formattedInteger + decimalPart;
}

/**
 * Removes commas from a formatted number string
 */
export function removeCommas(value: string): string {
  if (!value) return '';
  return value.replace(/,/g, '');
}

/**
 * Hook for managing a formatted number input
 * Returns display value (with commas) and raw value (without commas)
 */
export function useFormattedNumber(
  initialValue: string = '',
  onChange?: (rawValue: string) => void
) {
  const [displayValue, setDisplayValue] = useState(() => 
    formatNumberWithCommas(initialValue)
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    
    // Remove commas to get raw value
    const rawValue = removeCommas(input);
    
    // Validate that it's a valid number format
    if (rawValue === '' || rawValue === '-' || /^-?\d*\.?\d*$/.test(rawValue)) {
      setDisplayValue(formatNumberWithCommas(rawValue));
      onChange?.(rawValue);
    }
  }, [onChange]);

  const setValue = useCallback((value: string) => {
    setDisplayValue(formatNumberWithCommas(value));
  }, []);

  return {
    displayValue,
    handleChange,
    setValue,
    rawValue: removeCommas(displayValue)
  };
}

export default useFormattedNumber;
