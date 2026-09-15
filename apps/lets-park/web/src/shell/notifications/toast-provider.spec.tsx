import { render, screen, waitFor } from '@testing-library/react';
import { IntlProvider } from '@lets-park/i18n';
import cs from '../../../messages/cs.json';
import { ToastProvider, useNotify } from './toast-provider';

function Wrapper({ children }: { readonly children: React.ReactNode }) {
  return (
    <IntlProvider locale="cs" messages={cs}>
      <ToastProvider>{children}</ToastProvider>
    </IntlProvider>
  );
}

function Caller({
  message,
  tone,
}: {
  readonly message: string | null;
  readonly tone: 'danger' | 'success';
}) {
  useNotify(message, tone);
  return null;
}

describe('ToastProvider / useNotify', () => {
  it('renders nothing when message is null', () => {
    render(<Caller message={null} tone="danger" />, { wrapper: Wrapper });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the message when non-null, with the tone-appropriate role', async () => {
    render(<Caller message="something failed" tone="danger" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('something failed'));
  });

  it('retracts the toast when message becomes null', async () => {
    const { rerender } = render(<Caller message="oops" tone="danger" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    rerender(<Caller message={null} tone="danger" />);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('retracts the toast when the calling component unmounts', async () => {
    const { unmount } = render(<Caller message="bye" tone="danger" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    unmount();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows two independently-driven toasts from the same component at once', async () => {
    function TwoCallers() {
      useNotify('first', 'danger');
      useNotify('second', 'success');
      return null;
    }
    render(<TwoCallers />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('first')).toBeInTheDocument();
      expect(screen.getByText('second')).toBeInTheDocument();
    });
  });

  it('throws when useNotify is called outside a ToastProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Caller message="x" tone="danger" />)).toThrow(
      'useNotify must be used within a ToastProvider'
    );
    spy.mockRestore();
  });
});
