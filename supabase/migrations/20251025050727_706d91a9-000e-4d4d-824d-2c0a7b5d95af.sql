-- Add status column to clients table
ALTER TABLE public.clients 
ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- Add constraint to ensure only valid statuses
ALTER TABLE public.clients 
ADD CONSTRAINT clients_status_check CHECK (status IN ('active', 'inactive'));