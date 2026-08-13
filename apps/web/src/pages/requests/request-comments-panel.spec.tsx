// @vitest-environment jsdom
/**
 * The request discussion.
 *
 * WHAT ONLY A COMPONENT TEST REACHES. The interesting behaviour is what the panel DOESN'T do — it must not
 * refetch the request list for a write that changes no request state, and it must not send a body the API
 * will trim to nothing. Neither is visible in a browser: a redundant refetch looks identical to a correct
 * one, and a rejected empty comment looks like a user mistake.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const GET = vi.fn();
const POST = vi.fn();
const toastError = vi.fn();

vi.mock('@/shared/api/client', () => ({
  api: { GET: (...a: unknown[]) => GET(...a), POST: (...a: unknown[]) => POST(...a) },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m) } }));

import { RequestCommentsPanel } from './request-comments-panel';

const COMMENT = {
  id: 'c-1',
  requestId: 'r-1',
  authorId: 'emp-1',
  body: 'Which cost centre should this go against?',
  editedAt: null,
  createdAt: '2026-08-01T09:00:00.000Z',
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <RequestCommentsPanel requestId="r-1" />
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

describe('RequestCommentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    GET.mockResolvedValue({ data: [COMMENT], error: undefined });
    POST.mockResolvedValue({ error: undefined });
  });

  it('posts a trimmed body and refetches only the thread', async () => {
    const { invalidate } = renderPanel();
    expect(await screen.findByText(/Which cost centre/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: '  Cost centre 4400.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    expect(POST.mock.calls[0][0]).toBe('/v1/requests/{id}/comments');
    // Trimmed here, because the API trims too — sending the padding means the stored body and the one this
    // screen validated as non-empty are two different strings.
    expect(POST.mock.calls[0][1]).toEqual({
      params: { path: { id: 'r-1' } },
      body: { body: 'Cost centre 4400.' },
    });

    /*
     * ONLY THE THREAD. A comment "does not affect request state" — the API's own words — so invalidating
     * the whole `['requests']` prefix would refetch a page of rows to learn nothing, on every comment.
     */
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['requests', 'comments', 'r-1'] }),
    );
    expect(
      invalidate.mock.calls.some(
        (call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey) === '["requests"]',
      ),
    ).toBe(false);
  });

  it('refuses a whitespace-only comment without a round trip', async () => {
    renderPanel();
    expect(await screen.findByText(/Which cost centre/)).toBeTruthy();

    const submit = screen.getByRole('button', { name: 'Post comment' });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: '   ' } });
    // Still disabled: the API trims and then refuses an empty body, so this would be a round trip whose
    // only product is an error message about something the screen already knew.
    expect(screen.getByRole('button', { name: 'Post comment' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(POST).not.toHaveBeenCalled();
  });

  it('marks an edited comment as edited', async () => {
    GET.mockResolvedValue({
      data: [{ ...COMMENT, editedAt: '2026-08-02T09:00:00.000Z' }],
      error: undefined,
    });
    renderPanel();

    // The API carries `editedAt`; a thread that showed an edited comment as untouched would be hiding the
    // one thing a discussion record must not hide.
    expect(await screen.findByText(/edited/)).toBeTruthy();
  });

  it('passes the API’s refusal through instead of inventing one', async () => {
    POST.mockResolvedValue({
      error: { error: { message: 'You are not a party to this request' } },
    });
    renderPanel();
    expect(await screen.findByText(/Which cost centre/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'Anything.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('You are not a party to this request'),
    );
  });
});
