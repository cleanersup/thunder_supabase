-- Create estimates table
CREATE TABLE public.estimates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  client_name TEXT NOT NULL,
  company_name TEXT,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  apt TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  service_type TEXT NOT NULL,
  service_sub_type TEXT,
  service_scope TEXT,
  main_data JSONB DEFAULT '[]'::jsonb,
  additional_data JSONB DEFAULT '[]'::jsonb,
  additional_items JSONB DEFAULT '[]'::jsonb,
  extra_services JSONB DEFAULT '[]'::jsonb,
  pets TEXT,
  laundry TEXT,
  discount_type TEXT,
  discount_value NUMERIC,
  subtotal NUMERIC NOT NULL,
  total NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  estimate_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own estimates" 
ON public.estimates 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own estimates" 
ON public.estimates 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own estimates" 
ON public.estimates 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own estimates" 
ON public.estimates 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_estimates_updated_at
BEFORE UPDATE ON public.estimates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();