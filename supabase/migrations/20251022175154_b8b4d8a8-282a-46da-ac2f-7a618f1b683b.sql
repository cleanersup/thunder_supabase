-- Temporarily allow public read access to invoices for demo purposes
DROP POLICY IF EXISTS "Users can view their own invoices" ON public.invoices;

CREATE POLICY "Allow public read access to invoices" 
ON public.invoices 
FOR SELECT 
USING (true);

-- Keep the other policies requiring authentication for insert/update/delete
DROP POLICY IF EXISTS "Users can create their own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Users can update their own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Users can delete their own invoices" ON public.invoices;

CREATE POLICY "Anyone can create invoices" 
ON public.invoices 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update invoices" 
ON public.invoices 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete invoices" 
ON public.invoices 
FOR DELETE 
USING (true);