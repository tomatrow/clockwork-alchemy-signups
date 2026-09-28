// Browser-side PocketBase client. The auth token lives in a cookie (not
// localStorage) so the SvelteKit server sees the same session: SSR can
// pre-fill the form and remote functions know who is calling.
import PocketBase, { BaseAuthStore, type AuthRecord } from 'pocketbase';
import { PUBLIC_POCKETBASE_URL } from '$app/env/public';
import { browser } from '$app/env';

export const AUTH_COOKIE = 'pb_auth';

class CookieAuthStore extends BaseAuthStore {
	constructor() {
		super();
		if (browser) this.loadFromCookie(document.cookie, AUTH_COOKIE);
	}

	save(token: string, record?: AuthRecord) {
		super.save(token, record);
		this.persist();
	}

	clear() {
		super.clear();
		this.persist();
	}

	private persist() {
		if (!browser) return;
		// exportToCookie sets Expires to the token's exp, or 1970 when cleared.
		document.cookie = this.exportToCookie(
			{ httpOnly: false, secure: location.protocol === 'https:', sameSite: 'lax', path: '/' },
			AUTH_COOKIE
		);
	}
}

// Module singleton. During SSR this module is evaluated too, but the store is
// inert there (no cookie, nothing persisted) — server code uses locals.pb.
export const pb = new PocketBase(PUBLIC_POCKETBASE_URL, new CookieAuthStore());
pb.autoCancellation(false);
