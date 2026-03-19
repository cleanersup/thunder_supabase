-- Allow anyone to view basic company info (name and logo) for public booking pages
-- This is needed so public booking forms can display the company branding
CREATE POLICY "Anyone can view company branding"
ON public.profiles
FOR SELECT
USING (true);