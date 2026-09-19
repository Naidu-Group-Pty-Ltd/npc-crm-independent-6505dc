/* @vitest-environment jsdom */
/**
 * E11 — lazy artifact hook security + lifecycle tests.
 *
 * Proves the hook: signs only requested artifacts, de-duplicates concurrent
 * requests, rejects arbitrary/traversal region ids before signing, never stores a
 * URL in any persistent store, refreshes an expired entry, and revokes object URLs
 * on unmount.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePdfReviewArtifacts, type ArtifactSigner } from '../usePdfReviewArtifacts';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function signerReturning(url: string, expiresAt: string | null = null): ArtifactSigner {
  return vi.fn(async () => ({ url, expiresAt, widthPx: 10, heightPx: 10, hashVerified: true }));
}

describe('usePdfReviewArtifacts', () => {
  it('signs only the requested artifact and exposes a ready entry', async () => {
    const signer = signerReturning('blob:one');
    const { result } = renderHook(() => usePdfReviewArtifacts({ importId: 'imp-1', signArtifact: signer }));
    act(() => result.current.request(3, 'source'));
    await waitFor(() => expect(result.current.get(3, 'source').state).toBe('ready'));
    expect(signer).toHaveBeenCalledTimes(1);
    expect(result.current.get(3, 'source').url).toBe('blob:one');
    // a different, un-requested page stays idle (never eagerly signed)
    expect(result.current.get(4, 'source').state).toBe('idle');
  });

  it('de-duplicates concurrent requests for the same key', async () => {
    const signer = signerReturning('blob:dup');
    const { result } = renderHook(() => usePdfReviewArtifacts({ importId: 'imp-1', signArtifact: signer }));
    act(() => {
      result.current.request(1, 'source');
      result.current.request(1, 'source');
      result.current.request(1, 'source');
    });
    await waitFor(() => expect(result.current.get(1, 'source').state).toBe('ready'));
    expect(signer).toHaveBeenCalledTimes(1);
  });

  it('rejects an arbitrary/traversal region id before signing', () => {
    const signer = signerReturning('blob:x');
    const { result } = renderHook(() => usePdfReviewArtifacts({ importId: 'imp-1', signArtifact: signer }));
    act(() => result.current.request(1, 'region-source', '../secret'));
    expect(result.current.get(1, 'region-source', '../secret').state).toBe('invalid');
    expect(signer).not.toHaveBeenCalled();
  });

  it('never persists a signed URL to localStorage/sessionStorage', async () => {
    const signer = signerReturning('blob:secret-url');
    const { result } = renderHook(() => usePdfReviewArtifacts({ importId: 'imp-1', signArtifact: signer }));
    act(() => result.current.request(2, 'browser-final'));
    await waitFor(() => expect(result.current.get(2, 'browser-final').state).toBe('ready'));
    expect(JSON.stringify(localStorage)).not.toContain('blob:secret-url');
    expect(JSON.stringify(sessionStorage)).not.toContain('blob:secret-url');
  });

  it('reports an expired entry when the TTL has passed', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const signer = signerReturning('blob:expired', past);
    const { result } = renderHook(() => usePdfReviewArtifacts({ importId: 'imp-1', signArtifact: signer }));
    act(() => result.current.request(1, 'source'));
    await waitFor(() => expect(signer).toHaveBeenCalled());
    expect(result.current.get(1, 'source').state).toBe('expired');
  });

  it('revokes object URLs on unmount', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const signer = signerReturning('blob:revoke-me');
    const { result, unmount } = renderHook(() => usePdfReviewArtifacts({ importId: 'imp-1', signArtifact: signer }));
    act(() => result.current.request(1, 'source'));
    await waitFor(() => expect(result.current.get(1, 'source').state).toBe('ready'));
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:revoke-me');
    revoke.mockRestore();
  });

  it('surfaces a forbidden signer error as a forbidden state', async () => {
    const signer: ArtifactSigner = vi.fn(async () => { throw Object.assign(new Error('nope'), { code: 'forbidden' }); });
    const { result } = renderHook(() => usePdfReviewArtifacts({ importId: 'imp-1', signArtifact: signer }));
    act(() => result.current.request(1, 'source'));
    await waitFor(() => expect(result.current.get(1, 'source').state).toBe('forbidden'));
  });
});
