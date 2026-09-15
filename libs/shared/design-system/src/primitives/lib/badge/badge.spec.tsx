import { render, screen } from '@testing-library/react';

import { Badge } from './badge';

describe('Badge', () => {
  it('renders its content as plain text', () => {
    render(<Badge>Otevřeno</Badge>);

    expect(screen.getByText('Otevřeno')).toBeInTheDocument();
  });

  it('adds no role of its own — it is a label, not a control', () => {
    const { container } = render(<Badge>Otevřeno</Badge>);

    const badge = container.firstElementChild;
    expect(badge?.tagName).toBe('SPAN');
    expect(badge).not.toHaveAttribute('role');
  });

  it('renders one colour pair per tone', () => {
    const { container, rerender } = render(<Badge tone="success">Otevřeno</Badge>);
    expect(container.firstElementChild).toHaveClass('bg-brand-green-100');

    rerender(<Badge tone="danger">Zavřeno</Badge>);
    expect(container.firstElementChild).toHaveClass('bg-danger-100');
  });

  it('defaults to the neutral tone', () => {
    const { container } = render(<Badge>Nezměněno</Badge>);

    expect(container.firstElementChild).toHaveClass('bg-bg-muted');
  });

  it('passes attributes and caller classes through', () => {
    render(
      <Badge className="custom-class" data-testid="badge" title="Popisek">
        Otevřeno
      </Badge>
    );

    const badge = screen.getByTestId('badge');
    expect(badge).toHaveClass('custom-class');
    expect(badge).toHaveAttribute('title', 'Popisek');
  });

  it('defaults to size=md, unchanged from before the prop existed', () => {
    const { container } = render(<Badge>Otevřeno</Badge>);

    expect(container.firstElementChild).toHaveClass(
      'inline-flex',
      'h-6',
      'items-center',
      'rounded-cta',
      'px-3',
      'text-xs',
      'font-bold',
      'whitespace-nowrap'
    );
  });

  it('renders the smaller tag shape at size=sm, with no height utility', () => {
    const { container } = render(<Badge size="sm">Host</Badge>);

    const badge = container.firstElementChild;
    expect(badge).toHaveClass(
      'rounded-xs',
      'px-2',
      'py-0.5',
      'text-xs',
      'font-bold',
      'uppercase',
      'tracking-caps'
    );
    expect(badge).not.toHaveClass('h-6', 'rounded-cta');
  });

  it('gives the tag tone --fg on the yellow tint, distinct from warning', () => {
    const { container } = render(
      <Badge tone="tag" size="sm">
        Host
      </Badge>
    );

    const badge = container.firstElementChild;
    expect(badge).toHaveClass('bg-brand-yellow-100', 'text-fg');
    expect(badge).not.toHaveClass('text-fg-on-yellow');
  });

  it('forces uppercase via transform independently of size', () => {
    const { container } = render(
      <Badge tone="info" transform="uppercase">
        Admin
      </Badge>
    );

    const badge = container.firstElementChild;
    expect(badge).toHaveClass('uppercase', 'tracking-caps', 'h-6');
  });

  it('applies no transform by default', () => {
    const { container } = render(<Badge>Otevřeno</Badge>);

    expect(container.firstElementChild).not.toHaveClass('uppercase');
  });
});
