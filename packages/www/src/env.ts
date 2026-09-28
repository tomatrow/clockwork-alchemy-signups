import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';
import * as v from 'valibot';

// Private values are only required at runtime, not at build time (CI builds
// don't have the superuser password and shouldn't).
const required = building ? v.optional(v.string(), '') : v.pipe(v.string(), v.nonEmpty());

export const variables = defineEnvVars({
	PUBLIC_POCKETBASE_URL: {
		public: true,
		description: 'Origin of the PocketBase instance the browser and server both talk to',
		schema: v.pipe(v.string(), v.url())
	},
	PB_ADMIN_USERNAME: {
		description: 'Superuser login used only to write transactional_emails rows',
		schema: required
	},
	PB_ADMIN_PASSWORD: {
		description: 'Superuser password (matches packages/database .env.<stage>.local)',
		schema: required
	}
});
