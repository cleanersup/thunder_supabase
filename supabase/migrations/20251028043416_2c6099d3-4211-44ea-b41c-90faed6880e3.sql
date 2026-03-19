-- Create storage bucket for route files (photos and contracts)
INSERT INTO storage.buckets (id, name, public)
VALUES ('route-files', 'route-files', true)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for route-files bucket
CREATE POLICY "Users can upload their own route files"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'route-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own route files"
ON storage.objects
FOR SELECT
USING (bucket_id = 'route-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own route files"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'route-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own route files"
ON storage.objects
FOR DELETE
USING (bucket_id = 'route-files' AND auth.uid()::text = (storage.foldername(name))[1]);