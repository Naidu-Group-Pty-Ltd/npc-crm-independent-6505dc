import { useState, useCallback, useEffect, useRef } from 'react';
import { 
  UnifiedOverrideData, 
  OVERRIDE_FIELD_CONFIG, 
  getFieldConfig,
  BuildType
} from '@/types/overrideFields';

type OverrideValues = Record<string, string | number | boolean | undefined | { [key: number]: number }>;

interface UseOverrideStateOptions {
  initialValues?: Partial<UnifiedOverrideData>;
  externalValues?: Partial<UnifiedOverrideData>;
  onChange?: (data: UnifiedOverrideData) => void;
}

/**
 * Unified state management hook for override fields
 * Used by both PreGenerationOverrides and ManualDataOverrideModal
 */
export function useOverrideState(options: UseOverrideStateOptions = {}) {
  const { initialValues = {}, externalValues = {}, onChange } = options;
  
  // Initialize values with defaults from config
  const getDefaultValues = useCallback((): OverrideValues => {
    const defaults: OverrideValues = {};
    OVERRIDE_FIELD_CONFIG.forEach(field => {
      if (field.defaultValue !== undefined) {
        defaults[field.key] = field.defaultValue;
      }
    });
    return { ...defaults, buildType: 'existing_property', ...initialValues };
  }, [initialValues]);

  const [values, setValues] = useState<OverrideValues>(getDefaultValues);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Track external value changes to avoid infinite loops
  const lastExternalValues = useRef<Partial<UnifiedOverrideData>>({});

  // Sync external values when they change
  useEffect(() => {
    if (externalValues) {
      const changedKeys = Object.keys(externalValues).filter(key => {
        const externalVal = externalValues[key as keyof UnifiedOverrideData];
        const lastVal = lastExternalValues.current[key as keyof UnifiedOverrideData];
        return externalVal !== lastVal;
      });

      if (changedKeys.length > 0) {
        setValues(prev => {
          const newValues = { ...prev };
          changedKeys.forEach(key => {
            const externalVal = externalValues[key as keyof UnifiedOverrideData];
            if (externalVal !== undefined) {
              newValues[key] = externalVal as string | number | boolean;
            }
          });
          return newValues;
        });
        lastExternalValues.current = { ...externalValues };
      }
    }
  }, [externalValues]);

  // Notify parent of changes
  useEffect(() => {
    if (onChange) {
      const data = convertToUnifiedData(values);
      onChange(data);
    }
  }, [values, onChange]);

  // Update a single field
  const setValue = useCallback((key: string, value: string | number | boolean) => {
    setValues(prev => {
      if (prev[key] === value) return prev;
      setHasChanges(true);
      return { ...prev, [key]: value };
    });
  }, []);

  // Update multiple fields at once
  const setMultipleValues = useCallback((updates: OverrideValues) => {
    setValues(prev => {
      setHasChanges(true);
      return { ...prev, ...updates };
    });
  }, []);

  // Reset to initial/default values
  const reset = useCallback(() => {
    setValues(getDefaultValues());
    setHasChanges(false);
  }, [getDefaultValues]);

  // Get current build type
  const buildType = (values.buildType as BuildType) || 'existing_property';

  // Get value with proper type conversion
  const getValue = useCallback((key: string): string | number | boolean | { [key: number]: number } | undefined => {
    return values[key];
  }, [values]);

  // Get numeric value
  const getNumericValue = useCallback((key: string): number | undefined => {
    const val = values[key];
    if (val === undefined || val === '' || val === null) return undefined;
    const parsed = parseFloat(val.toString());
    return isNaN(parsed) ? undefined : parsed;
  }, [values]);

  // Get string value
  const getStringValue = useCallback((key: string): string => {
    const val = values[key];
    if (val === undefined || val === null) return '';
    return val.toString();
  }, [values]);

  // Get boolean value
  const getBooleanValue = useCallback((key: string): boolean => {
    return Boolean(values[key]);
  }, [values]);

  return {
    values,
    setValue,
    setMultipleValues,
    reset,
    hasChanges,
    setHasChanges,
    buildType,
    getValue,
    getNumericValue,
    getStringValue,
    getBooleanValue,
    // Computed values
    isNewBuild: buildType === 'new_build',
    isLandOnly: buildType === 'land_only'
  };
}

/**
 * Convert internal values to UnifiedOverrideData
 */
export function convertToUnifiedData(values: OverrideValues): UnifiedOverrideData {
  const data: UnifiedOverrideData = {
    buildType: (values.buildType as BuildType) || 'existing_property'
  };

  // Convert each field based on its type in config
  OVERRIDE_FIELD_CONFIG.forEach(field => {
    const val = values[field.key];
    if (val === undefined || val === '' || val === null) return;

    if (field.type === 'toggle') {
      (data as any)[field.key] = Boolean(val);
    } else if (field.type === 'currency' || field.type === 'percentage' || field.type === 'number') {
      const parsed = parseFloat(val.toString());
      if (!isNaN(parsed)) {
        (data as any)[field.key] = parsed;
      }
    } else if (field.type === 'select') {
      (data as any)[field.key] = val;
    }
  });

  return data;
}

/**
 * Computed field calculations
 */
export function useComputedOverrides(
  values: OverrideValues,
  setValue: (key: string, value: string | number | boolean) => void
) {
  const buildType = values.buildType as BuildType;
  const purchasePrice = parseFloat(values.purchasePrice?.toString() || '0') || 0;
  const loanToValueRatio = parseFloat(values.loanToValueRatio?.toString() || '80') || 80;
  const weeklyRent = parseFloat(values.weeklyRent?.toString() || '0') || 0;
  const strataAdminFund = parseFloat(values.strataAdminFund?.toString() || '0') || 0;
  const strataSinkingFund = parseFloat(values.strataSinkingFund?.toString() || '0') || 0;
  const strataSpecialLevies = parseFloat(values.strataSpecialLevies?.toString() || '0') || 0;

  // Auto-calculate deposit from Purchase Price and LVR (for existing properties and land only)
  useEffect(() => {
    if ((buildType === 'existing_property' || buildType === 'land_only') && purchasePrice > 0) {
      const deposit = purchasePrice * ((100 - loanToValueRatio) / 100);
      const depositStr = Math.round(deposit).toString();
      const currentDeposit = values.depositValue?.toString() || '';
      if (currentDeposit !== depositStr) {
        setValue('depositValue', depositStr);
      }
    }
  }, [buildType, purchasePrice, loanToValueRatio, setValue, values.depositValue]);

  // Auto-calculate letting fees = weekly rent
  useEffect(() => {
    if (weeklyRent > 0) {
      const rentStr = weeklyRent.toString();
      const currentLetting = values.lettingFees?.toString() || '';
      if (currentLetting !== rentStr) {
        setValue('lettingFees', rentStr);
      }
    }
  }, [weeklyRent, setValue, values.lettingFees]);

  // Auto-calculate body corporate = admin + sinking + special levies
  useEffect(() => {
    const total = strataAdminFund + strataSinkingFund + strataSpecialLevies;
    if (total > 0) {
      const totalStr = total.toString();
      const currentBody = values.bodyCorporateFees?.toString() || '';
      if (currentBody !== totalStr) {
        setValue('bodyCorporateFees', totalStr);
      }
    }
  }, [strataAdminFund, strataSinkingFund, strataSpecialLevies, setValue, values.bodyCorporateFees]);

  // Return computed values for display
  const occupancyRate = parseFloat(values.occupancyRate?.toString() || '52') || 52;
  const annualRent = weeklyRent * occupancyRate;
  const pmPercent = parseFloat(values.propertyManagementFees?.toString() || '8') || 8;
  const pmDollar = Math.round(annualRent * (pmPercent / 100));
  
  const loanAmount = Math.round(purchasePrice * (loanToValueRatio / 100));
  const interestRate = parseFloat(values.interestRate?.toString() || '6.5') || 6.5;
  const monthlyInterest = Math.round((loanAmount * (interestRate / 100)) / 12);

  return {
    annualRent,
    pmDollar,
    loanAmount,
    monthlyInterest
  };
}
