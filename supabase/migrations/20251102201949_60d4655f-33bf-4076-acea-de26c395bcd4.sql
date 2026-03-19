-- 1. Re-enable RLS on bookings with correct policy
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- 2. Enable realtime for bookings table
ALTER TABLE public.bookings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;