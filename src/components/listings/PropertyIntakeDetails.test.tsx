import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PropertyIntakeDetails } from './PropertyIntakeDetails';

const fieldsWithSourceLink = (sourceWebLink: string) => ({
  'Record Type': 'Property',
  'Source Web Link': sourceWebLink,
});

describe('PropertyIntakeDetails source web link', () => {
  it('renders an absolute HTTPS source as a link', () => {
    render(<PropertyIntakeDetails fields={fieldsWithSourceLink('https://example.com/listing')} />);

    expect(screen.getByRole('link', { name: /https:\/\/example\.com\/listing/i })).toHaveAttribute(
      'href',
      'https://example.com/listing',
    );
  });

  it('renders an active URL scheme as inert text', () => {
    const unsafeUrl = 'javascript:alert(document.domain)';
    render(<PropertyIntakeDetails fields={fieldsWithSourceLink(unsafeUrl)} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(unsafeUrl)).toBeInTheDocument();
  });
});
