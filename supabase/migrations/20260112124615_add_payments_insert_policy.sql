-- Add INSERT policy for payments table to allow authenticated users to record payments
CREATE POLICY "Users can insert their own payments" 
ON public.payments FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- Add UPDATE policy just in case
CREATE POLICY "Users can update their own payments" 
ON public.payments FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
