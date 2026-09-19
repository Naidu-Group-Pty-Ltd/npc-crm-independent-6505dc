import { useCallNotifications } from '@/hooks/useCallNotifications';

export function CallNotificationListener() {
  useCallNotifications();
  return null;
}
