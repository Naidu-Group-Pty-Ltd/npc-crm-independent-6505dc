/**
 * Aurixa primitives — shared design-system barrel.
 *
 * Phase 1 introduces GlassCard, SectionEmptyState, BreadcrumbRail, and
 * re-exports the existing Aurixa primitives from the agent surface. Phases
 * 2–7 will register MetricTile, KpiRow, AuroraHero, TimelineRail,
 * KanbanColumn, GlassModal, Stepper, DetailDrawer, and ToolCallCard here.
 *
 * Consumers should always import from `@/components/aurixa` so we can
 * refactor internals without touching call sites.
 */
export { GlassCard } from './GlassCard';
export type { GlassCardProps, GlassCardElevation } from './GlassCard';

export { SectionEmptyState } from './SectionEmptyState';
export type { SectionEmptyStateProps, SectionEmptyStateAction } from './SectionEmptyState';

export { BreadcrumbRail } from './BreadcrumbRail';
export type { BreadcrumbRailProps } from './BreadcrumbRail';

export { AuroraHero } from './AuroraHero';
export type { AuroraHeroProps } from './AuroraHero';

export { MetricTile } from './MetricTile';
export type { MetricTileProps, MetricTileTone, MetricTileDelta } from './MetricTile';

export { KpiRow } from './KpiRow';
export type { KpiRowProps } from './KpiRow';

export { DataTableToolbar } from './DataTableToolbar';
export type { DataTableToolbarProps, TableDensity } from './DataTableToolbar';

export { BulkActionBar } from './BulkActionBar';
export type { BulkActionBarProps } from './BulkActionBar';

export { KanbanColumn } from './KanbanColumn';
export type { KanbanColumnProps, KanbanColumnTone } from './KanbanColumn';

export { KanbanCard } from './KanbanCard';
export type {
  KanbanCardProps,
  KanbanCardRisk,
  KanbanCardAssignee,
  KanbanCardMetaEntry,
} from './KanbanCard';

export { TimelineRail } from './TimelineRail';
export type {
  TimelineRailProps,
  TimelineEvent,
  TimelineEventTone,
  TimelineFilter,
} from './TimelineRail';

export { GlassModal, GlassModalActions } from './GlassModal';
export type { GlassModalProps, GlassModalActionsProps, GlassModalSize } from './GlassModal';

export { DetailDrawer } from './DetailDrawer';
export type { DetailDrawerProps, DetailDrawerWidth } from './DetailDrawer';

export { Stepper } from './Stepper';
export type { StepperProps, StepperStep } from './Stepper';

export { FormField } from './FormField';
export type { FormFieldProps, FormFieldRenderArgs } from './FormField';

export { SuggestionChips } from './SuggestionChips';
export type { SuggestionChipsProps, SuggestionChip } from './SuggestionChips';

export { ToolCallCard } from './ToolCallCard';
export type { ToolCallCardProps, ToolCallStatus } from './ToolCallCard';

export { ModelBadge } from './ModelBadge';
export type { ModelBadgeProps } from './ModelBadge';

export { VoiceWaveform } from './VoiceWaveform';
export type { VoiceWaveformProps } from './VoiceWaveform';

export { ShimmerText } from './ShimmerText';
export type { ShimmerTextProps } from './ShimmerText';

export { ReportTocRail } from './ReportTocRail';
export type { ReportTocRailProps, ReportTocRailSection } from './ReportTocRail';

export { ReportActionDock } from './ReportActionDock';
export type { ReportActionDockProps, ReportActionDockAction } from './ReportActionDock';

export { ReportCoverHero } from './ReportCoverHero';
export type { ReportCoverHeroProps } from './ReportCoverHero';

export { ReportGroupedList } from './ReportGroupedList';
export type { ReportGroupedListProps, ReportGroupedListGroup } from './ReportGroupedList';










// Re-export existing Aurixa primitives so consumers have one import path.
export { AurixaMark } from '@/components/agent/AurixaMark';
export { AurixaSectionHeader } from '@/components/agent/AurixaSectionHeader';
export { StatusPill } from '@/components/agent/StatusPill';
