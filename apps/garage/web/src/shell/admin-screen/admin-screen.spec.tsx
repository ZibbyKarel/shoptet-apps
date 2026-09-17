import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntlProvider } from '@garage/i18n';
import cs from '../../../messages/cs.json';
import type { UserRole } from '@garage/contract';
import { AdminScreen } from './admin-screen';

/**
 * The real `IntlProvider`, because the Czech sentence a non-admin is shown is
 * half of what is under test — the other half being which of the four states
 * is chosen. Nothing is fetched here: that is the point of the split, and the
 * page's own wiring is exercised in the browser.
 *
 * The four panels are inert markers rather than the real connected components,
 * for the same reason: this file asserts *which* tab is mounted, and the real
 * panels would drag a query client and a session in with them. That they are
 * distinguishable is what lets the tab assertions below say anything.
 */
function renderAdminScreen(
  overrides: {
    role?: UserRole | undefined;
    isPending?: boolean;
    isError?: boolean;
    error?: unknown;
  } = {}
) {
  const onRetry = jest.fn();

  render(
    <IntlProvider locale="cs" messages={cs}>
      <AdminScreen
        role={overrides.role}
        isPending={overrides.isPending ?? false}
        isError={overrides.isError ?? false}
        error={overrides.error ?? null}
        onRetry={onRetry}
        panels={{
          overview: <p>panel-prehled</p>,
          users: <p>panel-uzivatele</p>,
          spots: <p>panel-mista</p>,
          window: <p>panel-okno</p>,
          limits: <p>panel-limity</p>,
        }}
      />
    </IntlProvider>
  );

  return { onRetry, user: userEvent.setup() };
}

describe('AdminScreen', () => {
  it('shows the administration section to an admin', () => {
    renderAdminScreen({ role: 'ADMIN' });

    expect(screen.getByRole('heading', { name: 'administration' })).toBeInTheDocument();
    expect(screen.queryByText('FORBIDDEN')).not.toBeInTheDocument();
  });

  it('refuses a plain user, and does not render the section', () => {
    renderAdminScreen({ role: 'USER' });

    expect(screen.getByText('FORBIDDEN')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'administration' })).not.toBeInTheDocument();
    // Not one of the four tab bodies is mounted. A gate that rendered the
    // strip but hid the heading would still be leaking the admin screens.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByText('panel-uzivatele')).not.toBeInTheDocument();
  });

  it('names the five tabs from the design, in the design’s order', () => {
    renderAdminScreen({ role: 'ADMIN' });

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'tabOverview',
      'tabUsers',
      'tabSpots',
      'tabWindow',
      'tabLimits',
    ]);
  });

  it('opens on the day overview and mounts no other panel', () => {
    renderAdminScreen({ role: 'ADMIN' });

    expect(screen.getByText('panel-prehled')).toBeInTheDocument();
    expect(screen.queryByText('panel-uzivatele')).not.toBeInTheDocument();
    expect(screen.queryByText('panel-mista')).not.toBeInTheDocument();
    expect(screen.queryByText('panel-okno')).not.toBeInTheDocument();
    expect(screen.queryByText('panel-limity')).not.toBeInTheDocument();
  });

  it.each([
    ['tabUsers', 'panel-uzivatele'],
    ['tabSpots', 'panel-mista'],
    ['tabWindow', 'panel-okno'],
    ['tabLimits', 'panel-limity'],
  ])('shows the %s panel when its tab is chosen', async (tab, body) => {
    const { user } = renderAdminScreen({ role: 'ADMIN' });

    await user.click(screen.getByRole('tab', { name: tab }));

    expect(screen.getByText(body)).toBeInTheDocument();
    // The panel that was showing a moment ago is gone, not merely hidden: a
    // mounted panel keeps fetching.
    expect(screen.queryByText('panel-prehled')).not.toBeInTheDocument();
  });

  it('fails closed when the role is not known', () => {
    // Neither pending nor failed, yet no role — the state a profile without one
    // would produce. Unknown is not an admin.
    renderAdminScreen({ role: undefined });

    expect(screen.getByText('FORBIDDEN')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'administration' })).not.toBeInTheDocument();
  });

  it('waits rather than deciding while the profile is in flight', () => {
    renderAdminScreen({ role: undefined, isPending: true });

    expect(screen.getByRole('status')).toHaveTextContent('loading');
    expect(screen.queryByText('FORBIDDEN')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'administration' })).not.toBeInTheDocument();
  });

  it('offers a retry when the profile could not be loaded', async () => {
    const { onRetry, user } = renderAdminScreen({
      isError: true,
      error: new Error('connection refused'),
    });

    expect(screen.queryByRole('heading', { name: 'administration' })).not.toBeInTheDocument();
    // The thrown error's own message is never shown; see `ScreenError`.
    expect(screen.queryByText(/connection refused/u)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
