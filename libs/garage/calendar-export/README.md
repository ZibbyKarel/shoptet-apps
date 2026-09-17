# calendar-export

The `ical-generator` wrapper: the **only** place in the workspace allowed to import it.
Turns contract values (`IcsCalendarEntry[]`) into an RFC 5545 document for the personal
ICS feed.

See `doc/ics.md` for the endpoint and `doc/wrappers.md` for the wrapper rules.

## Running unit tests

Run `nx test calendar-export` to execute the unit tests via [Jest](https://jestjs.io).
