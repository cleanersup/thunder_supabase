-- Create a public bucket for estimate PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('estimate-pdfs', 'estimate-pdfs', true);

-- Create RLS policies for the estimate-pdfs bucket
CREATE POLICY "Anyone can view estimate PDFs"
ON storage.objects
FOR SELECT
USING (bucket_id = 'estimate-pdfs');

CREATE POLICY "Authenticated users can upload estimate PDFs"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'estimate-pdfs' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update their estimate PDFs"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'estimate-pdfs' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete their estimate PDFs"
ON storage.objects
FOR DELETE
USING (bucket_id = 'estimate-pdfs' AND auth.role() = 'authenticated');