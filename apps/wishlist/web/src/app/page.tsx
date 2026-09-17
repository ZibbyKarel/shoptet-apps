import { Button, Card, Container, Stack } from '@garage/design-system/primitives';

/**
 * The scaffold's one screen.
 *
 * It is a hello world with a job: everything on it comes from
 * `@garage/design-system`, so rendering it proves the whole shared chain
 * resolves from a second application — the TypeScript path alias, the Nx
 * module boundary (`type:app` may depend on anything, `scope:web` on
 * `scope:web` and `scope:shared`), the Tailwind v4 `@source` scan that has to
 * reach into the design system's own directories, and the token custom
 * properties the components spend.
 *
 * A page of plain `<div>`s would have proved none of that, and the wiring is
 * the only thing there is to get wrong at this stage.
 */
export default function HomePage() {
  return (
    <Container>
      <Stack spacing={8}>
        <h1>Wishlist</h1>
        <Card>
          <Stack spacing={4}>
            <p>
              Feature requests for <code>shoptet-partner-cli</code>. Nothing is wired up yet — this
              is the scaffold.
            </p>
            <Button>Hello world</Button>
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
}
