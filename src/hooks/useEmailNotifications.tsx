import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getNotificationBadge, getNotificationIcon } from '@/lib/desktopMessageAlerts';

interface EmailNotificationOptions {
  onNewEmail?: (email: any) => void;
  soundEnabled?: boolean;
  browserNotificationsEnabled?: boolean;
}

// Notification sound as a base64 encoded short beep
const NOTIFICATION_SOUND_URL = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleC8LQo3s6rF1EAxOjfrfn14HDT5m5ubBnWkOF2C099yTWgoUQ3Dt4rhyCRJMau3fsn4TGHe26MZ/HAhqkcPWtGEKEVN+y9K+dRMbbZy/zaNnEhpnk7rQpGIMJHqgyL+BTyA7nK60s58tKiR/vcG3llIqO6W2ppi4gDQvVJq7uKqNUT5vnq2msYpOPmZ+fG+Yo2RXdYaCe4ZzZHh4dHx8dHh4c3x8eHJ1cnR2c3JycnV4d3d0cXVycXBxcnJycHBxcXFxcXFxcXFwcXBwcHBxcXBwcHBwcHBwcHBwcHBwcHBwb3BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwb3BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw';

export function useEmailNotifications({
  onNewEmail,
  soundEnabled = true,
  browserNotificationsEnabled = true
}: EmailNotificationOptions = {}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const notificationPermissionRef = useRef<NotificationPermission>('default');

  // Initialize audio element
  useEffect(() => {
    audioRef.current = new Audio(NOTIFICATION_SOUND_URL);
    audioRef.current.volume = 0.5;
    
    return () => {
      if (audioRef.current) {
        audioRef.current = null;
      }
    };
  }, []);

  // Request notification permission
  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      console.log('Browser does not support notifications');
      return false;
    }

    if (Notification.permission === 'granted') {
      notificationPermissionRef.current = 'granted';
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      notificationPermissionRef.current = permission;
      return permission === 'granted';
    }

    return false;
  }, []);

  // Play notification sound
  const playNotificationSound = useCallback(() => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(err => {
        console.log('Could not play notification sound:', err);
      });
    }
  }, [soundEnabled]);

  // Show browser notification
  const showBrowserNotification = useCallback((title: string, body: string) => {
    if (browserNotificationsEnabled && notificationPermissionRef.current === 'granted') {
      try {
        const notification = new Notification(title, {
          body,
          // White-label mark where one is configured, Aurixa Systems otherwise
          // — never the scaffold's stock icon.
          icon: getNotificationIcon(),
          badge: getNotificationBadge(),
          tag: 'email-notification',
          requireInteraction: false
        });

        notification.onclick = () => {
          window.focus();
          notification.close();
        };

        setTimeout(() => notification.close(), 5000);
      } catch (err) {
        console.log('Could not show notification:', err);
      }
    }
  }, [browserNotificationsEnabled]);

  // Handle new email notification (sound + browser notification only — no toast)
  // Bell notifications are handled server-side, toasts are batched by useGlobalEmailNotifications
  const handleNewEmail = useCallback(async (email: any) => {
    // Play sound
    playNotificationSound();

    const senderName = email.sender?.split('@')[0] || 'Unknown';
    const subject = email.subject || 'No subject';

    // Show browser notification
    showBrowserNotification(
      `New email from ${senderName}`,
      subject
    );

    // Call custom handler
    onNewEmail?.(email);
  }, [playNotificationSound, showBrowserNotification, onNewEmail]);

  // Set up realtime subscription
  useEffect(() => {
    // Request permission on mount
    requestNotificationPermission();

    // Subscribe to new emails
    const channel = supabase
      .channel('email-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'email_copilot_emails'
        },
        (payload) => {
          console.log('New email received via realtime:', payload);
          handleNewEmail(payload.new);
        }
      )
      .subscribe((status) => {
        console.log('Email notification subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [handleNewEmail, requestNotificationPermission]);

  return {
    requestNotificationPermission,
    playNotificationSound,
    showBrowserNotification
  };
}
