-- Shift photos: match dashboard request-attachment display pattern.
-- route-files is public + getPublicUrl; shift-photos was private + signed URLs
-- that often embed the internal Kong host and break in the Crew app.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'shift-photos',
  'shift-photos',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
SET public = true;

-- Public read so /storage/v1/object/public/shift-photos/... works (same as route-files).
DROP POLICY IF EXISTS "Public can read shift photos" ON storage.objects;
CREATE POLICY "Public can read shift photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'shift-photos');
