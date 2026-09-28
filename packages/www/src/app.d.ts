import type PocketBase from 'pocketbase';
import type { UserRecord } from '#lib/pocketbase/types.js';

declare global {
	namespace App {
		interface Locals {
			/** PocketBase client authenticated as the cookie's user, or nobody. */
			pb: PocketBase;
			user: UserRecord | null;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
