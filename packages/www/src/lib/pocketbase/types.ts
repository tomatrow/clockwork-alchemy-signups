// Hand-written shapes of the PocketBase collections this app reads. Keep in
// sync with packages/database/pb_migrations/*_init_schema.js.

export type WorkshopOption = { value: string; imageURL: string };

export type WorkshopRecord = {
	id: string;
	collectionId: string;
	collectionName: 'workshops';
	slug: string;
	name: string;
	description: string;
	images: string[];
	location: string;
	start: string; // "2026-10-16 21:30:00.000Z"
	end: string;
	capacity: number;
	cost: string;
	paymentInstructions: string;
	options: WorkshopOption[] | null;
};

export type ContentRecord = {
	id: string;
	collectionId: string;
	collectionName: 'content';
	logo: string;
	signupPreBlurb: string;
	rsvpButtonLabel: string;
	confirmationFooter: string;
	scheduleUrl: string;
	signupsOpen: boolean;
};

export type AvailabilityRecord = {
	id: string; // workshop id
	capacity: number;
	confirmed: number;
	waitlisted: number;
};

export type Intention = 'going' | 'not-going';

export type SignupStatusRecord = {
	id: string; // latest event id — changes on every append; key on workshop
	user: string;
	workshop: string;
	intention: Intention;
	option: string;
	status: 'confirmed' | 'waitlisted' | 'not-going';
	position: number;
};

export type UserRecord = {
	id: string;
	email: string;
	name: string;
	verified: boolean;
};

export type SignupEvent = {
	user: string;
	workshop: string;
	intention: Intention;
	option: string;
};

// Superuser-only outbox row; only the fields the server reads back.
export type TransactionalEmailRecord = {
	id: string;
	/** Set by the send hook when SMTP failed; empty on success. */
	error: string;
	sentAt: string;
};
