import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useAuth } from './useAuth';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface Permission {
  module_key: string;
  module_name: string;
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

interface PermissionsContextType {
  permissions: Permission[];
  roles: string[];
  isSuperadmin: boolean;
  isAdmin: boolean;
  loading: boolean;
  hasModuleAccess: (moduleKey: string) => boolean;
  canEdit: (moduleKey: string) => boolean;
  canDelete: (moduleKey: string) => boolean;
  refreshPermissions: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType | undefined>(undefined);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user, isSuperadmin: authIsSuperadmin, isAdmin: authIsAdmin, roles: authRoles, loading: authLoading } = useAuth();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  // Use roles from auth context (server-verified)
  const isSuperadmin = authIsSuperadmin;
  const isAdmin = authIsAdmin;
  const roles = authRoles;

  const fetchPermissions = useCallback(async () => {
    // Don't fetch if auth is still loading or no user
    if (authLoading) {
      return;
    }

    if (!user) {
      setPermissions([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      console.log('[Permissions] Fetching permissions for user:', user.username, 'isSuperadmin:', isSuperadmin);

      const { data, error } = await invokeSecureFunction<{
        success: boolean;
        permissions: Permission[];
        error?: string;
      }>('admin-user-management', { action: 'get_my_permissions' });

      if (error || !data?.success) {
        console.error('[Permissions] Secure permission lookup failed:', error || data?.error);
        setPermissions([]);
      } else if (Array.isArray(data.permissions)) {
        setPermissions(data.permissions.filter((p) => p.module_key && p.can_view));
      } else {
        setPermissions([]);
      }
    } catch (error) {
      console.error('[Permissions] Error in fetchPermissions:', error);
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, [user, authLoading, isSuperadmin]);

  // Fetch permissions when auth state changes and is ready
  useEffect(() => {
    // Only fetch when auth is no longer loading
    if (!authLoading) {
      console.log('[Permissions] Auth ready, fetching permissions. User:', user?.username, 'Roles:', roles);
      fetchPermissions();
    }
  }, [authLoading, user?.id, isSuperadmin, fetchPermissions]);

  const hasModuleAccess = useCallback((moduleKey: string): boolean => {
    if (moduleKey === '__always__') return true;
    if (moduleKey === '__superadmin_only__') return isSuperadmin;
    if (isSuperadmin) return true;
    const perm = permissions.find(p => p.module_key === moduleKey);
    return perm?.can_view || false;
  }, [isSuperadmin, permissions]);

  const canEdit = useCallback((moduleKey: string): boolean => {
    if (isSuperadmin) return true;
    const perm = permissions.find(p => p.module_key === moduleKey);
    return perm?.can_edit || false;
  }, [isSuperadmin, permissions]);

  const canDelete = useCallback((moduleKey: string): boolean => {
    if (isSuperadmin) return true;
    const perm = permissions.find(p => p.module_key === moduleKey);
    return perm?.can_delete || false;
  }, [isSuperadmin, permissions]);

  return (
    <PermissionsContext.Provider
      value={{
        permissions,
        roles,
        isSuperadmin,
        isAdmin,
        loading: loading || authLoading,
        hasModuleAccess,
        canEdit,
        canDelete,
        refreshPermissions: fetchPermissions,
      }}
    >
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const context = useContext(PermissionsContext);
  if (context === undefined) {
    throw new Error('usePermissions must be used within a PermissionsProvider');
  }
  return context;
}