import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, X, LogOut, Settings, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSearch } from '@/contexts/SearchContext';
import { useAuth } from '@/hooks/useAuth';
import { NotificationsDropdown } from './NotificationsDropdown';
import { MobileSidebar } from './MobileSidebar';
import { BrandLockup } from '@/components/branding/BrandAssets';
import { TokenBalancePill } from '@/components/billing/TokenBalancePill';

type Theme = 'light' | 'dark' | 'system';

interface MobileHeaderProps {
  theme: Theme;
  isDark: boolean;
  onCycleTheme: () => void;
}

export function MobileHeader({ theme, isDark, onCycleTheme }: MobileHeaderProps) {
  const { globalSearchQuery, setGlobalSearchQuery } = useSearch();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGlobalSearchQuery(e.target.value);
  };

  const handleSearchSubmit = () => {
    if (globalSearchQuery.trim()) {
      navigate('/listings');
      setIsSearchOpen(false);
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

  const getThemeIcon = () => {
    if (theme === 'system') {
      return isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />;
    }
    return theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />;
  };

  return (
    <>
      {/* Search Overlay */}
      {isSearchOpen && (
        <div className="dashboard-mobile-search-overlay fixed inset-0 z-50">
          <div className="dashboard-topbar-surface flex items-center gap-2 p-3">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsSearchOpen(false)}
               className="dashboard-icon-button h-11 w-11 shrink-0"
               aria-label="Close search"
            >
              <X className="h-5 w-5" />
            </Button>
            <Input
              type="text"
              placeholder="Search properties..."
              value={globalSearchQuery}
              onChange={handleSearchChange}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
              className="dashboard-input-control h-11 flex-1 border-0"
              autoFocus
            />
            <Button 
              variant="default" 
              size="sm"
              onClick={handleSearchSubmit}
              className="rounded-xl"
            >
              Search
            </Button>
          </div>
          
          {/* Quick Search Suggestions */}
          <div className="p-4">
            <p className="text-sm text-muted-foreground mb-3">Quick filters</p>
            <div className="flex flex-wrap gap-2">
              {['NSW', 'VIC', 'QLD', 'House', 'Apartment'].map((term) => (
                <Button
                  key={term}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setGlobalSearchQuery(term);
                    navigate('/listings');
                    setIsSearchOpen(false);
                  }}
                >
                  {term}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Header */}
      <header className="dashboard-topbar-surface sticky top-0 z-40 lg:hidden">
        <div className="dashboard-topbar-inner">
          {/* Left: Menu + Logo */}
          <div className="flex items-center gap-2">
            <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="dashboard-icon-button h-11 w-11 shrink-0" aria-label="Open navigation menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="dashboard-mobile-sheet w-[280px] p-0" hideClose>
                <MobileSidebar onNavigate={() => setIsSidebarOpen(false)} />
              </SheetContent>
            </Sheet>
            
            <BrandLockup
              slot="sidebar-icon"
              meta="Command centre"
              className="dashboard-brand-lockup"
              logoClassName="brand-logo-compact"
              fallbackClassName="h-7 w-7"
              companyClassName="max-w-[132px] text-sm"
              metaClassName="tracking-[0.16em]"
            />
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsSearchOpen(true)}
              className="dashboard-icon-button h-11 w-11"
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={onCycleTheme}
              className="dashboard-icon-button h-11 w-11"
              aria-label="Change theme"
            >
              {getThemeIcon()}
            </Button>

            <TokenBalancePill compact />

            <NotificationsDropdown />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="dashboard-icon-button h-11 w-11" aria-label="Account menu">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary/10 text-xs text-primary">
                      {user?.username?.substring(0, 2).toUpperCase() || 'AD'}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{user?.username || 'Admin'}</p>
                    <p className="text-xs text-muted-foreground">{user?.role || 'Administrator'}</p>
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
    </>
  );
}
