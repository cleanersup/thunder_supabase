-- Create public storage bucket for badges
INSERT INTO storage.buckets (id, name, public)
VALUES ('badges', 'badges', true);

-- Allow public read access to badges
CREATE POLICY "Public read access for badges"
ON storage.objects FOR SELECT
USING (bucket_id = 'badges');

-- Allow authenticated users to upload badges
CREATE POLICY "Authenticated users can upload badges"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'badges' AND auth.role() = 'authenticated');