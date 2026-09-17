import { Button, Modal, type ButtonVariant } from '@garage/design-system/primitives';
import type { ReactNode } from 'react';

export type ConfirmDialogTone = 'default' | 'danger';

/**
 * Which `Button` weight the confirming action gets. `danger` is the design's
 * "Smazat" ("Delete") style — soft red, solid red on hover — so a destructive
 * confirmation looks destructive before it is pressed, not after.
 */
const CONFIRM_VARIANT: Record<ConfirmDialogTone, ButtonVariant> = {
  default: 'primary',
  danger: 'danger',
};

export interface ConfirmDialogProps {
  /** The dialog renders nothing at all when this is `false`. */
  open: boolean;
  /** The question. Also the dialog's accessible name, via `Modal`'s `title`. */
  title: ReactNode;
  /** What confirming will actually do. Wired to `aria-describedby`. */
  description?: ReactNode | undefined;
  /** Called when the confirming button is pressed. */
  onConfirm: () => void;
  /**
   * Called for **every** way out that is not confirmation: the cancel button,
   * Escape, the scrim, and the × in the corner. They all mean the same thing,
   * so they all take the same route — a dialog where Escape did something
   * other than cancel would be a trap.
   */
  onCancel: () => void;
  /**
   * Label of the confirming button.
   *
   * **Required, like {@link cancelLabel}, and deliberately so.** Both are
   * user-visible copy, and this library has no access to `libs/shared/i18n` — a
   * compound that called `useTranslations` would stop being presentation-only.
   * Defaulting them to the generic Czech verbs emitted copy from outside the
   * message catalogue; requiring them puts it in app code, where the catalogue
   * is, and the compiler asks the next call site for it.
   */
  confirmLabel: string;
  /** Label of the dismissing button. See {@link confirmLabel}. */
  cancelLabel: string;
  /** Visual weight of the confirming button. Defaults to `default`. */
  tone?: ConfirmDialogTone | undefined;
  /**
   * The confirmed action is in flight: the confirming button shows a spinner
   * and **every** way out is blocked, Escape and the scrim included. Cancelling
   * a request that has already left is a promise this component cannot keep.
   */
  loading?: boolean | undefined;
  /** Extra content between the description and the buttons. */
  children?: ReactNode | undefined;
}

/**
 * A `Modal` narrowed to one question and two answers.
 *
 * **Invented, not drawn** — no screen in the design shows a confirmation step,
 * only the "Smazat" button that would open one
 * (`doc/design/screens/04-admin-spots.png`). It is assembled entirely out of
 * `Modal` and `Button`, so every value in it is one the design already fixed;
 * what is new is only the composition. See
 * `doc/decision/0071-empty-state-and-confirm-dialog-are-invented.md`.
 *
 * Domain-free: the copy is entirely the caller's — `title` and both button
 * labels are required, because nothing here may reach `libs/shared/i18n`.
 *
 * Focus lands on `Modal`'s × button, the first tabbable element in the dialog —
 * so a destructive confirmation never opens with the destructive button armed
 * under the user's Enter key.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  loading = false,
  children,
}: ConfirmDialogProps) {
  // One guard for all four routes out. `Modal` calls `onClose` for Escape, the
  // scrim and the ×; the cancel button is wired to the same function, so there
  // is no fourth code path that could forget the check.
  const handleCancel = () => {
    if (!loading) {
      onCancel();
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title={title}
      description={description}
      size="sm"
      closeOnScrimClick={!loading}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={handleCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={CONFIRM_VARIANT[tone]} size="lg" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
