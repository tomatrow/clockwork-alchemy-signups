import type { Handle } from '@sveltejs/kit/hooks';
import { dev } from '$app/env';
import { AUTH_COOKIE } from '#lib/pocketbase/client.js';
import { userFrom } from '#lib/pocketbase/user.js';
import { createServerClient } from '#lib/server/pocketbase.js';

export const handle: Handle = async ({ event, resolve }) => {
	const pb = createServerClient(event.request.headers.get('cookie'));
	const incomingToken = pb.authStore.token;

	if (pb.authStore.isValid) {
		try {
			// Confirms the token is still honoured (tokenKey rotates on OTP
			// verify) and picks up the latest name/verified.
			await pb.collection('users').authRefresh();
		} catch {
			pb.authStore.clear();
		}
	}

	event.locals.pb = pb;
	event.locals.user = userFrom(pb);

	const response = await resolve(event);

	// Only touch the cookie when the session changed (refreshed or cleared).
	if (pb.authStore.token !== incomingToken) {
		response.headers.append(
			'set-cookie',
			pb.authStore.exportToCookie(
				{ httpOnly: false, secure: !dev, sameSite: 'lax', path: '/' },
				AUTH_COOKIE
			)
		);
	}

	return response;
};
