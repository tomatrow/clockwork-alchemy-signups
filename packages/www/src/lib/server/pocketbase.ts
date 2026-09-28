// Server-side PocketBase clients.
//
// - createServerClient: one per request, authenticated as whoever's cookie
//   came in (or nobody). Used for everything the user is allowed to do.
// - adminClient: superuser, module-scoped. Used ONLY to create
//   transactional_emails rows — nothing else needs elevated access.
import PocketBase from 'pocketbase';
import { PUBLIC_POCKETBASE_URL } from '$app/env/public';
import { PB_ADMIN_USERNAME, PB_ADMIN_PASSWORD } from '$app/env/private';
import { AUTH_COOKIE } from '#lib/pocketbase/client.js';

export function createServerClient(cookieHeader: string | null) {
	const pb = new PocketBase(PUBLIC_POCKETBASE_URL);
	pb.autoCancellation(false);
	pb.authStore.loadFromCookie(cookieHeader ?? '', AUTH_COOKIE);
	return pb;
}

let admin: PocketBase | undefined;

export async function adminClient() {
	admin ??= new PocketBase(PUBLIC_POCKETBASE_URL);
	admin.autoCancellation(false);
	if (!admin.authStore.isValid) {
		await admin.collection('_superusers').authWithPassword(PB_ADMIN_USERNAME, PB_ADMIN_PASSWORD);
	}
	return admin;
}
