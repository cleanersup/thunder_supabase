-- Enable realtime for route_appointments table
ALTER TABLE route_appointments REPLICA IDENTITY FULL;

-- Add route_appointments to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE route_appointments;