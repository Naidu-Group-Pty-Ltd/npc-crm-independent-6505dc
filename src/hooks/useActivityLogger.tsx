import { useCallback } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';

// Action types matching the database enum
export type ActivityActionType =
  // Report actions
  | 'report_generated'
  | 'report_regenerated'
  | 'report_viewed'
  | 'report_edited'
  | 'report_archived'
  | 'report_deleted'
  | 'report_pdf_downloaded'
  | 'report_shared'
  | 'manual_override_applied'
  // Comparison actions
  | 'comparison_created'
  | 'comparison_viewed'
  | 'comparison_deleted'
  // Cash flow actions
  | 'cash_flow_created'
  | 'cash_flow_updated'
  | 'cash_flow_deleted'
  // Email actions
  | 'email_read'
  | 'email_reply_generated'
  | 'email_reply_sent'
  | 'email_linked_to_report'
  // Call log actions
  | 'call_tagged'
  | 'alert_rule_created'
  | 'alert_rule_updated'
  | 'alert_rule_deleted'
  | 'weekly_report_config_changed'
  // QA actions
  | 'qa_conversation_created'
  | 'qa_question_asked'
  | 'qa_conversation_deleted'
  // Automation actions
  | 'automation_switch_created'
  | 'automation_switch_enabled'
  | 'automation_switch_disabled'
  | 'automation_switch_deleted'
  | 'automation_master_toggle_changed'
  // Template actions
  | 'template_uploaded'
  | 'template_activated'
  | 'template_deactivated'
  | 'template_deleted'
  | 'branding_profile_created'
  | 'branding_profile_updated'
  | 'branding_profile_deleted'
  // User management actions
  | 'user_invited'
  | 'user_permissions_changed'
  | 'user_deactivated'
  | 'user_activated'
  | 'password_reset_initiated'
  // White label actions
  | 'whitelabel_settings_updated'
  | 'whitelabel_logo_changed'
  // Auth actions
  | 'login'
  | 'logout'
  // Bulk actions
  | 'bulk_generation_started'
  | 'bulk_generation_completed'
  // Client management actions
  | 'client_created'
  | 'client_updated'
  | 'client_deleted'
  | 'client_exported'
  | 'client_file_uploaded'
  | 'client_file_deleted'
  | 'client_note_added'
  | 'client_tag_added'
  | 'client_tag_removed'
  // Deal pipeline actions
  | 'deal_created'
  | 'deal_updated'
  | 'deal_stage_changed'
  | 'deal_deleted'
  | 'build_payment_updated'
  // Calendar actions
  | 'appointment_created'
  | 'appointment_updated'
  | 'appointment_deleted'
  | 'appointment_rescheduled'
  // Checklist actions
  | 'checklist_generated'
  | 'checklist_item_checked'
  | 'checklist_completed'
  | 'checklist_deleted'
  // Data actions
  | 'data_imported'
  // Blacklist actions
  | 'blacklist_entry_created'
  | 'blacklist_entry_updated'
  | 'blacklist_entry_deleted'
  // WhiteLabel extended
  | 'whitelabel_logo_uploaded'
  | 'whitelabel_logo_removed'
  | 'whitelabel_theme_changed'
  // Report extended
  | 'comparison_pdf_downloaded'
  | 'portfolio_report_generated'
  // Agency agreement actions
  | 'agreement_generated'
  | 'agreement_sent'
  | 'agreement_signed'
  | 'agreement_voided'
  // General
  | 'settings_updated'
  | 'data_exported';

// Entity types matching the database enum
export type ActivityEntityType =
  | 'investment_report'
  | 'property_comparison'
  | 'cash_flow_analysis'
  | 'email'
  | 'call_log'
  | 'call_alert_rule'
  | 'qa_conversation'
  | 'automation_switch'
  | 'template'
  | 'branding_profile'
  | 'user'
  | 'whitelabel_settings'
  | 'bulk_generation_job'
  | 'session'
  | 'system'
  | 'client'
  | 'deal'
  | 'client_file'
  | 'client_note'
  | 'appointment'
  | 'checklist'
  | 'data_import'
  | 'portfolio_report'
  | 'agency_agreement'
  | 'blacklisted_number';

interface LogActivityParams {
  actionType: ActivityActionType;
  entityType: ActivityEntityType;
  entityId?: string;
  entityName?: string;
  metadata?: Record<string, unknown>;
}

interface UseActivityLoggerReturn {
  logActivity: (params: LogActivityParams) => Promise<void>;
}

// Get user info from sessionStorage (set by auth context)
const getCurrentUser = (): { userId: string; username: string } | null => {
  try {
    // Check sessionStorage for cached user data (set by auth context)
    const cachedUser = sessionStorage.getItem('current_user');
    if (cachedUser) {
      const user = JSON.parse(cachedUser);
      if (user.id && user.username) {
        return {
          userId: user.id,
          username: user.username
        };
      }
    }
    
    return null;
  } catch {
    return null;
  }
};

export function useActivityLogger(): UseActivityLoggerReturn {
  const logActivity = useCallback(async (params: LogActivityParams) => {
    const { actionType, entityType, entityId, entityName, metadata } = params;
    
    try {
      const user = getCurrentUser();
      
      // Log via edge function for better security and IP tracking
      const { error } = await invokeSecureFunction('log-activity', {
        user_id: user?.userId || null,
        username: user?.username || 'Unknown',
        action_type: actionType,
        entity_type: entityType,
        entity_id: entityId,
        entity_name: entityName,
        metadata: metadata || {}
      });

      if (error) {
        console.error('[ActivityLogger] Failed to log activity:', error);
      }
    } catch (error) {
      // Don't throw - activity logging should never break the app
      console.error('[ActivityLogger] Error logging activity:', error);
    }
  }, []);

  return { logActivity };
}

// Direct function interface for non-hook usage (like in useAuth)
interface DirectLogParams {
  userId?: string;
  username?: string;
  actionType: ActivityActionType;
  entityType: ActivityEntityType;
  entityId?: string;
  entityName?: string;
  metadata?: Record<string, unknown>;
}

// Utility function for logging without hook (for use in non-component code like useAuth)
export async function logActivity(params: DirectLogParams): Promise<void> {
  const { userId, username, actionType, entityType, entityId, entityName, metadata } = params;
  
  try {
    // If userId/username not provided, try to get from session
    let finalUserId = userId;
    let finalUsername = username;
    
    if (!finalUserId || !finalUsername) {
      const user = getCurrentUser();
      finalUserId = finalUserId || user?.userId || undefined;
      finalUsername = finalUsername || user?.username || 'Unknown';
    }
    
    const { error } = await invokeSecureFunction('log-activity', {
      user_id: finalUserId || null,
      username: finalUsername || 'Unknown',
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      metadata: metadata || {}
    });

    if (error) {
      console.error('[ActivityLogger] Failed to log activity:', error);
    }
  } catch (error) {
    console.error('[ActivityLogger] Error logging activity:', error);
  }
}

// Alias for backwards compatibility
export const logActivityDirect = logActivity;
