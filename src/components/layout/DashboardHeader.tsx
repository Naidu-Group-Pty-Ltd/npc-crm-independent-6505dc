import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LogOut, Settings, Moon, Sun } from 'lucide-react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { SearchInput } from '@/components/ui/search-input';
import { useSearch } from '@/contexts/SearchContext';
import { useAuth } from '@/hooks/useAuth';
import { NotificationsDropdown } from './NotificationsDropdown';
import { TokenBalancePill } from '@/components/billing/TokenBalancePill';

type Theme = 'light' | 'dark' | 'system';

interface DashboardHeaderProps {
  theme: Theme;
  isDark: boolean;
  onCycleTheme: () => void;
}

export function DashboardHeader({ theme, isDark, onCycleTheme }: DashboardHeaderProps) {
  const { globalSearchQuery, setGlobalSearchQuery } = useSearch();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const getThemeIcon = () => {
    if (theme === 'system') {
      return isDark ? (
        <Sun className="h-5 w-5 text-primary" />
      ) : (
        <Moon className="h-5 w-5 text-muted-foreground" />
      );
    }
    return theme === 'dark' ? (
      <Sun className="h-5 w-5 text-primary" />
    ) : (
      <Moon className="h-5 w-5 text-muted-foreground" />
    );
  };

  const getThemeLabel = () => {
    if (theme === 'system') return 'System';
    return theme === 'dark' ? 'Dark' : 'Light';
  };

  const handleSearchChange = (value: string) => {
    setGlobalSearchQuery(value);
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      navigate('/listings');
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      navigate('/auth', { replace: true });
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <header className="dashboard-topbar-surface sticky top-0 z-40 hidden lg:block">
      <div className="dashboard-topbar-inner">
        <div className="flex items-center gap-4 flex-1">
          <div className="dashboard-icon-button flex h-10 w-10 items-center justify-center">
            <SidebarTrigger className="h-8 w-8 rounded-lg" />
          </div>
          
          <SearchInput
            value={globalSearchQuery}
            onValueChange={handleSearchChange}
            placeholder="Search properties..."
            onKeyPress={handleSearchKeyPress}
            containerClassName="max-w-md flex-1"
            className="dashboard-input-control h-11 border-0"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onCycleTheme}
            className="dashboard-icon-button relative h-10 w-10"
            title={`Theme: ${getThemeLabel()}`}
          >
            <div className="transition-transform duration-300 ease-out">
              {getThemeIcon()}
            </div>
            {theme === 'system' && (
              <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
            )}
            <span className="sr-only">Theme: {getThemeLabel()}</span>
          </Button>

          <TokenBalancePill />

          <NotificationsDropdown />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="dashboard-input-control h-10 px-2.5">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {user?.username?.substring(0, 2).toUpperCase() || 'AD'}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{user?.username || 'Admin'}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user?.username || 'Admin'}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user?.role || 'Administrator'}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} disabled={isSigningOut}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>{isSigningOut ? 'Signing out...' : 'Sign out'}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
