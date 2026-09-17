/**
 * `@garage/calendar-export` — the ICS half of the wrapper layer.
 *
 * The single place in the workspace that may import `ical-generator`
 * (`eslint.config.mjs`, `WRAPPED_LIBRARIES`). `apps/garage/api`'s calendar controller
 * calls `buildReservationCalendar` and never sees the library underneath.
 *
 * `ICS_CALENDAR_NAME` and `icsEventUid` come out beside it because
 * `apps/garage/api`'s calendar pipeline suite reads a rendered feed back and has to
 * name what it expects to find in it; writing those two out a second time
 * there is how a test starts passing against the wrong document.
 *
 * The rest of `reservation-calendar.ts` — `ICS_REFRESH_INTERVAL_SECONDS`,
 * `ICS_UID_DOMAIN`, `icsEventSummary`, `icsEventDescription` — stays
 * module-scoped. It is how the document is built, not what a caller asks for,
 * and the lib's own spec imports it from `./lib/reservation-calendar` already.
 */
export {
  ICS_CALENDAR_NAME,
  buildReservationCalendar,
  icsEventUid,
} from './lib/reservation-calendar';
