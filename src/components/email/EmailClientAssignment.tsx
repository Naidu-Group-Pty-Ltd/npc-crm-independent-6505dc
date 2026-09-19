import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import { User, UserPlus, X, Loader2, Link as LinkIcon, ExternalLink } from 'lucide-react';

interface Client {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  primary_email: string | null;
}

interface EmailClientAssignmentProps {
  emailId: string;
  currentClientId: string | null;
  currentClientName: string | null;
  onAssignmentChange?: (clientId: string | null, clientName: string | null) => void;
}

export function EmailClientAssignment({
  emailId,
  currentClientId,
  currentClientName,
  onAssignmentChange,
}: EmailClientAssignmentProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch clients when popover opens
  useEffect(() => {
    if (isOpen && clients.length === 0) {
      fetchClients();
    }
  }, [isOpen]);

  const fetchClients = async () => {
    setIsLoadingClients(true);
    try {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'clients',
          select: 'id,primary_first_name,primary_surname,primary_email',
          orderBy: 'primary_surname',
          order_asc: true,
          limit: 2000,
        },
      });

      if (error) throw error;

      setClients(data?.clients || data?.records || []);
    } catch (err) {
      console.error('Error fetching clients:', err);
      toast.error('Failed to load clients');
    } finally {
      setIsLoadingClients(false);
    }
  };

  const handleAssign = async (clientId: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await invokeSecureFunction('email-copilot', {
        action: 'assign_client',
        emailId,
        clientId,
      });

      if (error) throw error;

      const client = clients.find(c => c.id === clientId);
      const clientName = client 
        ? `${client.primary_first_name || ''} ${client.primary_surname || ''}`.trim()
        : null;

      toast.success('Email assigned to client');
      onAssignmentChange?.(clientId, clientName);
      setIsOpen(false);
    } catch (err) {
      console.error('Error assigning client:', err);
      toast.error('Failed to assign email to client');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnassign = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await invokeSecureFunction('email-copilot', {
        action: 'assign_client',
        emailId,
        clientId: null,
      });

      if (error) throw error;

      toast.success('Email unassigned from client');
      onAssignmentChange?.(null, null);
      setIsOpen(false);
    } catch (err) {
      console.error('Error unassigning client:', err);
      toast.error('Failed to unassign email');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredClients = clients.filter(client => {
    if (!searchQuery) return true;
    const fullName = `${client.primary_first_name || ''} ${client.primary_surname || ''}`.toLowerCase();
    const email = (client.primary_email || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return fullName.includes(query) || email.includes(query);
  });

  const formatClientName = (client: Client) => {
    return `${client.primary_first_name || ''} ${client.primary_surname || ''}`.trim() || 'Unnamed Client';
  };

  const handleNavigateToClient = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentClientId) {
      navigate(`/clients?clientId=${currentClientId}`);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {currentClientId && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="secondary" 
                className="cursor-pointer hover:bg-primary/15 gap-1.5 py-1 px-2.5 border border-primary/20 bg-primary/5 text-primary"
                onClick={handleNavigateToClient}
              >
                <User className="h-3 w-3" />
                <span className="truncate max-w-[160px] font-medium">{currentClientName || 'Linked Client'}</span>
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Click to view client profile</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          {currentClientId ? (
            <Button 
              variant="ghost" 
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                handleUnassign();
              }}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-muted-foreground hover:text-foreground">
              <LinkIcon className="h-3.5 w-3.5" />
              <span className="text-xs">Link to Client</span>
            </Button>
          )}
        </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="p-3 border-b">
          <SearchInput
            value={searchQuery}
            onValueChange={setSearchQuery}
            placeholder="Search clients..."
            className="h-8"
            iconClassName="left-2.5"
          />
        </div>
        <ScrollArea className="max-h-[300px]">
          {isLoadingClients ? (
            <div className="p-4 text-center">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
              <p className="text-xs text-muted-foreground mt-2">Loading clients...</p>
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-sm text-muted-foreground">
                {searchQuery ? 'No clients found' : 'No clients available'}
              </p>
            </div>
          ) : (
            <div className="p-1">
              {filteredClients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => handleAssign(client.id)}
                  disabled={isLoading || client.id === currentClientId}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    client.id === currentClientId 
                      ? 'bg-primary/10 text-primary cursor-default' 
                      : 'hover:bg-muted'
                  }`}
                >
                  <div className="font-medium">{formatClientName(client)}</div>
                  {client.primary_email && (
                    <div className="text-xs text-muted-foreground truncate">
                      {client.primary_email}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
    </div>
  );
}
