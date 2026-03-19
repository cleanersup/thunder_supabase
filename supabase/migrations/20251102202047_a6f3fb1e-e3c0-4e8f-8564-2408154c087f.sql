-- Allow public booking forms to create notifications for business owners
CREATE POLICY "Public can create notifications for business owners"
ON public.notifications
FOR INSERT
WITH CHECK (true);