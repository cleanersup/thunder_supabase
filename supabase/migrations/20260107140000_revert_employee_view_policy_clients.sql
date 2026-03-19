-- Migration: Fix employee view policy for clients to prevent cross-company data leaks and infinite recursion
-- Issue: Multiple problematic policies were created that cause:
--        1. Cross-company data leaks (users see other companies' clients)
--        2. Infinite recursion errors (policies reference clients.id within clients table policy)
-- Solution: Remove ALL problematic employee policies. Employee app will access client data
--           through nested selects in route_appointments queries (which already work via foreign keys)

-- Remove ALL problematic policies (may have been created during debugging/iterations)
DROP POLICY IF EXISTS "Employees can view clients from their assigned appointments" ON public.clients;
DROP POLICY IF EXISTS "Employees without owned clients can view assigned appointment clients" ON public.clients;
DROP POLICY IF EXISTS "Employees can view clients from their own assigned appointments" ON public.clients;

-- DO NOT create any replacement policy for employees
-- The existing "Users can view own clients" policy is sufficient for business owners
-- Employees will access client data through route_appointments foreign key relationships in nested selects
