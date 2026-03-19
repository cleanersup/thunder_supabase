-- Add operation cost breakdown columns to estimates table
ALTER TABLE public.estimates
ADD COLUMN IF NOT EXISTS labor_cost numeric,
ADD COLUMN IF NOT EXISTS supplies_cost numeric,
ADD COLUMN IF NOT EXISTS overhead_cost numeric,
ADD COLUMN IF NOT EXISTS total_operation_cost numeric;