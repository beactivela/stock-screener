-- Tighten default Supabase grants for this project.
-- The app uses service_role on the server and does not rely on anon/authenticated
-- clients querying PostgREST directly.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS object_name, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'v')
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON %s public.%I FROM anon, authenticated',
      CASE WHEN r.relkind = 'v' THEN 'TABLE' ELSE 'TABLE' END,
      r.object_name
    );
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION public.%I(%s) FROM anon, authenticated',
      r.proname,
      r.args
    );
  END LOOP;
END $$;
