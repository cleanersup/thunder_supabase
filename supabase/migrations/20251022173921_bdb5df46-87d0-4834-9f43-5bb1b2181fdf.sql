-- Create invoices table
CREATE TABLE public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  invoice_number text NOT NULL,
  client_name text NOT NULL,
  company_name text,
  email text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  apt text,
  city text NOT NULL,
  state text NOT NULL,
  zip text NOT NULL,
  service_type text NOT NULL,
  total numeric NOT NULL,
  status text NOT NULL CHECK (status IN ('Paid', 'Pending', 'Draft', 'Cancelled')),
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  paid_date date,
  payment_method text,
  cheque_number text,
  invoice_name text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own invoices" 
ON public.invoices 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own invoices" 
ON public.invoices 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own invoices" 
ON public.invoices 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own invoices" 
ON public.invoices 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_invoices_updated_at
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();