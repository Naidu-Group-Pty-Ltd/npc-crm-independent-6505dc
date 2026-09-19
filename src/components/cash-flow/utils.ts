import type { BuildType, BuildTypeFilter, DateRangeFilter } from './types';

export const DATE_RANGE_OPTIONS: Array<{ value: DateRangeFilter; label: string }> = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
];

export const BUILD_TYPE_FILTER_OPTIONS: Array<{ value: BuildTypeFilter; label: string }> = [
  { value: 'all', label: 'All Build Types' },
  { value: 'new_build', label: 'New Build' },
  { value: 'existing_property', label: 'Existing Property' },
  { value: 'land_only', label: 'Land Only' },
];

export const getBuildTypeLabel = (buildType: BuildType) => {
  if (buildType === 'new_build') return 'New Build';
  if (buildType === 'land_only') return 'Land Only';
  return 'Existing';
};
