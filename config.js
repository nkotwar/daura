/* TASC Connect settings. Fill in these three values once (see SETUP.md, step 4).
   They are safe to keep in a public repo: the publishable key and client ID are meant to be public.
   What protects the data is the database's access rules, not these values. */
const DAURA_CONFIG = {
  supabaseUrl: 'https://nllqalynsoenojeiywae.supabase.co',
  supabaseKey: 'sb_publishable_3kYz7HxjPQDohwKLs8jMeA_NVs-XqFQ',
  vapidPublicKey: 'BDw1EHcoqJk9n77rDQM_NcHwPBPnNJUaGXmX8Rv1KzpYWmTg8YCPgDkAwg3Z3LcT0Rj7mM7w9zgQoQd73Ginp2Y',   // admin notifications (public half; the private half stays in Supabase secrets)
  googleClientId: '1060138636166-iod16ugo084qdkii0sru8cq8mfuhrpis.apps.googleusercontent.com'
};
