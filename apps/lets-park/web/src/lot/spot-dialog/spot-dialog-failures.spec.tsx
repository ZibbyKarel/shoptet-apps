/**
 * The one `SpotDialog` spec file that mocks `next-intl`'s `useTranslations`:
 * every assertion here checks the message *key* the failure block resolved
 * to, not the Czech sentence behind it, so a copy edit in `messages/cs.json`
 * can't fail a test that isn't about copy
 * (see `apps/lets-park/web/src/testing/mock-translations.ts`). Split out from
 * `spot-dialog.spec.tsx`, which keeps asserting on the real rendered Czech
 * for everything that isn't a `ScreenError` failure block.
 */
import { screen } from '@testing-library/react';
import { mockedT } from '../../testing/mock-translations';
import { failureWithCode } from '../../testing/contract-failure';
import { renderDialog } from './spot-dialog.test-helpers';

describe('SpotDialog — failures', () => {
  it('renders a contract error by its code, never by its message', async () => {
    // The error carries a developer-facing English `message`, which must not
    // reach the page; the rendered copy comes from the code.
    const error = await failureWithCode('SPOT_ALREADY_RESERVED');
    renderDialog({ error });

    expect(screen.getByText(mockedT('SPOT_ALREADY_RESERVED'))).toBeInTheDocument();
    expect(screen.queryByText('developer-facing')).not.toBeInTheDocument();
  });

  it('renders the window codes the two write actions can raise', async () => {
    const locked = await failureWithCode('RESERVATIONS_LOCKED');
    renderDialog({ error: locked });

    expect(screen.getByText(mockedT('RESERVATIONS_LOCKED'))).toBeInTheDocument();
  });

  it('renders `errorMessage` instead of the code-mapped copy when the caller supplies one', async () => {
    const error = await failureWithCode('RESERVATION_LIMIT_REACHED');
    renderDialog({
      error,
      errorMessage: 'a caller-supplied sentence',
    });

    expect(screen.getByText('a caller-supplied sentence')).toBeInTheDocument();
    expect(screen.queryByText(mockedT('RESERVATION_LIMIT_REACHED'))).not.toBeInTheDocument();
  });

  it('falls back to one generic sentence for a failure that is not in the contract', () => {
    renderDialog({ error: new TypeError('Failed to fetch') });

    expect(screen.getByText(mockedT('errorUnknown'))).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });

  it('shows no failure alert when there is no failure', () => {
    renderDialog();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces a failure as an alert, not a heading', async () => {
    const error = await failureWithCode('SPOT_ALREADY_RESERVED');
    renderDialog({ error });

    expect(screen.getByRole('alert')).toHaveTextContent(mockedT('SPOT_ALREADY_RESERVED'));
    expect(screen.queryByRole('heading', { name: mockedT('errorTitle') })).not.toBeInTheDocument();
  });
});
