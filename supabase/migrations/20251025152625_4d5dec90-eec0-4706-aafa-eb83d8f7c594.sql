-- Add decision_result column to leads table
ALTER TABLE public.leads
ADD COLUMN decision_result text;