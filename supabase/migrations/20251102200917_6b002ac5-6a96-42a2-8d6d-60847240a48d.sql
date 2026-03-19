-- Drop the existing policy
DROP POLICY IF EXISTS "Public can create bookings" ON public.bookings;

-- Create a new policy that allows all roles (including public) to insert
CREATE POLICY "Public can create bookings"
ON public.bookings
FOR INSERT
WITH CHECK (true);