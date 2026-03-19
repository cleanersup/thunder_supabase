-- Create leads table
CREATE TABLE public.leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  -- Personal Information
  full_name text NOT NULL,
  company_name text,
  phone text NOT NULL,
  email text NOT NULL,
  address text NOT NULL,
  apt_suite text,
  city text NOT NULL,
  state text NOT NULL,
  zip_code text NOT NULL,
  
  -- Lead Details
  lead_source text NOT NULL,
  referral_name text,
  referral_company text,
  service_interested text NOT NULL,
  estimate_budget numeric,
  priority_level text NOT NULL,
  
  -- Follow-up Data
  status text NOT NULL DEFAULT 'new',
  next_followup_date date,
  internal_notes text,
  files jsonb DEFAULT '[]'::jsonb
);

-- Enable Row Level Security
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Create policies for leads
CREATE POLICY "Allow public read access to leads" 
ON public.leads 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can create leads" 
ON public.leads 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update leads" 
ON public.leads 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete leads" 
ON public.leads 
FOR DELETE 
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_leads_updated_at
BEFORE UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();