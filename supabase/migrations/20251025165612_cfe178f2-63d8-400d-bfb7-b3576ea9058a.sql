-- Add new columns to employees table
ALTER TABLE public.employees
ADD COLUMN email TEXT,
ADD COLUMN phone TEXT,
ADD COLUMN street TEXT,
ADD COLUMN apt_suite TEXT,
ADD COLUMN city TEXT,
ADD COLUMN state TEXT,
ADD COLUMN zip TEXT,
ADD COLUMN hourly_rate NUMERIC(10, 2),
ADD COLUMN available_days JSONB DEFAULT '{}'::jsonb,
ADD COLUMN additional_notes TEXT,
ADD COLUMN documents JSONB DEFAULT '[]'::jsonb;

-- Create storage bucket for employee documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-documents', 'employee-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for employee documents
CREATE POLICY "Users can view their own employee documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'employee-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can upload their own employee documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'employee-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own employee documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'employee-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);