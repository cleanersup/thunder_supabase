-- Estimates and invoices already sit in supabase_realtime; the dashboard
-- already subscribes to quick_quotes and contracts, so without this the
-- lists do not refresh when status/viewed_at change from an edge function.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'quick_quotes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quick_quotes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'contracts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contracts;
  END IF;
END $$;
