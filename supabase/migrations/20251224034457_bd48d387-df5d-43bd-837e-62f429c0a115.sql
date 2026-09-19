-- Promote the existing admin user to superadmin
INSERT INTO user_roles (user_id, role)
SELECT id, 'superadmin'::app_role
FROM custom_users
WHERE username = 'admin'
ON CONFLICT (user_id, role) DO NOTHING;

-- Add user_management module to dashboard_modules
INSERT INTO dashboard_modules (module_key, module_name, description, route, icon, category, sort_order)
VALUES ('user_management', 'User Management', 'Manage users, roles, and permissions', '/admin/users', 'Users', 'admin', 100)
ON CONFLICT (module_key) DO NOTHING;