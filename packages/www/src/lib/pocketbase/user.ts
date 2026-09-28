// Shared by the browser client and the server hook: the signed-in user as the
// app sees it, read off whichever PocketBase client's auth store.
import type PocketBase from 'pocketbase';
import type { UserRecord } from './types';

export function userFrom(pb: PocketBase): UserRecord | null {
	const record = pb.authStore.record;
	if (!pb.authStore.isValid || !record) return null;
	return {
		id: record.id,
		email: record.email ?? '',
		name: record.name ?? '',
		verified: !!record.verified
	};
}
