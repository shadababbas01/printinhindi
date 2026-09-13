import { createClient } from '@supabase/supabase-js';

// Only the PUBLISHABLE key ever ships to the browser. The service-role key
// lives exclusively in the Worker's secrets (apps/worker/wrangler.toml).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  // detectSessionInUrl (default true) is what lets a clicked magic-link
  // redirect establish a session on load — required since email login is
  // link-based, not a typed OTP code.
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);
