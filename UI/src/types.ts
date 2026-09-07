export type Item = {
  id: number; // Standardize to number as per backend
  name: string;
  current_quantity: number;
  unit_id: number;
  unit_name: string; // Often joined from backend or looked up
  sub_category_id?: number | null;
  sub_category_name?: string | null;
  main_category_id?: number | null;
  provider?: string | null;
  cost?: number | null;
  status?: 'active' | 'inactive' | 'archived';
  barcode?: string | null;
  // Add other common item properties if they exist, e.g., description, if it becomes widely used.
};

export type Destination = {
  id: number;
  name: string;
};

export type Unit = {
  id: number; // Standardize to number as per backend
  name: string;
};

export type Category = {
  id: number;
  name: string;
  parent_id?: number | null;
};

export type MovementLogEntry = {
  id: number;
  item_id: number;
  item_name: string;
  action_type: string;
  quantity_changed?: number | null;
  resulting_quantity?: number | null;
  provider?: string | null;
  cost_per_item?: number | null;
  details?: string | null;
  person_name?: string | null;
  destination_name?: string | null; // For removals
  timestamp: string; // ISO date string
  actor_name?: string | null;
  po_line_id?: number | null;
  leave_line_id?: number | null;
  return_event_id?: number | null;
};

export type Provider = {
  id: number;
  name: string;
};

// You can add other shared types/interfaces here as the application grows. 