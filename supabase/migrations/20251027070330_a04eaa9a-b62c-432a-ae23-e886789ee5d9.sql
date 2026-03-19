-- Create booking_forms table to store customized booking forms
CREATE TABLE public.booking_forms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  form_type TEXT NOT NULL CHECK (form_type IN ('residential', 'commercial')),
  custom_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.booking_forms ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own booking forms" 
ON public.booking_forms 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own booking forms" 
ON public.booking_forms 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own booking forms" 
ON public.booking_forms 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own booking forms" 
ON public.booking_forms 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_booking_forms_updated_at
BEFORE UPDATE ON public.booking_forms
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();