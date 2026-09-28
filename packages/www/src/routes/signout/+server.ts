import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AUTH_COOKIE } from '#lib/pocketbase/client.js';

// Linked with data-sveltekit-reload so the browser does a full page load and
// the client-side auth store is rebuilt from the (now empty) cookie.
export const GET: RequestHandler = ({ cookies, locals }) => {
	cookies.delete(AUTH_COOKIE, { path: '/' });
	locals.pb.authStore.clear();
	redirect(303, '/');
};
