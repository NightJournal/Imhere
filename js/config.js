// ---------------------------------------------------------------
// Imhere — configuration
// Everything you might want to change lives in this one file.
// ---------------------------------------------------------------

// Your Supabase project. The publishable key is safe in a public page:
// row-level security on the server decides what each signed-in user may see.
export const SUPABASE_URL = "https://lzprdruyayuhrgdymlje.supabase.co";
export const SUPABASE_KEY = "sb_publishable_-VyvWpOVT727GGOqgvVBWQ_KDNe1aMX";

// Private storage bucket holding the one ephemeral photo per user.
export const PHOTO_BUCKET = "photos";

// Which place-search service to use. See js/geo.js.
//   "photon"    — free, no API key, good autocomplete (default)
//   "nominatim" — free, stricter usage policy, slower
export const GEOCODER = "photon";

// Paid, automatic stamp generation. FALSE means the app never calls an image
// model and never costs you anything: you make the stamp yourself in whatever
// chat app you already use (the "copy the prompt" button hands you the text),
// and upload it. Set to true only after deploying the generate-stamp Edge
// Function and putting a billed API key in Supabase secrets.
export const AI_GENERATION_ENABLED = false;

// A last check-in older than this is shown as "quiet" to the circle.
export const STALE_HOURS = 36;

// Sign in with Apple. Leave FALSE until it's set up in the Apple Developer
// account and in Supabase → Authentication → Providers → Apple (see
// README: "Sign in with Apple"). Turning it on early shows a button that fails.
export const APPLE_SIGNIN_ENABLED = false;
