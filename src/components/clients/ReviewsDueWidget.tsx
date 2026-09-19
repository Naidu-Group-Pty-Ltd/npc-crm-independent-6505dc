import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  ClipboardCheck, 
  Calendar, 
  ChevronRight, 
  AlertTriangle,
  User
} from 'lucide-react';
import { format, isPast, isWithinInterval, addDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface ReviewsDueClient {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  review_frequency: string | null;
  next_review_due: string | null;
  last_review_date: string | null;
  total_portfolio_value: number | null;
}

export function ReviewsDueWidget() {
  const navigate = useNavigate();

  const { data: clientsDue = [], isLoading } = useQuery({
    queryKey: ['clients-reviews-due'],
    queryFn: async () => {
      const today = new Date();
      const thirtyDaysFromNow = addDays(today, 30);
      
      const { data, error } = await invokeSecureFunction<{ success: boolean; clients: ReviewsDueClient[] }>('get-client-data', {
        listMode: true,
        listOptions: {
          select: 'id, primary_first_name, primary_surname, review_frequency, next_review_due, last_review_date, total_portfolio_value',
          orderBy: 'next_review_due',
          orderAsc: true,
          limit: 10,
        },
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error('Failed to fetch clients');
      
      // Filter for reviews due within 30 days
      return (data.clients || []).filter((c: ReviewsDueClient) => 
        c.next_review_due && new Date(c.next_review_due) <= thirtyDaysFromNow
      ) as ReviewsDueClient[];
    },
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });

  const getReviewStatus = (nextDue: string | null) => {
    if (!nextDue) return 'scheduled';
    const dueDate = new Date(nextDue);
    const today = new Date();
    
    if (isPast(dueDate)) return 'overdue';
    if (isWithinInterval(dueDate, { start: today, end: addDays(today, 7) })) return 'due-soon';
    return 'upcoming';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'overdue':
        return <Badge variant="destructive" className="text-xs">Overdue</Badge>;
      case 'due-soon':
        return <Badge variant="default" className="text-xs bg-brand-500">Due Soon</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">Upcoming</Badge>;
    }
  };

  const formatCurrency = (value: number | null) => {
    if (!value) return '-';
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const overdueCount = clientsDue.filter(c => getReviewStatus(c.next_review_due) === 'overdue').length;
  const dueSoonCount = clientsDue.filter(c => getReviewStatus(c.next_review_due) === 'due-soon').length;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            Reviews Due
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            Reviews Due
          </CardTitle>
          <div className="flex gap-2">
            {overdueCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {overdueCount} Overdue
              </Badge>
            )}
            {dueSoonCount > 0 && (
              <Badge className="text-xs bg-brand-500">
                {dueSoonCount} This Week
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {clientsDue.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No reviews due in the next 30 days</p>
          </div>
        ) : (
          <ScrollArea className="h-[200px]">
            <div className="space-y-2">
              {clientsDue.map(client => {
                const status = getReviewStatus(client.next_review_due);
                return (
                  <div
                    key={client.id}
                    className="flex items-center justify-between p-2 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/clients?clientId=${client.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${status === 'overdue' ? 'bg-destructive/10' : status === 'due-soon' ? 'bg-brand-500/10' : 'bg-muted'}`}>
                        {status === 'overdue' ? (
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                        ) : (
                          <User className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {client.primary_first_name} {client.primary_surname}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatCurrency(client.total_portfolio_value)}</span>
                          <span>•</span>
                          <span className="capitalize">{client.review_frequency || 'annual'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        {getStatusBadge(status)}
                        <p className="text-xs text-muted-foreground mt-1">
                          {client.next_review_due ? format(new Date(client.next_review_due), 'dd MMM yyyy') : '-'}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
        <Button 
          variant="ghost" 
          className="w-full mt-2" 
          size="sm"
          onClick={() => navigate('/clients?filter=reviews_due')}
        >
          View All Reviews Due
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
