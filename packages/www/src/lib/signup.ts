// Client-side submission logic. The form is always "your complete
// submission": we diff the desired state against signup_status and append
// only the events that change something (the hook rejects no-ops, and the
// batch is all-or-nothing, so a stray no-op would sink the whole submit).
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import type { SignupEvent, SignupStatusRecord } from './pocketbase/types';
import type { WorkshopView } from './workshops';

export type Selection = { going: boolean; option: string };
export type Selections = Record<string, Selection>; // by workshop id

export function emptySelections(workshops: WorkshopView[]): Selections {
	return Object.fromEntries(workshops.map((w) => [w.id, { going: false, option: '' }]));
}

export function selectionsFromStatus(
	workshops: WorkshopView[],
	status: SignupStatusRecord[]
): Selections {
	const selections = emptySelections(workshops);
	for (const row of status) {
		if (row.workshop in selections && row.intention === 'going') {
			selections[row.workshop] = { going: true, option: row.option };
		}
	}
	return selections;
}

export type Diff = {
	events: Omit<SignupEvent, 'user'>[];
	/** workshop ids that this submission would cancel */
	cancels: string[];
};

export function diffSelections(
	selections: Selections,
	status: SignupStatusRecord[],
	workshops: WorkshopView[]
): Diff {
	const current = new Map(status.map((row) => [row.workshop, row]));
	const events: Diff['events'] = [];
	const cancels: string[] = [];

	for (const workshop of workshops) {
		const desired = selections[workshop.id] ?? { going: false, option: '' };
		const row = current.get(workshop.id);
		const isGoing = row?.intention === 'going';
		const option = workshop.options.length ? desired.option : '';

		if (desired.going) {
			if (!isGoing || row.option !== option) {
				events.push({ workshop: workshop.id, intention: 'going', option });
			}
		} else if (isGoing) {
			events.push({ workshop: workshop.id, intention: 'not-going', option: '' });
			cancels.push(workshop.id);
		}
	}
	return { events, cancels };
}

export async function appendEvents(pb: PocketBase, userId: string, events: Diff['events']) {
	if (events.length === 0) return;
	const batch = pb.createBatch();
	for (const event of events) {
		batch.collection('signups').create({ ...event, user: userId });
	}
	await batch.send();
}

export class EmailExistsError extends Error {
	constructor(public email: string) {
		super('An account with this email already exists.');
	}
}

/**
 * First-visit path: create the account with a throwaway password and sign in
 * with it once. Nobody ever sees the password; returning users use OTP.
 * PocketBase caps passwords at 71 chars — one UUID (36) is plenty.
 */
export async function createAccountAndSignIn(
	pb: PocketBase,
	{ email, name }: { email: string; name: string }
) {
	const password = crypto.randomUUID();
	try {
		await pb
			.collection('users')
			.create({ email, name, password, passwordConfirm: password, emailVisibility: false });
	} catch (err) {
		if (
			err instanceof ClientResponseError &&
			err.status === 400 &&
			err.response?.data?.email?.code === 'validation_not_unique'
		) {
			throw new EmailExistsError(email);
		}
		throw err;
	}
	await pb.collection('users').authWithPassword(email, password);
}

/** Message safe to show the user for a failed PocketBase call. */
export function describeError(err: unknown) {
	if (err instanceof ClientResponseError) {
		// batch failures nest the real message one level down
		const nested = err.response?.data?.requests;
		if (nested && typeof nested === 'object') {
			for (const item of Object.values(nested) as { response?: { message?: string } }[]) {
				if (item?.response?.message) return item.response.message;
			}
		}
		return err.message || 'Something went wrong.';
	}
	return err instanceof Error ? err.message : 'Something went wrong.';
}

// A submission bounced into /signin ("email already exists") is parked here so
// it can be applied after the code is entered.
const PENDING_KEY = 'pending-submission';
export type Pending = { name: string; selections: Selections };

export function stashPending(pending: Pending) {
	sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function takePending(): Pending | null {
	const raw = sessionStorage.getItem(PENDING_KEY);
	if (!raw) return null;
	sessionStorage.removeItem(PENDING_KEY);
	try {
		return JSON.parse(raw) as Pending;
	} catch {
		return null;
	}
}
