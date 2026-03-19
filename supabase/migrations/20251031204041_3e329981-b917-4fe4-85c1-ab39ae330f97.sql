-- Add estimate_id column to route_appointments to track which estimate was used to create the appointment
ALTER TABLE route_appointments
ADD COLUMN estimate_id uuid REFERENCES estimates(id);

-- Add index for better query performance
CREATE INDEX idx_route_appointments_estimate_id ON route_appointments(estimate_id);