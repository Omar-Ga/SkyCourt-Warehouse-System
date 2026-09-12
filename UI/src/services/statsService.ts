import { apiClient } from './apiClient.ts';
import type { MovementLogEntry } from '../types';

export interface DailySummary {
    additions_today: number;
    withdrawals_today: number;
    returns_today: number;
}

export const statsService = {
    fetchDailySummary: (signal?: AbortSignal) =>
        apiClient.get<DailySummary>('/movement-logs/summary/today', { signal }),

    fetchRecentLogs: async (limit: number = 5, signal?: AbortSignal): Promise<MovementLogEntry[]> => {
        const response = await apiClient.get<{ logs: MovementLogEntry[] }>(
            `/movement-logs?page=1&page_size=${limit}`,
            { signal }
        );
        return response.logs;
    }
};

export interface NormalizedTimestamp {
    isUtc: boolean;
    displayDate: string;
    displayTime: string;
}

export function formatMovementTimestamp(dateString: string): NormalizedTimestamp {
    if (!dateString) return { isUtc: false, displayDate: '-', displayTime: '-' };

    let isoString = dateString.trim();
    // Normalize SQLite CURRENT_TIMESTAMP "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS" (naive UTC from server) to ISO UTC
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(isoString) && !isoString.endsWith('Z') && !isoString.includes('+')) {
        isoString = isoString.replace(' ', 'T') + 'Z';
    }

    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) {
            return { isUtc: false, displayDate: dateString, displayTime: '-' };
        }
        const formattedDate = date.toLocaleDateString('en-GB', {
            timeZone: 'Africa/Cairo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const formattedTime = date.toLocaleTimeString('en-GB', {
            timeZone: 'Africa/Cairo',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
        return {
            isUtc: true,
            displayDate: formattedDate,
            displayTime: formattedTime
        };
    } catch {
        return {
            isUtc: false,
            displayDate: dateString,
            displayTime: '-'
        };
    }
}

export function formatSafeDate(dateString: string): string {
    if (!dateString) return '-';
    const { displayDate, displayTime } = formatMovementTimestamp(dateString);
    if (displayTime && displayTime !== '-') {
        return `${displayDate} ${displayTime}`.trim();
    }
    return displayDate;
}
