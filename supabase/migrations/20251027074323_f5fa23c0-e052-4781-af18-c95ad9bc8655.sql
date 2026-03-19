-- Allow anyone to read company_name and company_logo from profiles
-- This is needed for the public booking form to display company information

-- Drop the existing restrictive SELECT policy
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

-- Create a new policy that allows anyone to read profiles
CREATE POLICY "Anyone can view profiles"
  ON public.profiles
  FOR SELECT
  USING (true);

-- Keep the update policy restricted to the user's own profile
-- The existing "Users can update their own profile" policy is fine

-- Keep the insert policy restricted to the user's own profile
-- The existing "Users can insert their own profile" policy is fine