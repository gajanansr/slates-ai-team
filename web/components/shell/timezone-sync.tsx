'use client';
import { useEffect } from 'react';
import { syncTimezone } from '@/app/(app)/reminder-actions';

/** Keeps the server's idea of "today" and repeat times in the user's own timezone. */
export function TimezoneSync({ current }: { current: string | null }) {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== current) void syncTimezone(tz);
  }, [current]);
  return null;
}
