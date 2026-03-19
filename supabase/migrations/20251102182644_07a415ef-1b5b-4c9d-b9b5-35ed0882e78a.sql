-- Drop the public view policy on profiles
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

-- Create a restricted policy so users can only view their own profile
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = user_id);