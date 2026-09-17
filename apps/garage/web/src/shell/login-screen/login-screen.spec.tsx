import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntlProvider } from '@garage/i18n';
import cs from '../../../messages/cs.json';
import { LoginScreen } from './login-screen';

/**
 * The signed-out canvas. What matters here is not the pixels but three things
 * that would each be a security or a product defect if they drifted:
 *
 * - the copy is Czech and comes from the catalog, not from the component;
 * - the only control is a **submit**, so the sign-in redirect is issued by the
 *   server action rather than by browser JavaScript;
 * - there is nothing else on the page to interact with.
 */
function renderLoginScreen() {
  const action = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  render(
    <IntlProvider locale="cs" messages={cs}>
      <LoginScreen action={action} />
    </IntlProvider>
  );
  return { action, user: userEvent.setup() };
}

describe('LoginScreen', () => {
  it('titles the page with the product name', () => {
    renderLoginScreen();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('brand');
  });

  it('shows both lines of the Czech tagline and the footnote', () => {
    renderLoginScreen();

    expect(screen.getByText(/tagline/)).toBeInTheDocument();
    expect(screen.getByText(/taglineSecondary/)).toBeInTheDocument();
    expect(screen.getByText('footnote')).toBeInTheDocument();
  });

  it('offers exactly one control, and it submits a form', () => {
    renderLoginScreen();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('signIn');
    expect(buttons[0]).toHaveAttribute('type', 'submit');
  });

  it('runs the server action when the button is pressed', async () => {
    const { action, user } = renderLoginScreen();

    await user.click(screen.getByRole('button', { name: 'signIn' }));

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('shows no password field, and no alternative way in', () => {
    renderLoginScreen();

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
