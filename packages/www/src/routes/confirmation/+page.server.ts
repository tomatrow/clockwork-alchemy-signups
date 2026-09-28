import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type {
	AvailabilityRecord,
	SignupStatusRecord,
	WorkshopRecord
} from '#lib/pocketbase/types.js';
import { buildSummary, toWorkshopView } from '#lib/workshops.js';

export const load: PageServerLoad = async ({ locals }) => {
	const { pb, user } = locals;
	if (!user) redirect(303, '/');

	const [workshops, availability, status] = await Promise.all([
		pb.collection('workshops').getFullList<WorkshopRecord>(),
		pb.collection('workshop_availability').getFullList<AvailabilityRecord>(),
		pb.collection('signup_status').getFullList<SignupStatusRecord>()
	]);
	const byWorkshop = new Map(availability.map((a) => [a.id, a]));

	return {
		user,
		items: buildSummary(
			workshops.map((w) => toWorkshopView(pb, w, byWorkshop.get(w.id))),
			status
		)
	};
};
