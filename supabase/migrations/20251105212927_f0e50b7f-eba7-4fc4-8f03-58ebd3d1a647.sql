-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Allow public booking submissions" ON public.bookings;

-- Create a new PERMISSIVE policy that allows public submissions
CREATE POLICY "Allow public booking submissions"
ON public.bookings
AS PERMISSIVE
FOR INSERT
TO anon, authenticated
WITH CHECK (true);