-- Drop the existing restrictive INSERT policy
DROP POLICY IF EXISTS "Public can create bookings" ON public.bookings;

-- Create a new permissive policy that allows anyone to insert bookings
CREATE POLICY "Allow public booking submissions"
ON public.bookings
FOR INSERT
TO anon, authenticated
WITH CHECK (true);