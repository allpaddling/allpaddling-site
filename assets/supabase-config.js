/* ============================================================
   supabase-config.js — Supabase client for All Paddling
   Loaded after the @supabase/supabase-js CDN script.
   The anon key is safe to expose in frontend code; row-level
   security policies enforce real access control on the server.
   ============================================================ */

const SUPABASE_URL      = 'https://crlukzkgmydyqpwndjvc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNybHVremtnbXlkeXFwd25kanZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNzM2OTUsImV4cCI6MjA5MjY0OTY5NX0.aBKWLnu5frWDNfNuJhw9xkRuvhyduslaLnuMsWm95V4';

/* `supabase` is the namespace exposed by the CDN bundle.
   `sb` is OUR client instance — used everywhere else. */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,    // pulls tokens out of the magic-link URL
    flowType: 'implicit',
  },
});
