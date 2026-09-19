import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { RotateCcw, Trash2, Archive } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface DeletedUser {
  id: string;
  username: string;
  email: string | null;
  deleted_at: string;
  created_at: string;
}

export function SoftDeletedUsersPanel() {
  const [deletedUsers, setDeletedUsers] = useState<DeletedUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDeletedUsers = async () => {
    try {
      const { data } = await invokeSecureFunction('admin-user-management', {
        action: 'list_users',
        include_deleted: true,
      });
      if (data?.success) {
        setDeletedUsers((data.users || []).filter((u: any) => u.deleted_at));
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeletedUsers();
  }, []);

  const handleRestore = async (userId: string) => {
    try {
      const { data } = await invokeSecureFunction('admin-user-management', {
        action: 'update_user',
        user_id: userId,
        is_active: true,
        restore: true,
      });
      if (data?.success) {
        toast.success('User restored successfully');
        fetchDeletedUsers();
      } else {
        toast.error(data?.error || 'Failed to restore user');
      }
    } catch {
      toast.error('Failed to restore user');
    }
  };

  const handlePurge = async (userId: string) => {
    try {
      const { data } = await invokeSecureFunction('admin-user-management', {
        action: 'purge_user',
        user_id: userId,
      });
      if (data?.success) {
        toast.success('User permanently deleted');
        fetchDeletedUsers();
      } else {
        toast.error(data?.error || 'Failed to purge user');
      }
    } catch {
      toast.error('Failed to purge user');
    }
  };

  if (deletedUsers.length === 0 && !loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Archive className="h-5 w-5 text-muted-foreground" />
          Deleted Users
        </CardTitle>
        <CardDescription>Soft-deleted users can be restored or permanently removed.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-4 text-muted-foreground text-sm">Loading...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Deleted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deletedUsers.map(u => (
                <TableRow key={u.id} className="opacity-70">
                  <TableCell>
                    <div>
                      <div className="font-medium">{u.username}</div>
                      <div className="text-xs text-muted-foreground">{u.email || 'No email'}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {formatDistanceToNow(new Date(u.deleted_at), { addSuffix: true })}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleRestore(u.id)}>
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Restore
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm">
                            <Trash2 className="h-3 w-3 mr-1" />
                            Purge
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Permanently Delete User?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently remove <strong>{u.username}</strong> and all associated data. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handlePurge(u.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              Permanently Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
