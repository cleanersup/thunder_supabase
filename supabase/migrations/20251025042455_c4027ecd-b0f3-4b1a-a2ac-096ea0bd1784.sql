-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view their own clients" ON public.clients;
DROP POLICY IF EXISTS "Users can create their own clients" ON public.clients;
DROP POLICY IF EXISTS "Users can update their own clients" ON public.clients;
DROP POLICY IF EXISTS "Users can delete their own clients" ON public.clients;

-- Create public access policies for development
CREATE POLICY "Allow public read access to clients" 
ON public.clients 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can create clients" 
ON public.clients 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update clients" 
ON public.clients 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete clients" 
ON public.clients 
FOR DELETE 
USING (true);