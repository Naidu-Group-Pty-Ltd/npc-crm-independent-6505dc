/**
 * The Reminders hub renders whatever priority a reminder actually carries.
 *
 * `client_reminders.priority` accepts four values and every form that writes a
 * reminder offers all four, but the hub's badge came from a three-key map
 * indexed unguarded. One reminder marked Urgent threw
 * `TypeError: Cannot read properties of undefined (reading 'color')` during
 * render, and the dashboard's error boundary replaced the page with "Something
 * went wrong" — so the whole hub went dark over one row, with no filter able to
 * exclude the row that was doing it.
 *
 * This renders the real page rather than the badge module, because the defect
 * was in the call site and a unit test of a total function cannot see it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { REMINDER_PRIORITIES } from '@/lib/reminders/priority.pure';

vi.mock('@/hooks/useModulePermissions', () => ({
  useModulePermissions: () => ({
    canView: true,
    canEdit: true,
    canDelete: true,
    includedInPlan: true,
    decision: null,
    loading: false,
  }),
}));

// The team tab and the write surfaces are not what is under test, and each
// pulls in the whole mutation stack.
vi.mock('@/components/reminders/TeamRemindersSection', () => ({ TeamRemindersSection: () => null }));
vi.mock('@/components/reminders/CreateReminderForm', () => ({ CreateReminderForm: () => null }));
vi.mock('@/components/reminders/ReminderActions', () => ({ ReminderActions: () => null }));

const reminders: Array<Record<string, unknown>> = [];
vi.mock('@/hooks/useAllReminders', () => ({
  useAllReminders: () => ({ data: reminders, isLoading: false }),
}));

import RemindersHub from '../RemindersHub';

function reminderWith(priority: string, title: string) {
  return {
    id: `cr-${priority}`,
    title,
    description: null,
    // Tomorrow, so the row lands in a group and is drawn whatever the day.
    due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    priority,
    status: 'pending',
    source: 'client_reminder',
    source_label: 'Client Reminder',
    reminder_type: 'task',
    client_id: 'client-1',
    client_name: 'A Client',
    completed_at: null,
    created_at: new Date().toISOString(),
    raw_source: 'client_reminders',
    raw_id: priority,
  };
}

function renderHub(rows: Array<Record<string, unknown>>) {
  reminders.splice(0, reminders.length, ...rows);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RemindersHub />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RemindersHub priority badges', () => {
  it.each([...REMINDER_PRIORITIES])('draws a %s reminder without throwing', priority => {
    renderHub([reminderWith(priority, `A ${priority} reminder`)]);
    expect(screen.getByText(`A ${priority} reminder`)).toBeTruthy();
  });

  it('draws an urgent reminder — the row that took the page down', () => {
    renderHub([reminderWith('urgent', 'Chase the contract')]);
    expect(screen.getByText('Chase the contract')).toBeTruthy();
    expect(screen.getAllByText('Urgent').length).toBeGreaterThan(0);
  });

  it('does not lose the rest of the list to one unrecognised priority', () => {
    // A value outside the constraint should cost its own badge's precision and
    // nothing else — never the other reminders on the page.
    renderHub([
      reminderWith('critical', 'Row from a widened column'),
      { ...reminderWith('high', 'An ordinary reminder'), id: 'cr-ordinary', raw_id: 'ordinary' },
    ]);
    expect(screen.getByText('An ordinary reminder')).toBeTruthy();
    expect(screen.getByText('Row from a widened column')).toBeTruthy();
  });

  it('counts an urgent reminder as high priority', () => {
    // The figure exists to surface escalated work; excluding the most escalated
    // value from it reported 0 beside an urgent item.
    const { container } = renderHub([reminderWith('urgent', 'Chase the contract')]);
    const card = [...container.querySelectorAll('div')].find(
      el => el.textContent?.trim() === 'High Priority',
    );
    expect(card).toBeTruthy();
    expect(card?.closest('div.relative')?.textContent).toContain('1');
  });
});
