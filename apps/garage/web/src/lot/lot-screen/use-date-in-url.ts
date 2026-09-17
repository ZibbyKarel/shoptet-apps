'use client';

/**
 * The day shown on `LotScreen`, backed by the URL's `date` query param rather
 * than plain component state — so reloading or sharing the link keeps the
 * same day on screen (backlog item 7). `router.replace` (never `push`) and
 * `{ scroll: false }`: moving a day is not a new place to go back to, and it
 * must not disturb scroll position on every prev/next click.
 */

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isDateOnly, todayInPrague, type DateOnly } from '@garage/i18n';

const DATE_PARAM = 'date';

function initialDate(paramValue: string | null): DateOnly {
  return paramValue !== null && isDateOnly(paramValue) ? paramValue : todayInPrague();
}

export function useDateInUrl(): [DateOnly, (next: DateOnly) => void] {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [date, setDateState] = useState<DateOnly>(() => initialDate(searchParams.get(DATE_PARAM)));

  const setDate = useCallback(
    (next: DateOnly) => {
      setDateState(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set(DATE_PARAM, next);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  return [date, setDate];
}
