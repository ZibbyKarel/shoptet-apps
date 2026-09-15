'use client';

/**
 * The "Uživatelé" tab (`doc/design/screens/03-admin-users.png`): the account
 * list, with a switch per row for the admin role and one for the account being
 * active at all.
 *
 * ## Two switches, one of which the design does not draw
 *
 * The design shows `Jméno` / `E-mail` / `Admin`. The brief also requires
 * deactivation, and the contract already carries it
 * (`adminUpdateUserInputSchema` picks exactly `role` and `active`). The second
 * switch is therefore added in the design's own idiom — the same `Switch` the
 * "Aktivní" column of `04-admin-spots.png` uses — rather than as a new control
 * the product has never drawn. See
 * `doc/decision/0160-the-users-table-gets-an-active-switch-the-design-does-not-draw.md`.
 *
 * ## The disabled switch is a courtesy, not the rule
 *
 * A user's own "Aktivní" switch is disabled, because deactivating yourself is
 * how an admin loses their own session mid-task. The **enforcement** is on the
 * API: `UsersService.adminUpdate` refuses it with `CONFLICT`, and refuses
 * removing the last active admin, whatever any browser sends. Nothing here is
 * authorization — `@Roles('ADMIN')` on the two procedures is.
 *
 * ## Stepping down is allowed, but not by accident
 *
 * The viewer's own **Admin** switch stays enabled: giving up the role is a
 * legitimate thing to do, and unlike deactivation it does not end the session.
 * What it does do is take `/správa` away — the tab disappears from the top bar
 * and this screen stops rendering — and only another admin can give it back.
 * One unlabelled click was the whole distance to that, so it goes through a
 * `ConfirmDialog` first. See `doc/decision/0260-*`.
 *
 * Only *self*-demotion asks. Demoting somebody else is ordinary
 * administration, is visible in the row afterwards, and is undone by the same
 * switch.
 *
 * Presentational: everything arrives as a prop. `../admin-users-panel.tsx` is
 * the connected half.
 */

import { useMemo, useState } from 'react';
import type { AdminListUsersOutput, AdminUser } from '@lets-park/contract';
import { Avatar, Input, Stack, Switch, Text, Toast } from '@lets-park/design-system/primitives';
import { ConfirmDialog, DataTable } from '@lets-park/design-system/compounds';
import type { DataTableColumn } from '@lets-park/design-system/compounds';
import { useTranslations } from '@lets-park/i18n';
import { initialsOf } from '../../initials';
import { AppToastRegion } from '../../notifications/toast-region';
import { ScreenDataGuard } from '../../screen-state/screen-state';
import type { ScreenData } from '../../screen-state/screen-state';
import { useAdminWriteError } from '../admin-errors';

/** One field of one row is being written. `null` when nothing is in flight. */
export interface PendingUserChange {
  readonly id: string;
  readonly field: 'role' | 'active';
}

export interface AdminUsersScreenProps {
  /** The account list as `admin.user.list` returned it, or why it is not here. */
  readonly users: ScreenData<AdminListUsersOutput>;
  readonly onRetry: () => void;
  /** Id of the signed-in admin, so their own row can protect itself. */
  readonly viewerId: string | undefined;
  readonly onRoleChange: (id: string, isAdmin: boolean) => void;
  readonly onActiveChange: (id: string, active: boolean) => void;
  /** Which row and field is being written, if any. */
  readonly pendingChange: PendingUserChange | null;
  /** Whatever the failing `admin.user.update` call threw. */
  readonly updateError: unknown;
}

/**
 * The client-side half of the search box.
 *
 * Substring, case-insensitive, against name **or** email — deliberately the
 * same rule `UsersService.adminList` applies to its `search` input, because the
 * two must not disagree about what a search means. Filtering here rather than
 * refetching per keystroke is recorded in
 * `doc/decision/0162-the-user-search-filters-the-loaded-list.md`.
 */
export function matchesUserSearch(user: AdminUser, term: string): boolean {
  const needle = term.trim().toLocaleLowerCase('cs-CZ');
  if (needle === '') {
    return true;
  }
  return (
    user.name.toLocaleLowerCase('cs-CZ').includes(needle) ||
    user.email.toLocaleLowerCase('cs-CZ').includes(needle)
  );
}

export function AdminUsersScreen({
  users,
  onRetry,
  viewerId,
  onRoleChange,
  onActiveChange,
  pendingChange,
  updateError,
}: AdminUsersScreenProps) {
  const t = useTranslations('admin');
  const describeWriteError = useAdminWriteError();
  const [search, setSearch] = useState('');
  // `true` while the viewer's own step-down is waiting to be confirmed. A
  // boolean rather than the row, because there is exactly one row this can
  // ever be about.
  const [confirmingSelfDemotion, setConfirmingSelfDemotion] = useState(false);

  // The rows outside the ready state, so the search box's `useMemo` keeps a
  // stable dependency. Nothing draws them: `ScreenDataGuard` below renders the
  // loading or error state instead, which is the whole point of the union —
  // an empty table here would assert "there are no accounts".
  const all = users.kind === 'ready' ? users.data.users : NO_USERS;
  const visible = useMemo(
    () => all.filter((user) => matchesUserSearch(user, search)),
    [all, search]
  );

  // How many active admins exist in the fetched list. `all`, not `visible`:
  // a search filter must not change who counts as "the last admin" — the
  // rule is about the whole account list, not what happens to be on screen.
  const activeAdminCount = useMemo(
    () => all.filter((user) => user.role === 'ADMIN' && user.active).length,
    [all]
  );

  const updateErrorMessage = describeWriteError('userUpdate', updateError);

  const columns: DataTableColumn<AdminUser>[] = [
    {
      id: 'name',
      header: t('usersColumnName'),
      sortValue: (user) => user.name.toLocaleLowerCase('cs-CZ'),
      cell: (user) => (
        <Stack direction="row" align="center" spacing={3}>
          <Avatar initials={initialsOf(user.name)} size="sm" />
          <Text as="span" weight="bold">
            {user.name}
          </Text>
        </Stack>
      ),
    },
    {
      id: 'email',
      header: t('usersColumnEmail'),
      sortValue: (user) => user.email.toLocaleLowerCase('cs-CZ'),
      cell: (user) => (
        <Text as="span" tone="subtle">
          {user.email}
        </Text>
      ),
    },
    {
      id: 'role',
      header: t('usersColumnAdmin'),
      align: 'end',
      width: '120px',
      cell: (user) => {
        const isLastActiveAdmin = user.role === 'ADMIN' && user.active && activeAdminCount <= 1;
        return (
          <Stack
            direction="row"
            align="center"
            title={isLastActiveAdmin ? t('usersLastAdminHint') : undefined}
          >
            <Switch
              checked={user.role === 'ADMIN'}
              // Same reasoning as the self-active switch below: the reason a
              // switch is disabled belongs in its own name, not only in
              // `title`, since `title` never reaches touch and is announced
              // inconsistently by screen readers.
              aria-label={
                isLastActiveAdmin
                  ? t('usersLastAdminToggleLabel', { name: user.name })
                  : t('usersAdminToggleLabel', { name: user.name })
              }
              disabled={isLastActiveAdmin || isRowBusy(pendingChange, user.id)}
              onCheckedChange={(next) => {
                // Only the viewer taking their *own* role away asks first —
                // and only in that direction. Granting is not the
                // irreversible one.
                if (user.id === viewerId && !next) {
                  setConfirmingSelfDemotion(true);
                  return;
                }
                onRoleChange(user.id, next);
              }}
            />
          </Stack>
        );
      },
    },
    {
      id: 'active',
      header: t('usersColumnActive'),
      align: 'end',
      width: '120px',
      cell: (user) => {
        const isSelf = user.id === viewerId;
        return (
          <Stack
            direction="row"
            align="center"
            title={isSelf ? t('usersSelfActiveHint') : undefined}
          >
            <Switch
              tone="success"
              checked={user.active}
              // The reason a switch is disabled belongs in its name, not only
              // in the `title` above: `title` is announced inconsistently and
              // never appears on touch, and the people who most need to know
              // why the control refuses them are the ones who cannot hover.
              aria-label={
                isSelf
                  ? t('usersSelfActiveToggleLabel', { name: user.name })
                  : t('usersActiveToggleLabel', { name: user.name })
              }
              disabled={isSelf || isRowBusy(pendingChange, user.id)}
              onCheckedChange={(next) => onActiveChange(user.id, next)}
            />
          </Stack>
        );
      },
    },
  ];

  return (
    <ScreenDataGuard state={users} onRetry={onRetry} headingLevel={3}>
      {() => (
        <Stack spacing={4}>
          {updateErrorMessage ? (
            <AppToastRegion>
              <Toast tone="danger">{updateErrorMessage}</Toast>
            </AppToastRegion>
          ) : null}

          <DataTable
            columns={columns}
            data={visible}
            getRowId={(user) => user.id}
            title={t('usersTitle')}
            description={t('usersDescription', { count: all.length })}
            actions={
              <Input
                type="search"
                // `aria-label`, not `label`: the design draws a bare field with a
                // placeholder and no visible caption, and a placeholder is not an
                // accessible name — it disappears the moment anything is typed.
                aria-label={t('usersSearchLabel')}
                placeholder={t('usersSearchPlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                // `width="full"` covers the base `w-full` step; the original
                // `sm:w-80` cap (staying full-width below the `sm` breakpoint,
                // capped at 320px from it up) has no equivalent — no primitive
                // here takes a breakpoint-keyed width, and inventing one for
                // this single call site was rejected. Dropping the cap is a
                // small, stated visual change: the search field now stays
                // full-width at every breakpoint instead of capping at 320px
                // on wider screens.
                width="full"
              />
            }
            defaultSort={{ columnId: 'name', direction: 'asc' }}
            minWidth="720px"
            emptyTitle={search.trim() === '' ? t('usersEmpty') : t('usersEmptySearch')}
            emptyDescription={search.trim() === '' ? undefined : t('usersEmptySearchDescription')}
          />

          {/*
            Rendered unconditionally and closed by its own `open` prop, the way
            `ConfirmDialog` is built to be used: it renders nothing at all when
            closed, and mounting it conditionally would take the dialog out of
            the tree in the same commit the confirm button is pressed.
          */}
          <ConfirmDialog
            open={confirmingSelfDemotion}
            tone="danger"
            title={t('usersSelfRoleConfirmTitle')}
            description={t('usersSelfRoleConfirmDescription')}
            confirmLabel={t('usersSelfRoleConfirmAction')}
            cancelLabel={t('cancel')}
            onCancel={() => {
              setConfirmingSelfDemotion(false);
            }}
            onConfirm={() => {
              setConfirmingSelfDemotion(false);
              if (viewerId !== undefined) onRoleChange(viewerId, false);
            }}
          />
        </Stack>
      )}
    </ScreenDataGuard>
  );
}

/** No rows at all — a shared empty array, so `useMemo` above is not defeated. */
const NO_USERS: readonly AdminUser[] = [];

/**
 * Whether a row's switches are blocked because one of them is mid-flight.
 *
 * Per **row**, not per switch: the two fields go through the same procedure,
 * and letting a role change land while an activity change for the same user is
 * still in the air is how the second response overwrites the first.
 */
function isRowBusy(pending: PendingUserChange | null, id: string): boolean {
  return pending !== null && pending.id === id;
}
