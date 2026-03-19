-- Create bookings table to store booking requests from public forms
CREATE TABLE public.bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_owner_id UUID NOT NULL,
  lead_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('residential', 'commercial')),
  street TEXT NOT NULL,
  apt_suite TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  preferred_date DATE,
  time_preference TEXT,
  bedrooms INTEGER,
  bathrooms INTEGER,
  additional_services JSONB DEFAULT '[]'::jsonb,
  commercial_property_type TEXT,
  other_commercial_type TEXT,
  service_details TEXT,
  custom_answers JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Create policies - business owners can view their bookings
CREATE POLICY "Business owners can view their bookings" 
ON public.bookings 
FOR SELECT 
USING (auth.uid() = business_owner_id);

-- Allow public to create bookings (anyone can submit a booking)
CREATE POLICY "Anyone can create bookings" 
ON public.bookings 
FOR INSERT 
WITH CHECK (true);

-- Business owners can update their bookings
CREATE POLICY "Business owners can update their bookings" 
ON public.bookings 
FOR UPDATE 
USING (auth.uid() = business_owner_id);

-- Business owners can delete their bookings
CREATE POLICY "Business owners can delete their bookings" 
ON public.bookings 
FOR DELETE 
USING (auth.uid() = business_owner_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_bookings_updated_at
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();