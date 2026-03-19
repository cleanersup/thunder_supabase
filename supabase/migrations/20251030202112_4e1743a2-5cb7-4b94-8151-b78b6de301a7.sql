-- Create residential_walkthrough_data table
CREATE TABLE public.residential_walkthrough_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  walkthrough_id UUID NOT NULL,
  user_id UUID NOT NULL,
  
  -- Property Info
  property_type TEXT,
  service_type TEXT,
  square_footage TEXT,
  
  -- Main Data
  bedrooms TEXT,
  kitchen TEXT,
  living_room TEXT,
  dining_room TEXT,
  office TEXT,
  full_bath TEXT,
  half_bath TEXT,
  
  -- Additional
  fans TEXT,
  oven TEXT,
  refrigerator TEXT,
  blinds TEXT,
  windows_inside TEXT,
  windows_outside TEXT,
  
  -- Extra Services (JSON array)
  extra_services JSONB DEFAULT '[]'::jsonb,
  
  -- Pets
  has_pets TEXT,
  
  -- Notes
  notes TEXT,
  
  -- Photos (JSON array of URLs or base64)
  photos JSONB DEFAULT '[]'::jsonb,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.residential_walkthrough_data ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own residential data"
ON public.residential_walkthrough_data
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own residential data"
ON public.residential_walkthrough_data
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own residential data"
ON public.residential_walkthrough_data
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own residential data"
ON public.residential_walkthrough_data
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_residential_walkthrough_data_updated_at
BEFORE UPDATE ON public.residential_walkthrough_data
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();