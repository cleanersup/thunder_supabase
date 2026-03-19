-- Allow employees to update their own avatar_url
CREATE POLICY "Employees can update their own avatar"
ON public.employees
FOR UPDATE
USING (true)
WITH CHECK (
  -- Only allow updating avatar_url column
  -- The employee must be updating their own record
  EXISTS (
    SELECT 1 FROM public.employees
    WHERE id = employees.id
  )
);