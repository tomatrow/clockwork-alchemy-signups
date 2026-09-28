import type { LayoutServerLoad } from './$types';
import type { ContentRecord } from '#lib/pocketbase/types.js';
import { toContentView } from '#lib/workshops.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	const content = await locals.pb.collection('content').getFirstListItem<ContentRecord>('');
	return {
		user: locals.user,
		content: toContentView(locals.pb, content)
	};
};
