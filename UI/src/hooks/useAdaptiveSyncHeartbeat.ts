import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';

const ACTIVE_INTERVAL_MS = 30000; // 30 seconds when actively interacting (>= 30s)
const IDLE_INTERVAL_MS = 60000;   // 60 seconds when idle (>= 60s)
const IDLE_THRESHOLD_MS = 30000;  // 30 seconds without interaction considered idle

/**
 * Coordinated adaptive background heartbeat that replaces scattered refetchIntervals.
 * Refetches only queries that are currently active/mounted, adapting frequency
 * based on whether the user is actively interacting or idle.
 */
export const useAdaptiveSyncHeartbeat = () => {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const lastActivityRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const onUserActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const events: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((evt) => {
      window.addEventListener(evt, onUserActivity, { passive: true });
    });

    let isCancelled = false;

    const scheduleNext = () => {
      if (isCancelled) return;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      const timeSinceActivity = Date.now() - lastActivityRef.current;
      const isIdle = timeSinceActivity >= IDLE_THRESHOLD_MS;
      const delay = isIdle ? IDLE_INTERVAL_MS : ACTIVE_INTERVAL_MS;

      timerRef.current = setTimeout(runHeartbeat, delay);
    };

    const runHeartbeat = async () => {
      if (isCancelled) return;

      // Skip network fetches when app/tab is in the background
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      try {
        // Refetches ONLY queries that are currently active/mounted
        await queryClient.refetchQueries({ type: 'active' });
      } catch (err) {
        console.warn('Adaptive sync heartbeat error:', err);
      } finally {
        scheduleNext();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        lastActivityRef.current = Date.now();
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        runHeartbeat();
      } else if (document.visibilityState === 'hidden') {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    // Schedule the first heartbeat tick
    scheduleNext();

    return () => {
      isCancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      events.forEach((evt) => {
        window.removeEventListener(evt, onUserActivity);
      });
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isAuthenticated, queryClient]);
};
