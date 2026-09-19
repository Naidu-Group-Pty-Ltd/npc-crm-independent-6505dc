import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickAddAppointmentModal } from './QuickAddAppointmentModal';

vi.mock('@/hooks/useFinanceContacts', () => ({
  useFinanceContacts: () => ({ contacts: [], isLoading: false }),
}));

vi.mock('./TeamOutlookAvailability', () => ({
  TeamOutlookAvailability: () => null,
}));

Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false });
Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => undefined });
Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => undefined });

const calendars = [
  { id: 'calendar-a', name: 'Calendar A', calendarType: 'event', isActive: true },
  { id: 'calendar-b', name: 'Calendar B', calendarType: 'event', isActive: true },
  { id: 'calendar-c', name: 'Calendar C', calendarType: 'event', isActive: true },
];

const renderModal = () => render(
  <QuickAddAppointmentModal
    open
    onOpenChange={vi.fn()}
    calendars={calendars}
    defaultDate={new Date(2026, 6, 24)}
    defaultHour={9}
    isLoading={false}
    onSubmit={vi.fn().mockResolvedValue(true)}
  />,
);

const changeCalendar = async (name: string) => {
  fireEvent.pointerDown(screen.getAllByRole('combobox')[0]);
  fireEvent.click(await screen.findByText(name));
};

describe('QuickAddAppointmentModal', () => {
  it('keeps the complete appointment draft across repeated calendar changes', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom Meeting' }));
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Customer strategy session' } });
    fireEvent.change(screen.getByLabelText('Date *'), { target: { value: '2026-07-30' } });
    fireEvent.change(screen.getByLabelText('Time *'), { target: { value: '14:30' } });
    fireEvent.click(screen.getByRole('button', { name: /45 min/i }));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Bring finance documents' } });

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Alex Guest' } });
    fireEvent.change(screen.getByPlaceholderText('Email *'), { target: { value: 'alex@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add invite recipient' }));
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Blair Guest' } });
    fireEvent.change(screen.getByPlaceholderText('Email *'), { target: { value: 'blair@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add invite recipient' }));

    await changeCalendar('Calendar B');
    await changeCalendar('Calendar C');

    expect(screen.getByRole('button', { name: 'Zoom Meeting' })).toHaveClass('bg-primary');
    expect(screen.getByLabelText('Title *')).toHaveValue('Customer strategy session');
    expect(screen.getByLabelText('Date *')).toHaveValue('2026-07-30');
    expect(screen.getByLabelText('Time *')).toHaveValue('14:30');
    expect(screen.getByLabelText('Notes')).toHaveValue('Bring finance documents');
    expect(screen.getByText('Alex Guest')).toBeInTheDocument();
    expect(screen.getByText('Blair Guest')).toBeInTheDocument();
  });

  it('renders accessible date and time picker triggers that open their native controls', () => {
    const showDatePicker = vi.fn();
    const showTimePicker = vi.fn();
    renderModal();

    const dateInput = screen.getByLabelText('Date *') as HTMLInputElement & { showPicker: () => void };
    const timeInput = screen.getByLabelText('Time *') as HTMLInputElement & { showPicker: () => void };
    dateInput.showPicker = showDatePicker;
    timeInput.showPicker = showTimePicker;

    fireEvent.click(screen.getByRole('button', { name: 'Open date picker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open time picker' }));

    expect(showDatePicker).toHaveBeenCalledOnce();
    expect(showTimePicker).toHaveBeenCalledOnce();
  });
});

/**
 * Audit item 22: the title was written once inside the contact picker and
 * nothing ever revisited it, so choosing "Zoom Meeting" and a client and then
 * switching to "Phone Call" sent out a booking still named "Zoom Meeting
 * with <client>".
 *
 * The rule: a SUGGESTION follows the type; a title the operator typed is
 * theirs. Both halves matter — re-deriving without the second would silently
 * overwrite somebody's wording every time they changed a dropdown.
 */
describe('QuickAddAppointmentModal title suggestion', () => {
  const searchContacts = vi.fn().mockResolvedValue([
    { id: 'c1', name: 'Lavan Ravin', email: 'lavan@example.com' },
  ]);

  const renderWithContacts = () => render(
    <QuickAddAppointmentModal
      open
      onOpenChange={vi.fn()}
      calendars={calendars}
      defaultDate={new Date(2026, 6, 24)}
      defaultHour={9}
      isLoading={false}
      onSubmit={vi.fn().mockResolvedValue(true)}
      onSearchContacts={searchContacts}
    />,
  );

  const pickContact = async () => {
    fireEvent.change(
      screen.getByPlaceholderText('Search contacts by name, email, or phone...'),
      { target: { value: 'Lavan' } },
    );
    fireEvent.click(await screen.findByText('Lavan Ravin'));
  };

  const chooseType = (label: string) =>
    fireEvent.click(screen.getByText(label).closest('button')!);

  it('follows the appointment type once a contact is chosen', async () => {
    renderWithContacts();
    chooseType('Zoom Meeting');
    await pickContact();

    const title = screen.getByLabelText('Title *') as HTMLInputElement;
    expect(title.value).toBe('Zoom Meeting with Lavan Ravin');

    chooseType('Phone Call');
    expect(title.value).toBe('Phone Call with Lavan Ravin');
  });

  it('never overwrites a title the operator typed', async () => {
    renderWithContacts();
    chooseType('Zoom Meeting');
    await pickContact();

    const title = screen.getByLabelText('Title *') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Annual portfolio review' } });

    chooseType('Phone Call');
    chooseType('In Person');

    expect(title.value).toBe('Annual portfolio review');
  });

  it('suggests nothing before a contact is chosen', () => {
    renderWithContacts();
    chooseType('Zoom Meeting');

    expect((screen.getByLabelText('Title *') as HTMLInputElement).value).toBe('');
  });
});
