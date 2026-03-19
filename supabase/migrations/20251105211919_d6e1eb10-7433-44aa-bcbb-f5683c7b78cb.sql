-- Drop existing INSERT policy for public booking submissions
DROP POLICY IF EXISTS "Allow public booking submissions" ON public.bookings;

-- Recreate the policy with explicit permissive mode
CREATE POLICY "Allow public booking submissions"
ON public.bookings
FOR INSERT
TO anon, authenticated
WITH CHECK (true);