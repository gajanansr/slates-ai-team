'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

/**
 * Subscribes to this user's slates/activity changes (RLS-filtered by Supabase Realtime)
 * and refreshes server components, so agent writes appear without a reload.
 * DELETE is deliberately not subscribed (Realtime cannot RLS-filter deletes); every
 * delete also inserts an activity row, which triggers the refresh.
 */
export function LiveRefresh({ userId }: { userId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    };
    const channel = sb
      .channel(`slates:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'slates', filter: `owner_id=eq.${userId}` }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'slates', filter: `owner_id=eq.${userId}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity', filter: `owner_id=eq.${userId}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reminders', filter: `owner_id=eq.${userId}` }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reminders', filter: `owner_id=eq.${userId}` }, refresh)
      .subscribe();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) clearTimeout(timer.current);
      sb.removeChannel(channel);
    };
  }, [router, userId]);

  return null;
}
