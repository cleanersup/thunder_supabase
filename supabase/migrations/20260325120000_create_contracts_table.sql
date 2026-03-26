-- Contracts feature: table + RLS (consolidates create + renewed_at + payment_frequency)

CREATE TABLE public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  contract_number text NOT NULL,
  recipient_name text NOT NULL,
  recipient_email text,
  recipient_phone text,
  recipient_address text,
  service_type text DEFAULT 'Cleaning Service',
  status text NOT NULL DEFAULT 'Draft',
  start_date date,
  end_date date,
  total numeric DEFAULT 0,
  who_we_are text,
  why_choose_us text,
  our_services text,
  service_coverage text,
  sections jsonb DEFAULT '{}'::jsonb,
  custom_clause_titles jsonb DEFAULT '{}'::jsonb,
  delivery_method text,
  renewed_at timestamp with time zone DEFAULT NULL,
  payment_frequency text DEFAULT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own contracts" ON public.contracts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own contracts" ON public.contracts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own contracts" ON public.contracts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own contracts" ON public.contracts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
