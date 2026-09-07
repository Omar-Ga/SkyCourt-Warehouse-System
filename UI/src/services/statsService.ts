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
    const isUtc = dateString.endsWith('Z') || dateString.endsWith('z') || dateString.includes('+');

    if (!isUtc) {
        // Legacy naive Cairo timestamp: preserve original text without UTC shifting
        const parts = dateString.replace('T', ' ').split(' ');
        const datePart = parts[0] || '';
        const timePart = parts[1] ? parts[1].split('.')[0] : '';
        let formattedDate = datePart;
        try {
            const [year, month, day] = datePart.split('-');
            if (year && month && day) {
                formattedDate = `${day}/${month}/${year}`;
            }
        } catch {
            // fallback
        }
        return {
            isUtc: false,
            displayDate: formattedDate,
            displayTime: timePart || '-'
        };
    }

    // New UTC timestamp: format in Africa/Cairo
    try {
        const date = new Date(dateString);
        const formattedDate = date.toLocaleDateString('ar-EG', {
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
