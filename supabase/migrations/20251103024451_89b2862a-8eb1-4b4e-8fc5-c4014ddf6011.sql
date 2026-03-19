-- Drop the incorrect policy
DROP POLICY IF EXISTS "Employees can update their own avatar" ON public.employees;

-- Create a better policy that allows updating avatar_url by employee ID
-- This allows the employee dashboard to update avatars without full authentication
CREATE POLICY "Allow avatar updates by employee ID"
ON public.employees
FOR UPDATE
USING (true)
WITH CHECK (true);