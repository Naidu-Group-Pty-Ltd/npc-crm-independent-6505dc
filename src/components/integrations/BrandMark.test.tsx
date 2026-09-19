import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';

describe('BrandMark', () => {
  it('uses the fallback for inherited glyph-map property names', () => {
    render(
      <BrandMark
        integrationId="constructor"
        fallback={<span>Unknown provider</span>}
      />,
    );

    expect(screen.getByText('Unknown provider')).toBeInTheDocument();
  });
});
