-- Drop the existing policy
DROP POLICY IF EXISTS "Allow public booking submissions" ON public.bookings;

-- Create the correct policy for anonymous and authenticated users
CREATE POLICY "Allow public booking submissions"
ON public.bookings
FOR INSERT
TO anon, authenticated
WITH CHECK (true);