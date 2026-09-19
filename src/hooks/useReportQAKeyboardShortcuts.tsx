import { useEffect, useCallback } from 'react';

interface KeyboardShortcutsConfig {
  onNewChat: () => void;
  onOpenHistory: () => void;
  onCloseDialogs: () => void;
  onFocusInput?: () => void;
  onCopyLastResponse?: () => void;
  onScrollToBottom?: () => void;
  onToggleReportsPanel?: () => void;
}

export function useReportQAKeyboardShortcuts({
  onNewChat,
  onOpenHistory,
  onCloseDialogs,
  onFocusInput,
  onCopyLastResponse,
  onScrollToBottom,
  onToggleReportsPanel,
}: KeyboardShortcutsConfig) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const cmdKey = isMac ? e.metaKey : e.ctrlKey;

    // Cmd/Ctrl + K - Open history search
    if (cmdKey && e.key === 'k') {
      e.preventDefault();
      onOpenHistory();
      return;
    }

    // Cmd/Ctrl + N - New chat
    if (cmdKey && e.key === 'n') {
      e.preventDefault();
      onNewChat();
      return;
    }

    // Cmd/Ctrl + / - Focus input
    if (cmdKey && e.key === '/' && onFocusInput) {
      e.preventDefault();
      onFocusInput();
      return;
    }

    // Cmd/Ctrl + Shift + C - Copy last response
    if (cmdKey && e.shiftKey && e.key === 'C' && onCopyLastResponse) {
      e.preventDefault();
      onCopyLastResponse();
      return;
    }

    // Cmd/Ctrl + J - Scroll to bottom
    if (cmdKey && e.key === 'j' && onScrollToBottom) {
      e.preventDefault();
      onScrollToBottom();
      return;
    }

    // Cmd/Ctrl + B - Toggle reports panel
    if (cmdKey && e.key === 'b' && onToggleReportsPanel) {
      e.preventDefault();
      onToggleReportsPanel();
      return;
    }

    // Escape - Close dialogs
    if (e.key === 'Escape') {
      onCloseDialogs();
      return;
    }
  }, [onNewChat, onOpenHistory, onCloseDialogs, onFocusInput, onCopyLastResponse, onScrollToBottom, onToggleReportsPanel]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

export const keyboardShortcutsHelp = [
  { keys: ['⌘', 'K'], description: 'Search history' },
  { keys: ['⌘', 'N'], description: 'New chat' },
  { keys: ['⌘', '/'], description: 'Focus input' },
  { keys: ['⌘', '⇧', 'C'], description: 'Copy last response' },
  { keys: ['⌘', 'J'], description: 'Scroll to bottom' },
  { keys: ['⌘', 'B'], description: 'Toggle reports panel' },
  { keys: ['Esc'], description: 'Close dialogs' },
];
