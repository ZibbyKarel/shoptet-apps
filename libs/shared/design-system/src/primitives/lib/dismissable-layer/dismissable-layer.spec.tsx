import { useRef, useState, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DismissableLayerProvider, useDismissableLayer } from './dismissable-layer';
import { Dropdown, type DropdownItem } from '../dropdown/dropdown';
import { Modal } from '../modal/modal';

const ITEMS: DropdownItem[] = [
  { id: 'a', label: 'První' },
  { id: 'b', label: 'Druhá' },
];

/**
 * Minimal open-on-hover-or-focus layer, standing in for the design system's
 * (now-deleted, unused-in-product) `Tooltip` primitive, which used to fill
 * this role in these tests. The escape-dismissal rule these tests exercise
 * turns on the hover-vs-focus distinction, not on anything Tooltip-specific,
 * so a bare stand-in registered with the same dismissable layer is enough.
 */
function HoverTrigger({ label, text }: { label: string; text: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const layer = useDismissableLayer({
    active: visible,
    elementRef: ref,
    onDismiss: () => setVisible(false),
  });

  return (
    <span
      ref={ref}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <DismissableLayerProvider layer={layer}>
        <button type="button">{label}</button>
        {visible ? <span role="tooltip">{text}</span> : null}
      </DismissableLayerProvider>
    </span>
  );
}

/**
 * A layer with no styling, no roles and no behaviour of its own, so the tests
 * below are about the tree and nothing else. Its wrapper stays mounted whether
 * the layer is open or not, and it publishes its own node the way every real
 * overlay does — that provider is the whole contract for being somebody's
 * parent, so a probe without one would be testing a shape nothing ships.
 */
function ProbeLayer({
  name,
  open,
  onDismiss,
  children,
}: {
  name: string;
  open: boolean;
  onDismiss: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const layer = useDismissableLayer({ active: open, elementRef: ref, onDismiss });

  return (
    <div ref={ref}>
      <DismissableLayerProvider layer={layer}>
        {open ? <p>{name} otevřeno</p> : null}
        <button type="button">Prvek v {name}</button>
        {children}
      </DismissableLayerProvider>
    </div>
  );
}

type Names = 'A' | 'B' | 'C';

function useOpenSet(initial: Record<Names, boolean>) {
  const [open, setOpen] = useState(initial);
  const close = (name: Names) => () => setOpen((previous) => ({ ...previous, [name]: false }));

  return { open, close };
}

describe('the dismissable layer set', () => {
  it('gives each Escape to the last layer registered, one layer at a time', async () => {
    const user = userEvent.setup();

    function Siblings() {
      const { open, close } = useOpenSet({ A: true, B: true, C: true });
      return (
        <div>
          <ProbeLayer name="A" open={open.A} onDismiss={close('A')} />
          <ProbeLayer name="B" open={open.B} onDismiss={close('B')} />
          <ProbeLayer name="C" open={open.C} onDismiss={close('C')} />
        </div>
      );
    }

    render(<Siblings />);

    await user.keyboard('{Escape}');
    expect(screen.queryByText('C otevřeno')).not.toBeInTheDocument();
    expect(screen.getByText('B otevřeno')).toBeInTheDocument();
    expect(screen.getByText('A otevřeno')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByText('B otevřeno')).not.toBeInTheDocument();
    expect(screen.getByText('A otevřeno')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByText('A otevřeno')).not.toBeInTheDocument();

    // Nothing left to dismiss, and no listener left behind to throw.
    await user.keyboard('{Escape}');
  });

  it('survives a layer in the middle of the set closing on its own account', async () => {
    const user = userEvent.setup();

    function Siblings() {
      const { open, close } = useOpenSet({ A: true, B: true, C: true });
      return (
        <div>
          <ProbeLayer name="A" open={open.A} onDismiss={close('A')} />
          <ProbeLayer name="B" open={open.B} onDismiss={close('B')} />
          <button type="button" onClick={close('B')}>
            Zavřít B
          </button>
          <ProbeLayer name="C" open={open.C} onDismiss={close('C')} />
        </div>
      );
    }

    render(<Siblings />);

    await user.click(screen.getByRole('button', { name: 'Zavřít B' }));
    expect(screen.queryByText('B otevřeno')).not.toBeInTheDocument();

    // The set is now [A, C] with C still last: the out-of-order removal must
    // not have shuffled anything.
    await user.keyboard('{Escape}');
    expect(screen.queryByText('C otevřeno')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByText('A otevřeno')).not.toBeInTheDocument();
  });

  it('drops a layer that unmounts while still open', async () => {
    const user = userEvent.setup();

    function Siblings() {
      const { open, close } = useOpenSet({ A: true, B: true, C: true });
      const [mounted, setMounted] = useState(true);

      return (
        <div>
          <ProbeLayer name="A" open={open.A} onDismiss={close('A')} />
          <button type="button" onClick={() => setMounted(false)}>
            Odebrat C
          </button>
          {mounted ? <ProbeLayer name="C" open={open.C} onDismiss={close('C')} /> : null}
        </div>
      );
    }

    render(<Siblings />);

    // C is removed from the tree without its `open` ever going false — the
    // cleanup, not the state change, has to take it out of the set.
    await user.click(screen.getByRole('button', { name: 'Odebrat C' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByText('A otevřeno')).not.toBeInTheDocument();
  });

  it('gives Escape to the layer nested inside another, even when that one registered first', async () => {
    const user = userEvent.setup();

    function Nested() {
      const [inner, setInner] = useState(false);
      const [outer, setOuter] = useState(false);

      return (
        <div>
          <button type="button" onClick={() => setInner(true)}>
            Otevřít vnitřní
          </button>
          <button type="button" onClick={() => setOuter(true)}>
            Otevřít vnější
          </button>
          <ProbeLayer name="A" open={outer} onDismiss={() => setOuter(false)}>
            <ProbeLayer name="C" open={inner} onDismiss={() => setInner(false)} />
          </ProbeLayer>
        </div>
      );
    }

    render(<Nested />);

    // Registration order is inner-then-outer, so last-registered-wins would
    // pick the outer one. Containment has to override that.
    await user.click(screen.getByRole('button', { name: 'Otevřít vnitřní' }));
    await user.click(screen.getByRole('button', { name: 'Otevřít vnější' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByText('C otevřeno')).not.toBeInTheDocument();
    expect(screen.getByText('A otevřeno')).toBeInTheDocument();
  });

  it('gives Escape to whichever unrelated sibling holds the keyboard', async () => {
    const user = userEvent.setup();

    function Siblings() {
      const { open, close } = useOpenSet({ A: true, B: false, C: true });
      return (
        <div>
          <ProbeLayer name="A" open={open.A} onDismiss={close('A')} />
          <ProbeLayer name="C" open={open.C} onDismiss={close('C')} />
        </div>
      );
    }

    render(<Siblings />);

    // A registered first, so last-registered-wins would pick C. Focus in A
    // has to override that.
    screen.getByRole('button', { name: 'Prvek v A' }).focus();

    await user.keyboard('{Escape}');
    expect(screen.queryByText('A otevřeno')).not.toBeInTheDocument();
    expect(screen.getByText('C otevřeno')).toBeInTheDocument();
  });

  it('binds one document listener for the whole set, and releases it when the set empties', () => {
    const add = jest.spyOn(document, 'addEventListener');
    const remove = jest.spyOn(document, 'removeEventListener');

    function Siblings() {
      const { open, close } = useOpenSet({ A: true, B: true, C: true });
      return (
        <div>
          <ProbeLayer name="A" open={open.A} onDismiss={close('A')} />
          <ProbeLayer name="B" open={open.B} onDismiss={close('B')} />
          <ProbeLayer name="C" open={open.C} onDismiss={close('C')} />
        </div>
      );
    }

    const { unmount } = render(<Siblings />);

    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);

    unmount();

    expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);

    add.mockRestore();
    remove.mockRestore();
  });
});

describe('Escape across sibling layers', () => {
  it('closes the menu the keyboard is in, not an unrelated hovered tooltip', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <Dropdown trigger="Menu" items={ITEMS} />
        <HoverTrigger label="Detail" text="Nápověda" />
      </div>
    );

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Hover moves the pointer but not the keyboard: focus stays on the menu
    // item, so an Escape now is unambiguously aimed at the menu.
    await user.hover(screen.getByRole('button', { name: 'Detail' }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'První' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    // And the tooltip is still reachable by a second press — nothing has been
    // swallowed permanently.
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes the focused tooltip rather than the one merely hovered', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <HoverTrigger label="Alfa" text="Popis alfa" />
        <HoverTrigger label="Beta" text="Popis beta" />
      </div>
    );

    // Tab rather than click: the pointer must never visit the first trigger,
    // or leaving it would hide its bubble again. Focus opens the first bubble;
    // hovering the second opens that one too and registers it later, without
    // taking the keyboard off the first trigger.
    await user.tab();
    await user.hover(screen.getByRole('button', { name: 'Beta' }));
    expect(screen.getByText('Popis alfa')).toBeInTheDocument();
    expect(screen.getByText('Popis beta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alfa' })).toHaveFocus();

    await user.keyboard('{Escape}');

    // The tooltip wrapper contains its own trigger, which is how the set can
    // tell a focus-opened bubble from a hover-opened one.
    expect(screen.queryByText('Popis alfa')).not.toBeInTheDocument();
    expect(screen.getByText('Popis beta')).toBeInTheDocument();
  });
});

/**
 * A modal opened from inside another modal — a confirmation over a settings
 * dialog — is an ordinary composition, and it is the one shape that cannot be
 * read off the DOM: both dialogs portal to `document.body`, so nesting them in
 * JSX makes them DOM *siblings*. The tests below are about the layer tree
 * (which follows React, through the portal) rather than about `contains`.
 */
function NestedModals() {
  const [outer, setOuter] = useState(true);
  const [inner, setInner] = useState(true);

  return (
    <Modal open={outer} onClose={() => setOuter(false)} title="Vnější" hideCloseButton>
      <button type="button">Prvek ve vnějším</button>
      <button type="button">Druhý prvek ve vnějším</button>

      <Modal open={inner} onClose={() => setInner(false)} title="Vnitřní" hideCloseButton>
        <button type="button">Prvek ve vnitřním</button>
        {/* On the second control, not the first: the first is what the trap
            focuses, and a hover-opened layer there would open by itself and
            change how many presses each test below is about. */}
        <HoverTrigger label="Druhý prvek ve vnitřním" text="Nápověda" />
      </Modal>
    </Modal>
  );
}

describe('Escape across overlays nested in JSX but portalled to the same parent', () => {
  it('dismisses one layer per press, innermost first, across the portal boundary', async () => {
    const user = userEvent.setup();

    render(<NestedModals />);

    expect(screen.getByRole('dialog', { name: 'Vnější' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Vnitřní' })).toBeInTheDocument();

    // Hover rather than focus, so the bubble's presence does not depend on
    // which trap won the focus race — that is the next test's subject.
    await user.hover(screen.getByRole('button', { name: 'Druhý prvek ve vnitřním' }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    // Three layers open. One press must take exactly the innermost one.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Vnitřní' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Vnější' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Vnitřní' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Vnější' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Vnější' })).not.toBeInTheDocument();
  });

  it('leaves focus in the overlay on top instead of the one beneath reclaiming it', async () => {
    const user = userEvent.setup();

    render(<NestedModals />);

    const inner = screen.getByRole('dialog', { name: 'Vnitřní' });

    // The outer trap cannot see past the inner one's portal boundary, so
    // letting it run its "focus the first thing inside me" step would move
    // focus to its own container — out of the overlay actually on top.
    expect(screen.getByRole('button', { name: 'Prvek ve vnitřním' })).toHaveFocus();
    expect(inner).toContainElement(document.activeElement as HTMLElement);

    // And Tab stays inside the top overlay rather than being pulled out by the
    // trap underneath it.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Druhý prvek ve vnitřním' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Prvek ve vnitřním' })).toHaveFocus();
  });

  it('returns focus to the control that opened the overlay, not to the first one', async () => {
    const user = userEvent.setup();

    function ConfirmOverSettings() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(false);

      return (
        <Modal open={outer} onClose={() => setOuter(false)} title="Nastavení" hideCloseButton>
          <button type="button">Jiný prvek</button>
          {/* Deliberately not the first control, so "resumed and grabbed the
              first thing" and "the closing layer put focus back" are two
              different answers. */}
          <button type="button" onClick={() => setInner(true)}>
            Otevřít potvrzení
          </button>

          <Modal open={inner} onClose={() => setInner(false)} title="Potvrzení" hideCloseButton>
            <button type="button">Potvrdit</button>
          </Modal>
        </Modal>
      );
    }

    render(<ConfirmOverSettings />);

    await user.click(screen.getByRole('button', { name: 'Otevřít potvrzení' }));
    expect(screen.getByRole('button', { name: 'Potvrdit' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Potvrzení' })).not.toBeInTheDocument();

    // Resuming a paused trap must not move focus: the layer that closed owns
    // putting it back, and it knows the better answer.
    expect(screen.getByRole('button', { name: 'Otevřít potvrzení' })).toHaveFocus();
  });

  it('hands the trap back to the overlay beneath once the one on top closes', async () => {
    const user = userEvent.setup();

    render(<NestedModals />);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Vnitřní' })).not.toBeInTheDocument();

    // Resuming takes focus back into the overlay that is now on top...
    expect(screen.getByRole('dialog', { name: 'Vnější' })).toContainElement(
      document.activeElement as HTMLElement
    );

    // ...and the trap was paused, not dismantled, so Tab cycles inside it again.
    screen.getByRole('button', { name: 'Prvek ve vnějším' }).focus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Druhý prvek ve vnějším' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Prvek ve vnějším' })).toHaveFocus();
  });
});

/** Two modals with no nesting between them: siblings in JSX and in the tree. */
function TwoModals() {
  const [first, setFirst] = useState(true);
  const [second, setSecond] = useState(true);

  return (
    <div>
      <Modal open={first} onClose={() => setFirst(false)} title="První" hideCloseButton>
        <button type="button">Prvek v první</button>
        <button type="button">Druhý prvek v první</button>
      </Modal>
      <Modal open={second} onClose={() => setSecond(false)} title="Druhá" hideCloseButton>
        <button type="button">Prvek v druhé</button>
        <button type="button">Druhý prvek v druhé</button>
      </Modal>
    </div>
  );
}

describe('the layer set under the shapes the review exercised', () => {
  it('gives Escape to a menu inside a modal before the modal itself', async () => {
    const user = userEvent.setup();

    function MenuInModal() {
      const [open, setOpen] = useState(true);
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="Nastavení" hideCloseButton>
          <Dropdown trigger="Menu" items={ITEMS} />
        </Modal>
      );
    }

    render(<MenuInModal />);

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets only the newest of two unrelated modals confine Tab', async () => {
    const user = userEvent.setup();

    render(<TwoModals />);

    // Two traps bound at once would fight over every Tab: each would see focus
    // sitting outside its own container and haul it back, and the press would
    // move nothing.
    expect(screen.getByRole('button', { name: 'Prvek v druhé' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Druhý prvek v druhé' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Prvek v druhé' })).toHaveFocus();
  });

  it('treats two modals with no nesting between them as siblings, newest first', async () => {
    const user = userEvent.setup();

    render(<TwoModals />);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Druhá' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'První' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'První' })).not.toBeInTheDocument();
  });

  it('still dismisses the only open overlay when nothing holds focus at all', async () => {
    const user = userEvent.setup();

    function OneModal() {
      const [open, setOpen] = useState(true);
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="Nastavení" hideCloseButton>
          <button type="button">Prvek</button>
        </Modal>
      );
    }

    render(<OneModal />);

    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('leaves nothing behind for a layer that opens and closes within one tick', async () => {
    const user = userEvent.setup();

    function AbortedOpen() {
      const [a, setA] = useState(true);
      const [b, setB] = useState(false);

      return (
        <div>
          <ProbeLayer name="A" open={a} onDismiss={() => setA(false)} />
          <button
            type="button"
            onClick={() => {
              setB(true);
              setB(false);
            }}
          >
            Otevřít a hned zavřít B
          </button>
          <ProbeLayer name="B" open={b} onDismiss={() => setB(false)} />
        </div>
      );
    }

    render(<AbortedOpen />);

    await user.click(screen.getByRole('button', { name: 'Otevřít a hned zavřít B' }));
    expect(screen.queryByText('B otevřeno')).not.toBeInTheDocument();

    // B never became a layer, so the press belongs to A and nothing throws.
    await user.keyboard('{Escape}');
    expect(screen.queryByText('A otevřeno')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
  });
});
