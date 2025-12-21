# Implementation Plan: React Query Integration for Performance Optimization

## Objective
Eliminate the delay and "reconnecting" sensation during page navigation by implementing a robust global caching layer using **TanStack Query (React Query)**. This will enable instant page transitions, background data updates, and a smoother user experience.

## Strategy
We will move away from component-local state (fetching data inside `useEffect` on every mount) to a global server-state management approach.

## Detailed Steps

### Phase 1: Infrastructure Setup
1.  **Install Dependencies**
    *   Run `npm install @tanstack/react-query` in the `UI` directory.
2.  **Initialize Query Client**
    *   Modify `UI/src/main.tsx`:
        *   Create a `queryClient` instance.
        *   Wrap the application with `<QueryClientProvider client={queryClient}>`.
        *   Configure default options (e.g., `staleTime: 5 minutes` for metadata, `staleTime: 30 seconds` for dashboard stats) to prevent over-fetching.

### Phase 2: Hook Abstraction (Create reusable data hooks)
We will create a new directory `UI/src/hooks` to centralize data fetching logic.

1.  **`useSyncStatus` Hook**
    *   Purpose: Manage the "Connected to Cloud" status globally.
    *   Refactor the polling logic from `Dashboard.tsx` into this hook.
    *   Use `refetchInterval` for the 30-second polling.

2.  **`useMetadata` Hooks**
    *   `useUnits`: Cache unit data (rarely changes).
    *   `useCategories`: Cache category data.
    *   `useDestinations`: Cache destinations.
    *   `useProviders`: Cache providers.

3.  **Feature-Specific Hooks**
    *   `useDashboardStats`: Fetch summary statistics.
    *   `useRecentLogs`: Fetch recent movement logs.
    *   `useItems`: Fetch items with pagination support (using `keepPreviousData: true` for smooth table transitions).

### Phase 3: Component Refactoring
Iteratively refactor pages to use these hooks instead of local state.

1.  **`Dashboard.tsx`**
    *   Remove `useEffect`, `isLoading`, `error` local states.
    *   Replace with `const { data: stats, isLoading } = useDashboardStats();`.
    *   Result: Dashboard shows immediately if data is in cache; updates in background.

2.  **`ItemsManagement.tsx`**
    *   Refactor to use `useItems` query.
    *   Implement `useMutation` for "Add Item" and "Edit Item" actions.
    *   On success of mutation -> `queryClient.invalidateQueries({ queryKey: ['items'] })` to automatically refresh the list.

3.  **Other Management Pages**
    *   Apply similar patterns to `UnitManagement`, `CategoryManagement`, etc.

### Phase 4: Mutation & Cache Invalidation
Ensure the UI always reflects the latest state after user actions.

1.  **Global Invalidation Strategy**
    *   When an item is added/moved (via `itemsService` or `statsService`), invalidate relevant queries:
        *   `['dashboard-stats']`
        *   `['items']`
        *   `['recent-logs']`
    *   This ensures that if a user adds an item in the "Items" page and goes to "Dashboard", the numbers are already correct or updating.

## Rollout Plan
1.  Setup & Config.
2.  Refactor `Dashboard` (High impact).
3.  Refactor `ItemsManagement` (High impact).
4.  Refactor remaining pages.
5.  Testing & Verification.

## Verification
*   **Performance:** Switch between Dashboard and Items page 5 times. Expectation: No loading spinners after the first load.
*   **Data Integrity:** Add an item. Check Dashboard counter. Expectation: Counter increments automatically.
*   **Network:** Verify network tab shows significantly fewer duplicate requests.
