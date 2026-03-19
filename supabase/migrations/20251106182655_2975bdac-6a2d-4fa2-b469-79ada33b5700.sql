-- Drop the old constraint
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_type_check;

-- Add new constraint with all activity types
ALTER TABLE activities ADD CONSTRAINT activities_type_check 
CHECK (type IN (
  -- Estimates
  'estimate_created',
  'estimate_sent', 
  'estimate_accepted',
  'estimate_canceled',
  -- Invoices
  'invoice_created',
  'invoice_sent',
  'invoice_paid',
  'invoice_canceled',
  -- Routes
  'route_created',
  'appointment_created',
  'appointment_updated',
  -- Bookings
  'booking_received',
  'booking_updated',
  -- CRM (Leads and Clients)
  'lead_created',
  'lead_updated',
  'client_created',
  'client_updated',
  -- Tasks
  'task_created',
  'task_completed'
));