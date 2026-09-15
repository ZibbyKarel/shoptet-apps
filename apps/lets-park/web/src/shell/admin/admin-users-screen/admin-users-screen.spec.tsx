import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminUser } from '@lets-park/contract';
import { IntlProvider } from '@lets-park/i18n';
import cs from '../../../../messages/cs.json';
import { failureWithCode } from '../../../testing/contract-failure';
import { AdminUsersScreen, matchesUserSearch } from './admin-users-screen';
import type { AdminUsersScreenProps } from './admin-users-screen';

const TIMESTAMP = '2026-08-28T09:15:00.000Z';

function aUser(overrides: Partial<AdminUser> & { id: string; name: string }): AdminUser {
  return {
    email: `${overrides.id}@firma.cz`,
    licensePlate: null,
    role: 'USER',
    oktaId: `okta|${overrides.id}`,
    active: true,
    preferredParkingSpotId: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

const ADELA = aUser({ id: 'a', name: 'Adéla Horáková', email: 'adela.horakova@firma.cz' });
const KAREL = aUser({
  id: 'k',
  name: 'Karel Zíbar',
  email: 'karel.zibar@firma.cz',
  role: 'ADMIN',
});
const PETR = aUser({
  id: 'p',
  name: 'Petr Novák',
  email: 'petr.novak@firma.cz',
  active: false,
});

function renderScreen(overrides: Partial<AdminUsersScreenProps> = {}) {
  const onRetry = jest.fn();
  const onRoleChange = jest.fn();
  const onActiveChange = jest.fn();

  const props: AdminUsersScreenProps = {
    users: { kind: 'ready', data: { users: [ADELA, KAREL, PETR] } },
    onRetry,
    viewerId: KAREL.id,
    onRoleChange,
    onActiveChange,
    pendingChange: null,
    updateError: null,
    ...overrides,
  };

  render(
    <IntlProvider locale="cs" messages={cs}>
      <AdminUsersScreen {...props} />
    </IntlProvider>
  );

  return { onRetry, onRoleChange, onActiveChange, user: userEvent.setup() };
}

/** The `<tr>` for one user, found by the `data-row-id` `DataTable` writes. */
function rowOf(user: AdminUser): HTMLElement {
  const row = document.querySelector(`[data-row-id="${user.id}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`no row rendered for ${user.name}`);
  }
  return row;
}

describe('matchesUserSearch', () => {
  it('matches a substring of the name, ignoring case and diacritics-as-typed', () => {
    expect(matchesUserSearch(ADELA, 'horák')).toBe(true);
    expect(matchesUserSearch(ADELA, 'HORÁK')).toBe(true);
    expect(matchesUserSearch(ADELA, 'zíbar')).toBe(false);
  });

  it('matches a substring of the email', () => {
    expect(matchesUserSearch(KAREL, 'karel.zibar@')).toBe(true);
    expect(matchesUserSearch(KAREL, 'novak')).toBe(false);
  });

  it('matches everything on an empty or whitespace-only term', () => {
    expect(matchesUserSearch(PETR, '')).toBe(true);
    expect(matchesUserSearch(PETR, '   ')).toBe(true);
  });
});

describe('AdminUsersScreen', () => {
  it('waits rather than showing an empty table while the list is in flight', () => {
    renderScreen({ users: { kind: 'loading' } });

    expect(screen.getByRole('status')).toHaveTextContent('loading');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('offers a retry when the list could not be loaded', async () => {
    const { onRetry, user } = renderScreen({
      users: { kind: 'error', error: new Error('connection refused') },
    });

    expect(screen.queryByText(/connection refused/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('lists every account with its name and e-mail', () => {
    renderScreen();

    expect(within(rowOf(ADELA)).getByText('Adéla Horáková')).toBeInTheDocument();
    expect(within(rowOf(ADELA)).getByText('adela.horakova@firma.cz')).toBeInTheDocument();
    expect(within(rowOf(PETR)).getByText('Petr Novák')).toBeInTheDocument();
  });

  it('counts the accounts in the Czech plural the design uses', () => {
    renderScreen();

    expect(screen.getByText('usersDescription: count=3')).toBeInTheDocument();
  });

  it('declines the count for one and for many', () => {
    renderScreen({ users: { kind: 'ready', data: { users: [KAREL] } } });
    expect(screen.getByText(/^usersDescription: count=1/u)).toBeInTheDocument();
  });

  it('shows the admin switch on and off according to the role', () => {
    renderScreen();

    // KAREL is the only active admin in the default data, so his switch has the
    // "last admin" label and is disabled.
    expect(
      within(rowOf(KAREL)).getByRole('switch', {
        name: 'usersLastAdminToggleLabel: name=Karel Zíbar',
      })
    ).toBeChecked();
    expect(
      within(rowOf(ADELA)).getByRole('switch', {
        name: 'usersAdminToggleLabel: name=Adéla Horáková',
      })
    ).not.toBeChecked();
  });

  it('reports a promotion and a demotion as the role the switch moved to', async () => {
    // Viewed as Petr, so neither switch below is the viewer's own — changing
    // somebody else's role is ordinary administration and goes straight
    // through. The viewer's own demotion is the one that asks first, and it
    // has its own tests.
    // To allow demotion of KAREL, we add Zora as a second active admin (so KAREL
    // is not the last admin). ADELA stays a USER so we can test promotion.
    const zoraAdmin = aUser({ id: 'z', name: 'Zora Adminová', role: 'ADMIN' });
    const { onRoleChange, user } = renderScreen({
      viewerId: PETR.id,
      users: { kind: 'ready', data: { users: [KAREL, ADELA, zoraAdmin, PETR] } },
    });

    // Test a promotion: ADELA is a USER, clicking her switch makes her an admin.
    await user.click(
      within(rowOf(ADELA)).getByRole('switch', {
        name: 'usersAdminToggleLabel: name=Adéla Horáková',
      })
    );
    expect(onRoleChange).toHaveBeenLastCalledWith(ADELA.id, true);

    // Test a demotion: KAREL is an admin, and with Zora as the second admin,
    // clicking his switch to demote him is allowed.
    await user.click(
      within(rowOf(KAREL)).getByRole('switch', { name: 'usersAdminToggleLabel: name=Karel Zíbar' })
    );
    expect(onRoleChange).toHaveBeenLastCalledWith(KAREL.id, false);
  });

  it('shows the active switch on and off according to the account', () => {
    renderScreen();

    expect(
      within(rowOf(ADELA)).getByRole('switch', {
        name: 'usersActiveToggleLabel: name=Adéla Horáková',
      })
    ).toBeChecked();
    expect(
      within(rowOf(PETR)).getByRole('switch', { name: 'usersActiveToggleLabel: name=Petr Novák' })
    ).not.toBeChecked();
  });

  it('deactivates and reactivates through the same switch', async () => {
    const { onActiveChange, user } = renderScreen();

    await user.click(
      within(rowOf(ADELA)).getByRole('switch', {
        name: 'usersActiveToggleLabel: name=Adéla Horáková',
      })
    );
    expect(onActiveChange).toHaveBeenLastCalledWith(ADELA.id, false);

    await user.click(
      within(rowOf(PETR)).getByRole('switch', { name: 'usersActiveToggleLabel: name=Petr Novák' })
    );
    expect(onActiveChange).toHaveBeenLastCalledWith(PETR.id, true);
  });

  describe('an admin cannot switch off their own account', () => {
    // The switch on the viewer's own row names its own refusal. `title` alone
    // would not: screen readers announce it inconsistently and touch devices
    // never show it, so the people most likely to be stuck by a dead control
    // are the ones least likely to be told why.
    const OWN_SWITCH = 'usersSelfActiveToggleLabel: name=Karel Zíbar';

    it('disables the active switch on the viewer’s own row', () => {
      renderScreen({ viewerId: KAREL.id });

      expect(within(rowOf(KAREL)).getByRole('switch', { name: OWN_SWITCH })).toBeDisabled();
    });

    it('says in the switch’s own name why it refuses', () => {
      renderScreen({ viewerId: KAREL.id });

      // Nobody else's row carries the explanation, and this row no longer
      // carries the plain label.
      expect(within(rowOf(KAREL)).getByRole('switch', { name: OWN_SWITCH })).toBeInTheDocument();
      expect(
        within(rowOf(ADELA)).queryByRole('switch', { name: /usersSelfActiveToggleLabel/u })
      ).not.toBeInTheDocument();
    });

    it('reports nothing when that switch is pressed', async () => {
      const { onActiveChange, user } = renderScreen({ viewerId: KAREL.id });

      await user.click(within(rowOf(KAREL)).getByRole('switch', { name: OWN_SWITCH }));

      expect(onActiveChange).not.toHaveBeenCalled();
    });

    it('leaves everybody else’s switch alone', () => {
      renderScreen({ viewerId: KAREL.id });

      expect(
        within(rowOf(ADELA)).getByRole('switch', {
          name: 'usersActiveToggleLabel: name=Adéla Horáková',
        })
      ).toBeEnabled();
    });

    it('still lets an admin step down from their own role', () => {
      // Demoting yourself is allowed while another admin remains — the API
      // decides that, and the UI must not pre-empt it. So the switch is
      // enabled, unlike the "aktivní" one above; what it is not is immediate.
      const anotherAdmin = { ...ADELA, role: 'ADMIN' as const };
      renderScreen({
        viewerId: KAREL.id,
        users: { kind: 'ready', data: { users: [KAREL, anotherAdmin, PETR] } },
      });

      expect(
        within(rowOf(KAREL)).getByRole('switch', {
          name: 'usersAdminToggleLabel: name=Karel Zíbar',
        })
      ).toBeEnabled();
    });

    /**
     * The asymmetry the review named: self-*deactivation* was guarded because
     * it is how an admin loses their own session mid-task, while
     * self-*demotion* — which takes `/správa` away and can only be undone by
     * somebody else — was one unlabelled click, and this suite pinned that as
     * intended.
     */
    describe('stepping down from your own admin role', () => {
      const CONFIRM_TITLE = 'usersSelfRoleConfirmTitle';
      const OWN_ADMIN_SWITCH = 'usersAdminToggleLabel: name=Karel Zíbar';
      // Another admin is needed so KAREL is not the last admin.
      const anotherAdmin = { ...ADELA, role: 'ADMIN' as const };

      it('asks before doing it, and reports nothing until the answer is yes', async () => {
        const { onRoleChange, user } = renderScreen({
          viewerId: KAREL.id,
          users: { kind: 'ready', data: { users: [KAREL, anotherAdmin, PETR] } },
        });

        await user.click(within(rowOf(KAREL)).getByRole('switch', { name: OWN_ADMIN_SWITCH }));

        expect(screen.getByRole('dialog', { name: CONFIRM_TITLE })).toBeInTheDocument();
        expect(onRoleChange).not.toHaveBeenCalled();
      });

      it('says what will be lost, not just that something will', async () => {
        const { user } = renderScreen({
          viewerId: KAREL.id,
          users: { kind: 'ready', data: { users: [KAREL, anotherAdmin, PETR] } },
        });

        await user.click(within(rowOf(KAREL)).getByRole('switch', { name: OWN_ADMIN_SWITCH }));

        expect(screen.getByText('usersSelfRoleConfirmDescription')).toBeInTheDocument();
      });

      it('goes through once confirmed', async () => {
        const { onRoleChange, user } = renderScreen({
          viewerId: KAREL.id,
          users: { kind: 'ready', data: { users: [KAREL, anotherAdmin, PETR] } },
        });

        await user.click(within(rowOf(KAREL)).getByRole('switch', { name: OWN_ADMIN_SWITCH }));
        await user.click(screen.getByRole('button', { name: 'usersSelfRoleConfirmAction' }));

        expect(onRoleChange).toHaveBeenCalledWith(KAREL.id, false);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      it('changes nothing when cancelled', async () => {
        const { onRoleChange, user } = renderScreen({
          viewerId: KAREL.id,
          users: { kind: 'ready', data: { users: [KAREL, anotherAdmin, PETR] } },
        });

        await user.click(within(rowOf(KAREL)).getByRole('switch', { name: OWN_ADMIN_SWITCH }));
        await user.click(screen.getByRole('button', { name: 'cancel' }));

        expect(onRoleChange).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(within(rowOf(KAREL)).getByRole('switch', { name: OWN_ADMIN_SWITCH })).toBeChecked();
      });

      it('does not ask when the viewer is giving themselves the role back', async () => {
        // Only the irreversible direction. Granting is undone by the same
        // switch, by the same person.
        const { onRoleChange, user } = renderScreen({
          viewerId: ADELA.id,
        });

        await user.click(
          within(rowOf(ADELA)).getByRole('switch', {
            name: 'usersAdminToggleLabel: name=Adéla Horáková',
          })
        );

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(onRoleChange).toHaveBeenCalledWith(ADELA.id, true);
      });

      it('does not ask when demoting somebody else', async () => {
        const { onRoleChange, user } = renderScreen({
          viewerId: ADELA.id,
          users: { kind: 'ready', data: { users: [KAREL, anotherAdmin, PETR] } },
        });

        await user.click(within(rowOf(KAREL)).getByRole('switch', { name: OWN_ADMIN_SWITCH }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(onRoleChange).toHaveBeenCalledWith(KAREL.id, false);
      });
    });

    it('disables nothing when the viewer is not known yet', () => {
      renderScreen({ viewerId: undefined });

      expect(
        within(rowOf(KAREL)).getByRole('switch', {
          name: 'usersActiveToggleLabel: name=Karel Zíbar',
        })
      ).toBeEnabled();
    });
  });

  describe('the last active administrator cannot lose the role', () => {
    const LAST_ADMIN_SWITCH = 'usersLastAdminToggleLabel: name=Karel Zíbar';

    it('disables the admin switch when they are the only active admin', () => {
      renderScreen({ users: { kind: 'ready', data: { users: [KAREL, ADELA] } } });

      expect(within(rowOf(KAREL)).getByRole('switch', { name: LAST_ADMIN_SWITCH })).toBeDisabled();
    });

    it("says in the switch's own name why it refuses", () => {
      renderScreen({ users: { kind: 'ready', data: { users: [KAREL, ADELA] } } });

      expect(
        within(rowOf(KAREL)).getByRole('switch', { name: LAST_ADMIN_SWITCH })
      ).toBeInTheDocument();
      expect(
        within(rowOf(ADELA)).queryByRole('switch', { name: /usersLastAdminToggleLabel/u })
      ).not.toBeInTheDocument();
    });

    it('reports nothing when that switch is pressed', async () => {
      const { onRoleChange, user } = renderScreen({
        users: { kind: 'ready', data: { users: [KAREL, ADELA] } },
      });

      await user.click(within(rowOf(KAREL)).getByRole('switch', { name: LAST_ADMIN_SWITCH }));

      expect(onRoleChange).not.toHaveBeenCalled();
    });

    it('does not disable the switch for an inactive admin, since they are not counted', () => {
      const INACTIVE_ADMIN = aUser({
        id: 'i',
        name: 'Ivo Malý',
        role: 'ADMIN',
        active: false,
      });
      renderScreen({ users: { kind: 'ready', data: { users: [KAREL, INACTIVE_ADMIN] } } });

      // KAREL is still the only *active* admin, so his switch is disabled...
      expect(
        within(rowOf(KAREL)).getByRole('switch', {
          name: 'usersLastAdminToggleLabel: name=Karel Zíbar',
        })
      ).toBeDisabled();
      // ...and the inactive admin's own switch is unaffected by this rule.
      expect(
        within(rowOf(INACTIVE_ADMIN)).getByRole('switch', {
          name: 'usersAdminToggleLabel: name=Ivo Malý',
        })
      ).toBeEnabled();
    });

    it('re-enables once a second active admin exists', () => {
      const secondAdmin = { ...ADELA, role: 'ADMIN' as const };
      renderScreen({
        users: { kind: 'ready', data: { users: [KAREL, secondAdmin, PETR] } },
      });

      expect(
        within(rowOf(KAREL)).getByRole('switch', {
          name: 'usersAdminToggleLabel: name=Karel Zíbar',
        })
      ).toBeEnabled();
    });
  });

  describe('a write in flight', () => {
    it('freezes both switches on the row being written', () => {
      renderScreen({ pendingChange: { id: ADELA.id, field: 'role' } });

      expect(
        within(rowOf(ADELA)).getByRole('switch', {
          name: 'usersAdminToggleLabel: name=Adéla Horáková',
        })
      ).toBeDisabled();
      // The other field of the same row too: both go through one procedure,
      // and a second call would race the first.
      expect(
        within(rowOf(ADELA)).getByRole('switch', {
          name: 'usersActiveToggleLabel: name=Adéla Horáková',
        })
      ).toBeDisabled();
    });

    it('leaves the other rows usable', () => {
      renderScreen({ pendingChange: { id: ADELA.id, field: 'role' } });

      expect(
        within(rowOf(PETR)).getByRole('switch', { name: 'usersAdminToggleLabel: name=Petr Novák' })
      ).toBeEnabled();
    });
  });

  describe('search', () => {
    it('filters by name', async () => {
      const { user } = renderScreen();

      await user.type(screen.getByRole('searchbox', { name: 'usersSearchLabel' }), 'novák');

      expect(screen.getByText('Petr Novák')).toBeInTheDocument();
      expect(screen.queryByText('Adéla Horáková')).not.toBeInTheDocument();
    });

    it('filters by e-mail', async () => {
      const { user } = renderScreen();

      await user.type(screen.getByRole('searchbox', { name: 'usersSearchLabel' }), 'karel.zibar@');

      expect(screen.getByText('Karel Zíbar')).toBeInTheDocument();
      expect(screen.queryByText('Petr Novák')).not.toBeInTheDocument();
    });

    it('keeps the total in the description, not the filtered count', async () => {
      const { user } = renderScreen();

      await user.type(screen.getByRole('searchbox', { name: 'usersSearchLabel' }), 'novák');

      expect(screen.getByText(/^usersDescription: count=3/u)).toBeInTheDocument();
    });

    it('says the search found nothing, not that there are no accounts', async () => {
      const { user } = renderScreen();

      await user.type(screen.getByRole('searchbox', { name: 'usersSearchLabel' }), 'zzz');

      expect(screen.getByText('usersEmptySearch')).toBeInTheDocument();
      expect(screen.getByText('usersEmptySearchDescription')).toBeInTheDocument();
      expect(screen.queryByText('usersEmpty')).not.toBeInTheDocument();
    });

    it('says there are no accounts when the list itself is empty', () => {
      renderScreen({ users: { kind: 'ready', data: { users: [] } } });

      expect(screen.getByText('usersEmpty')).toBeInTheDocument();
    });
  });

  describe('a refused change', () => {
    it('explains a CONFLICT as the last-admin rule, not as a lost race', async () => {
      renderScreen({ updateError: await failureWithCode('CONFLICT') });

      expect(screen.getByText('errUserConflict')).toBeInTheDocument();
      // The `errors` namespace's generic CONFLICT sentence explains nothing
      // here, and this screen must not reach for it.
      expect(screen.queryByText(cs.errors.CONFLICT)).not.toBeInTheDocument();
    });

    it('never shows the reservation wording for VALIDATION_FAILED', async () => {
      renderScreen({ updateError: await failureWithCode('VALIDATION_FAILED') });

      expect(screen.getByText('errUserValidation')).toBeInTheDocument();
      expect(screen.queryByText(cs.errors.VALIDATION_FAILED)).not.toBeInTheDocument();
    });

    it('keeps the table on screen — the failure is a notice, not a screen state', async () => {
      renderScreen({ updateError: await failureWithCode('CONFLICT') });

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('Adéla Horáková')).toBeInTheDocument();
    });

    it('shows nothing at all when the last change succeeded', () => {
      renderScreen({ updateError: null });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
