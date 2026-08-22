// Just the cookie name, with zero other imports - middleware.ts runs on
// the Edge runtime and can't pull in Prisma/bcrypt (see auth.ts), so this
// constant lives on its own rather than importing the whole auth module.
export const SESSION_COOKIE = "bearing_session";
