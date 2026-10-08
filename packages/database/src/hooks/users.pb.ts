/// <reference path="../../pb_data/types.d.ts" />

// users: PocketBase emails we never want sent. Password auth is on (the first
// visit signs in with a throwaway password) and anyone can create an account
// for any address, so every built-in "email this account" endpoint is a way to
// make us mail a stranger. The only PocketBase email users get is the OTP code,
// plus email change, which is left on uncapped by decision (see README "Email
// abuse"). Login alerts are off via `users.authAlert.enabled` in the migration.
//
// Suppressed at SEND time, not request time: PocketBase only fires the request
// hooks for addresses that have an account (unknown ones get an early 204), so
// rejecting there would reveal which emails are registered. Here the endpoint
// still answers 204 for everyone; the mail just never goes out.
//
// Returning WITHOUT e.next() is what suppresses the send: next() runs the
// default handler, which is the one that mails.
//
// Tagged "users" only: editors are superusers and still need password reset
// for the admin UI. (Their login alerts are off via `_superusers.authAlert`
// in the migration.)

// no password UI, so a reset link is useless to a user and only an abuse vector
onMailerRecordPasswordResetSend(() => {}, "users")

// OTP is what verifies an account; verification links are never used
onMailerRecordVerificationSend(() => {}, "users")
