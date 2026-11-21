// ---------------------------------------------------------------
// Everything that talks to Supabase. Screens call these functions
// and never touch the client directly, so if the backend moves
// (hosted -> self-hosted) only this file changes.
// ---------------------------------------------------------------
import { SUPABASE_URL, SUPABASE_KEY, PHOTO_BUCKET } from "./config.js";

// supabase-js is loaded as a plain <script> in index.html and lives on window.
export const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Throw on error so callers can rely on the data. */
function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// ============================================================ auth

/**
 * Who is signed in, read from the session saved on this device.
 * Deliberately NOT getUser(): that asks the server, so with no signal
 * it returns null and the app would throw you back to the login screen.
 * Safe because the server re-checks the token on every request anyway.
 */
export async function currentUser() {
  const { data } = await db.auth.getSession();
  return data?.session?.user ?? null;
}

export async function signIn(email, password) {
  return unwrap(await db.auth.signInWithPassword({ email: email.trim(), password }));
}

export async function signUp(email, password, displayName) {
  const result = unwrap(await db.auth.signUp({ email: email.trim(), password }));
  // If the project requires email confirmation there is no session yet;
  // the profile row is created on first successful sign-in instead.
  if (result.session) await ensureProfile(displayName);
  return result;
}

/**
 * Sign in with Google. The browser leaves for Google and comes back to
 * this same page; supabase-js picks the session out of the return URL.
 * The return address must be listed in Supabase → Auth → URL Configuration.
 */
export async function signInWithGoogle() {
  const { error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: location.origin + location.pathname,
      queryParams: { prompt: "select_account" },   // let shared phones pick the right account
    },
  });
  if (error) throw error;
}

export async function signOut() {
  localStorage.removeItem("imhere.profile");   // don't leave the trip on a shared device
  await db.auth.signOut();
}

/** Every user needs one row in `profiles`. Safe to call on every launch. */
export async function ensureProfile(displayName) {
  const user = await currentUser();
  if (!user) return null;
  const existing = unwrap(
    await db.from("profiles").select("*").eq("id", user.id).maybeSingle()
  );
  if (existing) {
    if (displayName && displayName !== existing.display_name) {
      return unwrap(await db.from("profiles")
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq("id", user.id).select().single());
    }
    return existing;
  }
  // First sign-in: Google gives us a real name; otherwise use the email's first part.
  const meta = user.user_metadata || {};
  return unwrap(await db.from("profiles").insert({
    id: user.id,
    display_name: displayName || meta.full_name || meta.name || (user.email || "").split("@")[0],
  }).select().single());
}

export async function myProfile() {
  const user = await currentUser();
  if (!user) return null;
  try {
    const profile = unwrap(await db.from("profiles").select("*").eq("id", user.id).maybeSingle());
    // Remember it so the app still knows your current trip with no signal.
    if (profile) localStorage.setItem("imhere.profile", JSON.stringify(profile));
    return profile;
  } catch (error) {
    const cached = localStorage.getItem("imhere.profile");
    if (cached) return JSON.parse(cached);
    throw error;
  }
}

// ============================================================ check-ins

export async function myCheckIns() {
  const user = await currentUser();
  return unwrap(await db.from("check_ins").select("*")
    .eq("user_id", user.id).order("created_at", { ascending: false })) ?? [];
}

/**
 * Save a check-in.
 * fields: { place_name, latitude, longitude, country_code, message,
 *           transport_mode, transport_number, transport_date,
 *           transport_distance_km, photo_path, trip_id }
 */
export async function addCheckIn(fields) {
  const user = await currentUser();
  // Upsert on id: the outbox may retry after a lost response, and the
  // second attempt must update the same row, never create a duplicate.
  return unwrap(await db.from("check_ins").upsert({
    user_id: user.id,
    timezone_id: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    ...fields,
  }, { onConflict: "id" }).select().single());
}

export async function deleteCheckIn(id) {
  return unwrap(await db.from("check_ins").delete().eq("id", id));
}

// ============================================================ trips
// There is no `trips` table: a trip is a uuid stamped on check-ins,
// plus one row in `trip_origins`, plus profiles.current_trip_id
// pointing at whichever trip is "now".

export async function myTripOrigins() {
  const user = await currentUser();
  return unwrap(await db.from("trip_origins").select("*")
    .eq("user_id", user.id).order("departure_at", { ascending: false })) ?? [];
}

/** Begin a new trip and make it current. Returns the new trip id. */
export async function startTrip({ name, latitude, longitude, country_code, departure_at }) {
  const user = await currentUser();
  const tripId = crypto.randomUUID();
  unwrap(await db.from("trip_origins").insert({
    trip_id: tripId, user_id: user.id, name,
    latitude, longitude, country_code: country_code ?? null,
    departure_at: departure_at || new Date().toISOString(),
  }));
  await setCurrentTrip(tripId);
  return tripId;
}

export async function setCurrentTrip(tripId) {
  const user = await currentUser();
  return unwrap(await db.from("profiles")
    .update({ current_trip_id: tripId, updated_at: new Date().toISOString() })
    .eq("id", user.id).select().single());
}

/** Finish the current trip: it becomes history, nothing is deleted. */
export async function endCurrentTrip() {
  return setCurrentTrip(null);
}

// ============================================================ photo
// One ephemeral photo per user, stored as "<user-id>.jpg" so the
// storage policy in slice-c1.sql can check circle membership by name.

export async function uploadPhoto(blob) {
  const user = await currentUser();
  const path = `${user.id}.jpg`;
  const { error } = await db.storage.from(PHOTO_BUCKET)
    .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

export async function photoURL(path) {
  if (!path) return null;
  const { data, error } = await db.storage.from(PHOTO_BUCKET).download(path);
  if (error || !data) return null;
  return URL.createObjectURL(data);
}

// ============================================================ profile picture
// One per user at avatars/<user-id>.jpg (private bucket; you, your circle
// and the people whose circle you're in can see it — see setup.sql).

const AVATAR_BUCKET = "avatars";
const avatarCache = new Map();

export async function uploadAvatar(blob) {
  const user = await currentUser();
  const path = `${user.id}.jpg`;
  const { error } = await db.storage.from(AVATAR_BUCKET)
    .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw error;
  unwrap(await db.from("profiles").update({ avatar_path: path, updated_at: new Date().toISOString() })
    .eq("id", user.id));
  avatarCache.delete(path);
  return path;
}

export async function removeAvatar() {
  const user = await currentUser();
  const path = `${user.id}.jpg`;
  await db.storage.from(AVATAR_BUCKET).remove([path]);
  unwrap(await db.from("profiles").update({ avatar_path: null }).eq("id", user.id));
  avatarCache.delete(path);
}

/** A local URL for someone's picture, or null. Cached for this visit. */
export async function avatarURL(path) {
  if (!path) return null;
  if (avatarCache.has(path)) return avatarCache.get(path);
  const promise = db.storage.from(AVATAR_BUCKET).download(path)
    .then(({ data, error }) => (error || !data ? null : URL.createObjectURL(data)))
    .catch(() => null);
  avatarCache.set(path, promise);
  return promise;
}

// ============================================================ travel plans

export async function myPlans() {
  const user = await currentUser();
  return unwrap(await db.from("travel_plans")
    .select("*, plan_stops(*), plan_viewers(viewer_id)")
    .eq("user_id", user.id).order("start_date")) ?? [];
}

export async function savePlan(plan, stops, viewerIDs) {
  const user = await currentUser();
  const row = {
    user_id: user.id,
    destination: plan.destination,
    start_date: plan.start_date,
    end_date: plan.end_date,
    note: plan.note || null,
  };
  const saved = plan.id
    ? unwrap(await db.from("travel_plans").update(row).eq("id", plan.id).select().single())
    : unwrap(await db.from("travel_plans").insert(row).select().single());

  // Stops and viewers are small lists: delete-then-insert keeps it simple.
  await db.from("plan_stops").delete().eq("plan_id", saved.id);
  if (stops?.length) {
    unwrap(await db.from("plan_stops").insert(stops.map((s, i) => ({
      plan_id: saved.id, place: s.place,
      start_date: s.start_date, end_date: s.end_date, order_index: i,
    }))));
  }
  await db.from("plan_viewers").delete().eq("plan_id", saved.id);
  if (viewerIDs?.length) {
    unwrap(await db.from("plan_viewers").insert(
      viewerIDs.map((viewer_id) => ({ plan_id: saved.id, viewer_id }))));
  }
  return saved;
}

export async function deletePlan(id) {
  return unwrap(await db.from("travel_plans").delete().eq("id", id));
}

// ============================================================ circle

/** People who can see me. */
export async function myCircle() {
  const user = await currentUser();
  const rows = unwrap(await db.from("circle_memberships").select("*")
    .eq("owner_id", user.id)) ?? [];
  if (!rows.length) return [];
  const names = unwrap(await db.from("profiles").select("id, display_name, avatar_path")
    .in("id", rows.map((r) => r.member_id))) ?? [];
  const byID = Object.fromEntries(names.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, display_name: byID[r.member_id]?.display_name || "Member",
                            avatar_path: byID[r.member_id]?.avatar_path || null }));
}

/** People I can see. */
export async function myTravellers() {
  const user = await currentUser();
  const rows = unwrap(await db.from("circle_memberships").select("owner_id")
    .eq("member_id", user.id).eq("status", "active")) ?? [];
  if (!rows.length) return [];
  return unwrap(await db.from("profiles").select("id, display_name, avatar_path")
    .in("id", rows.map((r) => r.owner_id))) ?? [];
}

export async function setHistoryAccess(memberID, allowed) {
  const user = await currentUser();
  return unwrap(await db.from("circle_memberships")
    .update({ can_view_history: allowed })
    .eq("owner_id", user.id).eq("member_id", memberID));
}

export async function removeMember(memberID) {
  const user = await currentUser();
  return unwrap(await db.from("circle_memberships").delete()
    .eq("owner_id", user.id).eq("member_id", memberID));
}

/** New invite link: valid for `days` (1–30), for up to `people` (1–20) people. */
export async function createInvite({ days = 7, people = 1 } = {}) {
  const user = await currentUser();
  const expires = new Date(Date.now() + Math.min(30, Math.max(1, days)) * 86400_000 - 60_000);
  return unwrap(await db.from("circle_invites")
    .insert({ owner_id: user.id, expires_at: expires.toISOString(), max_uses: Math.min(20, Math.max(1, people)) })
    .select().single());
}

/** Links that still work (not expired, not full). */
export async function myInvites() {
  const user = await currentUser();
  const rows = unwrap(await db.from("circle_invites").select("*")
    .eq("owner_id", user.id).gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })) ?? [];
  return rows.filter((invite) => invite.use_count < invite.max_uses);
}

export async function cancelInvite(token) {
  unwrap(await db.from("circle_invites").delete().eq("token", token));
}

/** Plain words for a refused invite. */
export function inviteProblem(outcome) {
  return {
    own: "That's your own invite link",
    used: "You've already used this link. Ask them for a new one.",
    full: "This link has been used by as many people as it allows. Ask them for a new one.",
  }[outcome] || "That invite link has expired or isn't valid";
}

/** Returns "ok" | "own" | "invalid". */
export async function redeemInvite(token) {
  return unwrap(await db.rpc("redeem_invite", { invite_token: token.trim() }));
}

// ============================================================ friend view
// RLS decides what comes back — no filtering needed on this side.

export async function friendData(ownerID) {
  const [checkIns, plans, origins, profile] = await Promise.all([
    db.from("check_ins").select("*").eq("user_id", ownerID)
      .order("created_at", { ascending: false }),
    db.from("travel_plans").select("*, plan_stops(*)").eq("user_id", ownerID)
      .order("start_date"),
    db.from("trip_origins").select("*").eq("user_id", ownerID),
    db.from("profiles").select("*").eq("id", ownerID).maybeSingle(),
  ]);
  return {
    checkIns: checkIns.data ?? [],
    plans: plans.data ?? [],
    origins: origins.data ?? [],
    profile: profile.data ?? null,
  };
}

// ============================================================ live location
// A = one "last seen" point (source 'open'); B = live sessions with a trail.
// Inserts are idempotent (ids are made on the phone), so retries are safe.

export async function startLiveSession({ id, started_at, ends_at }) {
  unwrap(await db.from("live_sessions")
    .upsert({ id, started_at, ends_at }, { onConflict: "id", ignoreDuplicates: true }));
}

/** Deleting the session deletes its whole trail (on delete cascade). */
export async function stopLiveSession(id) {
  unwrap(await db.from("live_sessions").delete().eq("id", id));
}

export async function addLivePoints(points) {
  unwrap(await db.from("live_points")
    .upsert(points, { onConflict: "id", ignoreDuplicates: true }));
}

export async function deleteLastSeen() {
  const user = await currentUser();
  if (!user) return;
  unwrap(await db.from("live_points").delete().eq("user_id", user.id).eq("source", "open"));
}

/** What a circle member may see of someone: last-seen point + running trail (RLS decides). */
export async function friendLive(ownerID) {
  const [points, sessions] = await Promise.all([
    db.from("live_points").select("latitude, longitude, accuracy_m, recorded_at, source, session_id")
      .eq("user_id", ownerID).order("recorded_at", { ascending: true }).limit(2000),
    db.from("live_sessions").select("id, started_at, ends_at").eq("user_id", ownerID),
  ]);
  const all = points.data ?? [];
  return {
    lastSeen: all.filter((p) => p.source === "open").at(-1) ?? null,
    trail: all.filter((p) => p.source === "live"),
    session: (sessions.data ?? [])[0] ?? null,
  };
}

// ============================================================ travel groups
// People travelling together, until an end date. While a group runs its
// members see each other's check-ins and live location from the group's
// time; "check in for the group" copies a check-in to members who allow it.

export async function myGroups() {
  const rows = unwrap(await db.from("travel_groups")
    .select("*, group_members(member_id, joined_at, allow_group_checkins, sharing, profiles(id, display_name, avatar_path))")
    .order("ends_at", { ascending: false })) ?? [];
  const now = Date.now();
  return rows.map((g) => ({ ...g, active: !g.ends_at || new Date(g.ends_at).getTime() > now,
    members: (g.group_members || []).map((m) => ({ ...m, display_name: m.profiles?.display_name || "Member",
      avatar_path: m.profiles?.avatar_path || null })) }));
}

export async function createGroup(name, endsAt) {
  return unwrap(await db.rpc("create_group", { group_name: name, ends: endsAt }));
}

/** A friend group: no end date; members see each other's current trip and live location. */
export async function createFriendGroup(name) {
  return unwrap(await db.rpc("create_friend_group", { group_name: name }));
}

/** Friend groups: pause/resume sharing (paused = you don't see them, they don't see you). */
export async function setGroupSharing(groupId, on) {
  const user = await currentUser();
  unwrap(await db.from("group_members").update({ sharing: on })
    .eq("group_id", groupId).eq("member_id", user.id));
}

export async function createGroupInvite(groupId, people = 1) {
  return unwrap(await db.from("group_invites")
    .insert({ group_id: groupId, max_uses: Math.min(20, Math.max(1, people)) }).select().single());
}

export async function groupInvites(groupId) {
  const rows = unwrap(await db.from("group_invites").select("*").eq("group_id", groupId)
    .order("created_at", { ascending: false })) ?? [];
  const now = Date.now();
  return rows.filter((i) => i.use_count < i.max_uses && new Date(i.expires_at).getTime() > now);
}

export async function cancelGroupInvite(token) {
  unwrap(await db.from("group_invites").delete().eq("token", token));
}

/** "ok" | "used" | "full" | "ended" | "invalid" */
export async function joinGroup(token) {
  return unwrap(await db.rpc("join_group", { invite_token: token.trim() }));
}

export function groupProblem(outcome) {
  return {
    used: "You've already used this group link. Ask for a new one.",
    full: "This group link has been used by as many people as it allows.",
    ended: "That group has already ended.",
  }[outcome] || "That group link isn't valid any more.";
}

export async function leaveGroup(groupId) {
  const user = await currentUser();
  unwrap(await db.from("group_members").delete().eq("group_id", groupId).eq("member_id", user.id));
}

export async function removeGroupMember(groupId, memberId) {
  unwrap(await db.from("group_members").delete().eq("group_id", groupId).eq("member_id", memberId));
}

export async function endGroup(groupId) {
  unwrap(await db.rpc("end_group", { grp: groupId }));
}

export async function setGroupCheckins(groupId, allow) {
  const user = await currentUser();
  unwrap(await db.from("group_members").update({ allow_group_checkins: allow })
    .eq("group_id", groupId).eq("member_id", user.id));
}

/** Copy one of my check-ins to the group's members. Returns how many got it. */
export async function shareCheckinWithGroup(checkinId, groupId) {
  return unwrap(await db.rpc("group_share_checkin", { checkin: checkinId, grp: groupId }));
}

// ============================================================ delete account
// 1) remove the person's files (photo, profile picture, every poster) —
//    storage files can only be removed through the storage API;
// 2) delete the login, which deletes every database row with it.

export async function deleteMyAccount() {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in.");
  const remove = async (bucket, paths) => {
    if (!paths.length) return;
    const { error } = await db.storage.from(bucket).remove(paths);
    if (error) throw error;
  };
  await remove(PHOTO_BUCKET, [`${user.id}.jpg`]);
  await remove("avatars", [`${user.id}.jpg`]);
  for (;;) {   // posters live in a folder named after the user; 100 per page
    const { data: files, error } = await db.storage.from("posters").list(user.id, { limit: 100 });
    if (error) throw error;
    if (!files?.length) break;
    await remove("posters", files.map((f) => `${user.id}/${f.name}`));
    if (files.length < 100) break;
  }
  unwrap(await db.rpc("delete_my_account"));
  await db.auth.signOut({ scope: "local" }).catch(() => {});
}

// ============================================================ posters
// Field-notes posters: an image model draws the stamp, js/poster.js draws
// the sheet. Unlike check-in photos (one per user, overwritten), these are
// keepsakes and live in their own bucket.

export const POSTER_BUCKET = "posters";

/**
 * Ask the Edge Function for a stamp. The API key lives there, never here —
 * anything in this file is readable by anyone who opens the site.
 * Returns { image (base64 png), keywords, provider, remaining }.
 */
export async function generateStamp(checkInID) {
  const { data, error } = await db.functions.invoke("generate-stamp", {
    body: { check_in_id: checkInID },
  });
  if (error) {
    // Edge Function errors carry their message in the response body.
    let message = error.message;
    try { message = (await error.context?.json())?.error || message; } catch { /* keep */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function myPosters() {
  const user = await currentUser();
  return unwrap(await db.from("posters").select("*")
    .eq("user_id", user.id).order("created_at", { ascending: false })) ?? [];
}

/** Store the finished sheet and its record. `blobs` are PNGs. */
export async function savePoster({ checkIn, provider, style, posterBlob }) {
  const user = await currentUser();
  const id = crypto.randomUUID();
  const base = `${user.id}/${id}`;

  const put = async (suffix, blob) => {
    if (!blob) return null;
    const jpeg = blob.type === "image/jpeg";
    const path = `${base}${suffix}.${jpeg ? "jpg" : "png"}`;
    const { error } = await db.storage.from(POSTER_BUCKET)
      .upload(path, blob, { upsert: true, contentType: jpeg ? "image/jpeg" : "image/png" });
    if (error) throw error;
    return path;
  };

  const poster_path = await put("", posterBlob);

  return unwrap(await db.from("posters").insert({
    id,
    user_id: user.id,
    check_in_id: checkIn.id,
    place_name: checkIn.place_name,
    country_code: checkIn.country_code,
    taken_at: checkIn.created_at,
    poster_path, provider,
    style: style ?? null,
    status: "ready",
  }).select().single());
}

export async function posterURL(path) {
  if (!path) return null;
  const { data, error } = await db.storage.from(POSTER_BUCKET).download(path);
  if (error || !data) return null;
  return URL.createObjectURL(data);
}

export async function deletePoster(poster) {
  const paths = [poster.poster_path].filter(Boolean);
  if (paths.length) await db.storage.from(POSTER_BUCKET).remove(paths);
  return unwrap(await db.from("posters").delete().eq("id", poster.id));
}
