-- Add foreign key constraint between time_entries and employees
ALTER TABLE public.time_entries
ADD CONSTRAINT fk_time_entries_employee
FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;