-- Drop existing INSERT policy for bookings
DROP POLICY IF EXISTS "Anyone can create bookings" ON public.bookings;

-- Create new policy that explicitly allows public bookings
CREATE POLICY "Public can create bookings"
ON public.bookings
FOR INSERT
TO anon, authenticated
WITH CHECK (true);