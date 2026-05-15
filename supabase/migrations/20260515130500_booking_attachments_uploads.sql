-- Booking attachments (images + PDFs) using the existing route-files storage pattern.
-- Mirrors the JSON metadata-array approach used by other entities with file uploads.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.bookings.attachments IS
  'Uploaded booking files metadata array. Each item typically includes path, name, type, size, and public_url.';

-- Ensure booking-specific policies exist for route-files paths:
-- <owner_id>/bookings/<booking_id>/<timestamp-random-safeName>
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users can upload their own booking files'
  ) THEN
    CREATE POLICY "Users can upload their own booking files"
      ON storage.objects
      FOR INSERT
      WITH CHECK (
        bucket_id = 'route-files'
        AND auth.uid()::text = (storage.foldername(name))[1]
        AND (storage.foldername(name))[2] = 'bookings'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users can view their own booking files'
  ) THEN
    CREATE POLICY "Users can view their own booking files"
      ON storage.objects
      FOR SELECT
      USING (
        bucket_id = 'route-files'
        AND auth.uid()::text = (storage.foldername(name))[1]
        AND (storage.foldername(name))[2] = 'bookings'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users can update their own booking files'
  ) THEN
    CREATE POLICY "Users can update their own booking files"
      ON storage.objects
      FOR UPDATE
      USING (
        bucket_id = 'route-files'
        AND auth.uid()::text = (storage.foldername(name))[1]
        AND (storage.foldername(name))[2] = 'bookings'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users can delete their own booking files'
  ) THEN
    CREATE POLICY "Users can delete their own booking files"
      ON storage.objects
      FOR DELETE
      USING (
        bucket_id = 'route-files'
        AND auth.uid()::text = (storage.foldername(name))[1]
        AND (storage.foldername(name))[2] = 'bookings'
      );
  END IF;
END
$$;
