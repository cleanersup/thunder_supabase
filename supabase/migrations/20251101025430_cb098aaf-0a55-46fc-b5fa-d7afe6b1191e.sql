-- Add client_provides_supplies column to commercial_walkthrough_data table
ALTER TABLE commercial_walkthrough_data
ADD COLUMN client_provides_supplies boolean DEFAULT false;