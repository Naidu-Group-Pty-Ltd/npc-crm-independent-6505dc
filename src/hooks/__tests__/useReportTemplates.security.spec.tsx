import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useReportTemplate, useReportTemplates } from '../useReportTemplates';

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: vi.fn() }));

const invokeSecureFunctionMock = vi.mocked(invokeSecureFunction);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('report template read authorization', () => {
  beforeEach(() => {
    invokeSecureFunctionMock.mockReset();
  });

  it('fails closed when the secured list operation is forbidden', async () => {
    invokeSecureFunctionMock.mockResolvedValue({
      data: null,
      error: { message: 'templates:view permission required' },
    } as never);

    const { result } = renderHook(() => useReportTemplates(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error('templates:view permission required'));
    expect(invokeSecureFunctionMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the secured get operation is forbidden', async () => {
    invokeSecureFunctionMock.mockResolvedValue({
      data: null,
      error: { message: 'templates:view permission required' },
    } as never);

    const { result } = renderHook(() => useReportTemplate('template-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error('templates:view permission required'));
    expect(invokeSecureFunctionMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty secured list without attempting another data source', async () => {
    invokeSecureFunctionMock.mockResolvedValue({ data: { records: [] }, error: null } as never);

    const { result } = renderHook(() => useReportTemplates(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(invokeSecureFunctionMock).toHaveBeenCalledTimes(1);
  });
});
