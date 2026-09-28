// View models shared by the form, the confirmation page and the email.
// Built on the server (needs the PocketBase URL to resolve file URLs) and
// serialised to the client as plain data.
import type PocketBase from 'pocketbase';
import type {
	AvailabilityRecord,
	ContentRecord,
	SignupStatusRecord,
	WorkshopRecord
} from './pocketbase/types';
import { byMeasures } from './utility/by-measures';

export type OptionView = { value: string; image: string | null };

export type WorkshopView = {
	id: string;
	slug: string;
	name: string;
	description: string;
	image: string | null;
	location: string;
	start: string; // ISO
	end: string;
	capacity: number;
	cost: string;
	paymentInstructions: string;
	options: OptionView[];
	/** capacity - confirmed; 0 means "join the waitlist" */
	spotsLeft: number;
	waitlisted: number;
	ended: boolean;
};

export type ContentView = {
	logo: string | null;
	signupPreBlurb: string;
	rsvpButtonLabel: string;
	confirmationFooter: string;
	scheduleUrl: string;
	signupsOpen: boolean;
};

export type SummaryItem = {
	workshop: WorkshopView;
	status: 'confirmed' | 'waitlisted';
	/** 1-based place on the waitlist; only meaningful when waitlisted */
	waitlistPlace: number;
	option: OptionView | null;
};

const TZ = 'America/Los_Angeles';

export function toISO(pbDate: string) {
	// PocketBase emits "YYYY-MM-DD HH:MM:SS.sssZ"; Safari won't parse the space.
	return pbDate ? pbDate.replace(' ', 'T') : '';
}

export function formatWhen(start: string, end: string) {
	if (!start) return '';
	const day = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' });
	const time = new Intl.DateTimeFormat('en-US', {
		timeZone: TZ,
		hour: 'numeric',
		minute: '2-digit'
	});
	const s = new Date(start);
	const range = end ? `${time.format(s)} – ${time.format(new Date(end))}` : time.format(s);
	return `${day.format(s)} ${range}`;
}

function isURL(value: string) {
	return /^https?:\/\//.test(value);
}

export function toWorkshopView(
	pb: PocketBase,
	record: WorkshopRecord,
	availability: AvailabilityRecord | undefined,
	now = Date.now()
): WorkshopView {
	const fileURL = (name: string) => (isURL(name) ? name : pb.files.getURL(record, name));
	const end = toISO(record.end);
	const confirmed = availability?.confirmed ?? 0;
	return {
		id: record.id,
		slug: record.slug,
		name: record.name,
		description: record.description ?? '',
		image: record.images?.[0] ? fileURL(record.images[0]) : null,
		location: record.location ?? '',
		start: toISO(record.start),
		end,
		capacity: record.capacity,
		cost: record.cost ?? '',
		paymentInstructions: record.paymentInstructions ?? '',
		options: (record.options ?? []).map((o) => ({
			value: o.value,
			image: o.imageURL ? fileURL(o.imageURL) : null
		})),
		spotsLeft: Math.max(0, record.capacity - confirmed),
		waitlisted: availability?.waitlisted ?? 0,
		ended: !!end && new Date(end).getTime() < now
	};
}

export function toContentView(pb: PocketBase, record: ContentRecord): ContentView {
	return {
		logo: record.logo ? pb.files.getURL(record, record.logo) : null,
		signupPreBlurb: record.signupPreBlurb ?? '',
		rsvpButtonLabel: record.rsvpButtonLabel || 'RSVP for this workshop',
		confirmationFooter: record.confirmationFooter ?? '',
		scheduleUrl: record.scheduleUrl ?? '',
		signupsOpen: !!record.signupsOpen
	};
}

/** Comparator: schedule order, anything without a start date last. */
export function byStart<T>(start: (item: T) => string) {
	return byMeasures<T>(
		(item) => (start(item) ? 0 : 1),
		(item) => (start(item) ? new Date(start(item)).getTime() : null)
	);
}

/** Everything the user is currently in, in schedule order. */
export function buildSummary(
	workshops: WorkshopView[],
	status: SignupStatusRecord[]
): SummaryItem[] {
	const byId = new Map(workshops.map((w) => [w.id, w]));
	const items: SummaryItem[] = [];
	for (const row of status) {
		if (row.intention !== 'going' || row.status === 'not-going') continue;
		const workshop = byId.get(row.workshop);
		if (!workshop) continue;
		items.push({
			workshop,
			status: row.status,
			waitlistPlace: Math.max(0, row.position - workshop.capacity),
			option: workshop.options.find((o) => o.value === row.option) ?? null
		});
	}
	return items.sort(byStart((item) => item.workshop.start));
}
