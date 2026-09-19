import { describe, it, expect } from 'vitest';
import {
  shouldInterceptNavigation,
  type AnchorNavigationDescriptor,
  type NavigationModifiers,
} from '../useUnsavedChangesGuard';

const current = { origin: 'https://app.test', pathname: '/admin/template-builder/abc', search: '' };
const plain: NavigationModifiers = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

function intercept(
  anchor: AnchorNavigationDescriptor,
  modifiers: NavigationModifiers = plain,
  defaultPrevented = false,
) {
  return shouldInterceptNavigation({ anchor, modifiers, defaultPrevented, current });
}

describe('shouldInterceptNavigation', () => {
  it('guards a plain same-origin in-app navigation (absolute or relative href)', () => {
    expect(intercept({ href: 'https://app.test/admin/templates' })).toBe(true);
    expect(intercept({ href: '/admin/templates' })).toBe(true);
  });

  it('ignores navigation to the exact same route', () => {
    expect(intercept({ href: 'https://app.test/admin/template-builder/abc' })).toBe(false);
  });

  it('ignores in-page hash links (same pathname + search)', () => {
    expect(intercept({ href: 'https://app.test/admin/template-builder/abc#section' })).toBe(false);
  });

  it('ignores navigation to a different origin', () => {
    expect(intercept({ href: 'https://example.com/foo' })).toBe(false);
  });

  it('lets new-tab / modified clicks through', () => {
    expect(intercept({ href: '/admin/templates' }, { ...plain, metaKey: true })).toBe(false);
    expect(intercept({ href: '/admin/templates' }, { ...plain, ctrlKey: true })).toBe(false);
    expect(intercept({ href: '/admin/templates' }, { ...plain, shiftKey: true })).toBe(false);
    expect(intercept({ href: '/admin/templates' }, { ...plain, button: 1 })).toBe(false);
  });

  it('ignores target=_blank and download links', () => {
    expect(intercept({ href: '/admin/templates', target: '_blank' })).toBe(false);
    expect(intercept({ href: '/files/x.pdf', hasDownload: true })).toBe(false);
  });

  it('treats an explicit _self target like a normal in-app link', () => {
    expect(intercept({ href: '/admin/templates', target: '_self' })).toBe(true);
  });

  it('respects events whose default was already prevented', () => {
    expect(intercept({ href: '/admin/templates' }, plain, true)).toBe(false);
  });

  it('ignores anchors without an href', () => {
    expect(intercept({ href: '' })).toBe(false);
  });
});
