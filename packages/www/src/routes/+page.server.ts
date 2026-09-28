import type { PageServerLoad } from './$types';
import type {
	AvailabilityRecord,
	SignupStatusRecord,
	WorkshopRecord
} from '#lib/pocketbase/types.js';
import { byStart, toWorkshopView } from '#lib/workshops.js';

export const load: PageServerLoad = async ({ locals }) => {
	const { pb, user } = locals;
	const [workshops, availability, status] = await Promise.all([
		pb.collection('workshops').getFullList<WorkshopRecord>(),
		pb.collection('workshop_availability').getFullList<AvailabilityRecord>(),
		user ? pb.collection('signup_status').getFullList<SignupStatusRecord>() : []
	]);
	const byWorkshop = new Map(availability.map((a) => [a.id, a]));
	return {
		workshops: workshops
			.map((w) => toWorkshopView(pb, w, byWorkshop.get(w.id)))
			.sort(byStart((w) => w.start)),
		status
	};
};
