-- Add missing fields to route_appointments table
ALTER TABLE route_appointments
ADD COLUMN end_time time without time zone,
ADD COLUMN assigned_employees jsonb DEFAULT '[]'::jsonb,
ADD COLUMN service_type text,
ADD COLUMN cleaning_type text,
ADD COLUMN deposit_required text DEFAULT 'no',
ADD COLUMN deposit_amount numeric,
ADD COLUMN delivery_method text,
ADD COLUMN recurring_frequency text,
ADD COLUMN recurring_duration text,
ADD COLUMN recurring_duration_unit text DEFAULT 'months',
ADD COLUMN selected_week_days jsonb DEFAULT '[]'::jsonb,
ADD COLUMN photos jsonb DEFAULT '[]'::jsonb,
ADD COLUMN uploaded_file text;