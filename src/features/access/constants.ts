/** Where a visitor without Access is sent: the door to the demos. */
export const ACCESS_PATH = "/access";
export const SIGN_IN_PATH = "/access/sign-in";
export const GUESTS_PATH = "/access/guests";
export const PROFILE_PATH = "/access/profile";

/**
 * A readable cookie that only says "this browser signed in or redeemed a code",
 * so the header's profile menu asks who it is only when there is someone to ask
 * about. It carries no authority: Access is always decided from the session.
 */
export const PROFILE_HINT_COOKIE = "labs_profile";

/** What a refused request is told. */
export const DENIED_MESSAGE =
  "The demos open with a guest code. Enter one, or sign in, at /access.";
