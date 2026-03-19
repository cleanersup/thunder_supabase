-- Create a security definer function to check if a user is a valid employee
CREATE OR REPLACE FUNCTION public.is_valid_employee_for_entry(_employee_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees
    WHERE id = _employee_id
      AND user_id = _user_id
  )
$$;

-- Drop existing time_entries policies
DROP POLICY IF EXISTS "Users can create their own time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can update their own time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can view their own time entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can delete their own time entries" ON public.time_entries;

-- Create new policies that allow both company owner and employees
CREATE POLICY "Company owners and employees can create time entries"
ON public.time_entries
FOR INSERT
WITH CHECK (
  auth.uid() = user_id 
  OR public.is_valid_employee_for_entry(employee_id, user_id)
);

CREATE POLICY "Company owners and employees can update time entries"
ON public.time_entries
FOR UPDATE
USING (
  auth.uid() = user_id 
  OR public.is_valid_employee_for_entry(employee_id, user_id)
);

CREATE POLICY "Company owners and employees can view time entries"
ON public.time_entries
FOR SELECT
USING (
  auth.uid() = user_id 
  OR public.is_valid_employee_for_entry(employee_id, user_id)
);

CREATE POLICY "Company owners can delete time entries"
ON public.time_entries
FOR DELETE
USING (auth.uid() = user_id);