-- Add 'estimate_sent' to the allowed status values for walkthroughs table
ALTER TABLE walkthroughs DROP CONSTRAINT IF EXISTS walkthroughs_status_check;

ALTER TABLE walkthroughs 
ADD CONSTRAINT walkthroughs_status_check 
CHECK (status IN ('Scheduled', 'Pending', 'Completed', 'Cancelled', 'estimate_sent'));